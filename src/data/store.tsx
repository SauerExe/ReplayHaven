import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode, Dispatch, SetStateAction } from 'react';
import type { Clip, ServerGame, ServerInfo, UploadJob, VaultState } from '../domain/models';
import { deleteClips, repository } from './repository';
import { api, disconnectedServer, uploadToServer } from './api';
import { createId } from './id';
import { sampleCollectionIds } from './seed';
type Store = {
  state: VaultState;
  setState: Dispatch<SetStateAction<VaultState>>;
  jobs: UploadJob[];
  importFiles: (files: File[], localOnly?: boolean) => Promise<void>;
  toast: (message: string) => void;
  patchClip: (id: string, patch: Partial<Clip>) => Promise<boolean>;
  storageError: boolean;
  server: ServerInfo;
  /** Spielinfos vom Server: Name, Beschreibung und Cover je Spielname. */
  gameInfo: Record<string, ServerGame>;
  refreshServer: () => Promise<void>;
  connectServer: (token: string) => Promise<void>;
  analyzeClip: (id: string) => Promise<void>;
  updateAnalysisSettings: (settings: ServerInfo['settings']) => Promise<void>;
  removeClips: (ids: string[]) => Promise<void>;
};
const Context = createContext<Store | null>(null);
export function VaultProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(repository.load);
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [message, setMessage] = useState('');
  const [storageError, setStorageError] = useState(false);
  const [server, setServer] = useState<ServerInfo>(disconnectedServer);
  const [gameInfo, setGameInfo] = useState<Record<string, ServerGame>>({});
  const stateRef = useRef(state);
  stateRef.current = state;
  const serverRef = useRef(server);
  serverRef.current = server;
  const inFlightPatches = useRef(new Set<string>());
  const patchChains = useRef(new Map<string, Promise<unknown>>());
  const refreshServer = useCallback(async () => {
    try {
      const info = await api<ServerInfo>('/status');
      const clips = await api<Clip[]>('/clips');
      setServer(info);
      // Spielinfos sind Beiwerk: ohne sie zeigt die Bibliothek weiterhin alles, nur ohne Cover.
      api<ServerGame[]>('/games')
        .then((list) =>
          setGameInfo(Object.fromEntries(list.filter((g) => g.name).map((g) => [g.label, g]))),
        )
        .catch(() => {});
      setState((s) => ({
        ...s,
        clips: [
          ...clips.map((c) =>
            inFlightPatches.current.has(c.id) ? s.clips.find((old) => old.id === c.id) || c : c,
          ),
          // Sobald ein Server antwortet, haben Beispiel-Clips ausgedient: sie stehen sonst
          // dauerhaft zwischen den eigenen Aufnahmen. Eigene Browser-Uploads (local) bleiben.
          ...s.clips.filter((c) => !c.server && c.local),
        ],
        // Dasselbe gilt für die Beispiel-Sammlungen, solange niemand eigene Clips hineinlegt.
        collections: s.collections.filter(
          (c) =>
            !sampleCollectionIds.has(c.id) ||
            c.clipIds.some((id) => clips.some((clip) => clip.id === id)),
        ),
      }));
    } catch (error) {
      setServer((s) => ({
        ...s,
        connected: false,
        authRequired: error instanceof Error && error.message.includes('Zugangsschlüssel'),
      }));
    }
  }, []);
  useEffect(() => {
    void refreshServer();
    const interval = setInterval(() => {
      if (!document.hidden) void refreshServer();
    }, 5000);
    return () => clearInterval(interval);
  }, [refreshServer]);
  const urls = useRef(new Map<string, string>());
  const pendingUrls = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toast = useCallback((text: string) => {
    setMessage(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(''), 4000);
  }, []);
  useEffect(() => {
    try {
      repository.save(state);
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [state]);
  useEffect(() => {
    document.documentElement.dataset.reduced = String(state.preferences.reducedMotion);
    document.documentElement.dataset.compact = String(state.preferences.compact);
  }, [state.preferences]);
  useEffect(() => {
    for (const [id, url] of urls.current)
      if (!pendingUrls.current.has(id) && !state.clips.some((c) => c.id === id)) {
        URL.revokeObjectURL(url);
        urls.current.delete(id);
      }
  }, [state.clips]);
  useEffect(() => {
    const map = urls.current;
    return () => {
      map.forEach((url) => URL.revokeObjectURL(url));
      clearTimeout(timer.current);
    };
  }, []);
  const patchClip = useCallback(
    (id: string, patch: Partial<Clip>) => {
      setState((s) => ({
        ...s,
        clips: s.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      }));
      if (!stateRef.current.clips.find((c) => c.id === id)?.server) return Promise.resolve(true);
      const allowed = Object.fromEntries(
        Object.entries(patch).filter(([key]) =>
          ['title', 'description', 'gameName', 'tags', 'favorite', 'note'].includes(key),
        ),
      );
      if (!Object.keys(allowed).length) return Promise.resolve(true);
      inFlightPatches.current.add(id);
      const chain = (patchChains.current.get(id) || Promise.resolve())
        .then(() => api<Clip>(`/clips/${id}`, { method: 'PATCH', body: JSON.stringify(allowed) }))
        .then(() => true)
        .catch((error) => {
          toast(error.message);
          return false;
        })
        .finally(() => {
          if (patchChains.current.get(id) === chain) {
            patchChains.current.delete(id);
            inFlightPatches.current.delete(id);
            void refreshServer();
          }
        });
      patchChains.current.set(id, chain);
      return chain;
    },
    [refreshServer, toast],
  );
  async function removeClips(ids: string[]) {
    for (const id of ids) {
      if (stateRef.current.clips.find((c) => c.id === id)?.server)
        await api(`/clips/${id}`, { method: 'DELETE' });
      setState((s) => deleteClips(s, [id]));
    }
  }
  async function connectServer(token: string) {
    await api('/session', { method: 'POST', body: JSON.stringify({ token }) });
    await refreshServer();
  }
  async function analyzeClip(id: string) {
    await api(`/clips/${id}/analyze`, { method: 'POST' });
    await refreshServer();
    toast('KI-Analyse eingeplant');
  }
  async function updateAnalysisSettings(settings: ServerInfo['settings']) {
    await api('/settings/analysis', { method: 'PUT', body: JSON.stringify(settings) });
    await refreshServer();
    toast('Analyse-Einstellungen gespeichert');
  }
  async function importFiles(files: File[], localOnly = false) {
    if (serverRef.current.connected && !localOnly) {
      for (const file of files) {
        const id = createId();
        setJobs((j) => [
          ...j,
          { id, name: file.name, progress: 0, status: 'reading', server: true },
        ]);
        try {
          if (file.size > 2 * 1024 ** 3) throw new Error('Die Datei ist größer als 2 GB.');
          const clip = await uploadToServer(file, (progress) =>
            setJobs((j) => j.map((job) => (job.id === id ? { ...job, progress } : job))),
          );
          setState((s) => ({ ...s, clips: [clip, ...s.clips.filter((c) => c.id !== clip.id)] }));
          setJobs((j) =>
            j.map((job) =>
              job.id === id ? { ...job, status: 'complete', progress: 100, clipId: clip.id } : job,
            ),
          );
          await refreshServer();
        } catch (error) {
          setJobs((j) =>
            j.map((job) =>
              job.id === id
                ? {
                    ...job,
                    status: 'error',
                    error: error instanceof Error ? error.message : 'Upload fehlgeschlagen.',
                  }
                : job,
            ),
          );
        }
      }
      return;
    }
    for (const file of files) {
      const id = createId();
      const error = !/\.(mp4|webm|mov|m4v)$/i.test(file.name)
        ? 'Dieses Format wird nicht unterstützt. Wähle MP4, WebM oder MOV.'
        : file.size > 2 * 1024 ** 3
          ? 'Die Datei ist größer als 2 GB. Wähle eine kleinere Datei.'
          : file.size === 0
            ? 'Die Datei ist leer. Wähle eine andere Videodatei.'
            : undefined;
      setJobs((j) => [
        ...j,
        { id, name: file.name, progress: 0, status: error ? 'error' : 'reading', error },
      ]);
      if (error) continue;
      const url = URL.createObjectURL(file);
      urls.current.set(id, url);
      pendingUrls.current.add(id);
      const result = await new Promise<{ duration: number; width: number; height: number } | null>(
        (resolve) => {
          const video = document.createElement('video');
          video.preload = 'metadata';
          let settled = false;
          const finish = (r: { duration: number; width: number; height: number } | null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            video.onloadedmetadata = null;
            video.onerror = null;
            video.removeAttribute('src');
            video.load();
            resolve(r);
          };
          const timeout = setTimeout(() => finish(null), 15000);
          video.onloadedmetadata = () =>
            finish(
              Number.isFinite(video.duration)
                ? { duration: video.duration, width: video.videoWidth, height: video.videoHeight }
                : null,
            );
          video.onerror = () => finish(null);
          video.src = url;
        },
      );
      pendingUrls.current.delete(id);
      if (!result) {
        URL.revokeObjectURL(url);
        urls.current.delete(id);
        setJobs((j) =>
          j.map((job) =>
            job.id === id
              ? {
                  ...job,
                  status: 'error',
                  error:
                    'Der Browser kann diese Datei nicht lesen. Versuche eine MP4-Datei mit H.264.',
                }
              : job,
          ),
        );
        continue;
      }
      const clip: Clip = {
        id,
        title: file.name.replace(/\.[^.]+$/, ''),
        gameId: 'local',
        thumbnail: '',
        videoSource: url,
        duration: result.duration,
        recordedAt: new Date(file.lastModified).toISOString(),
        size: file.size,
        resolution: `${result.height}p`,
        tags: [],
        favorite: false,
        status: 'ready',
        note: '',
        local: true,
      };
      setState((s) => ({ ...s, clips: [clip, ...s.clips] }));
      setJobs((j) =>
        j.map((job) =>
          job.id === id ? { ...job, progress: 100, status: 'complete', clipId: id } : job,
        ),
      );
    }
  }
  return (
    <Context.Provider
      value={{
        state,
        setState,
        jobs,
        importFiles,
        toast,
        patchClip,
        storageError,
        server,
        gameInfo,
        refreshServer,
        connectServer,
        analyzeClip,
        updateAnalysisSettings,
        removeClips,
      }}
    >
      {children}
      <div className={`toast ${message ? 'visible' : ''}`} role="status">
        {message}
      </div>
    </Context.Provider>
  );
}
export function useVault() {
  const store = useContext(Context);
  if (!store) throw new Error('VaultProvider missing');
  return store;
}
