import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode, Dispatch, SetStateAction } from 'react';
import type { Clip, ServerGame, ServerInfo, UploadJob, VaultState } from '../domain/models';
import { deleteClips, repository } from './repository';
import { api, ApiError, disconnectedServer, uploadToServer } from './api';
import { useIsAdmin } from '../components/AuthGate';
import { createId } from './id';
import { mapLimited } from './limit';
import { sampleCollectionIds } from './seed';
import { t } from '../i18n';
type Store = {
  state: VaultState;
  setState: Dispatch<SetStateAction<VaultState>>;
  jobs: UploadJob[];
  importFiles: (files: File[], localOnly?: boolean) => Promise<void>;
  toast: (message: string) => void;
  patchClip: (id: string, patch: Partial<Clip>) => Promise<boolean>;
  /** The same change for many clips: a few requests at a time and one refresh at the end. */
  patchClips: (ids: string[], patch: Partial<Clip>) => Promise<boolean>;
  storageError: boolean;
  server: ServerInfo;
  /** Game info from the server: name, description and cover per game name. */
  gameInfo: Record<string, ServerGame>;
  refreshServer: () => Promise<void>;
  connectServer: (token: string) => Promise<void>;
  analyzeClip: (id: string) => Promise<void>;
  updateAnalysisSettings: (settings: ServerInfo['settings']) => Promise<void>;
  removeClips: (ids: string[]) => Promise<void>;
};
const Context = createContext<Store | null>(null);
/** Clip fields the server stores; everything else (duration, resolution) is local only. */
const SERVER_FIELDS = ['title', 'description', 'gameName', 'tags', 'favorite', 'note'];
/** How many PATCH requests a bulk change sends at once. */
const PATCH_CONCURRENCY = 4;
const POLL_INTERVAL = 5000;
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
  const admin = useIsAdmin();
  const adminRef = useRef(admin);
  adminRef.current = admin;
  const inFlightPatches = useRef(new Set<string>());
  const patchChains = useRef(new Map<string, Promise<boolean>>());
  // Every refresh gets a number; an answer older than the last applied one is dropped, so a slow
  // poll never overwrites what a newer request already showed.
  const requestSeq = useRef(0);
  const appliedSeq = useRef(0);
  const refreshing = useRef(0);
  // The last applied server answers as text: an unchanged poll leaves the state alone, so the
  // library does not re-render and nothing is written to storage every few seconds.
  const lastStatus = useRef('');
  const lastClips = useRef('');
  const lastGames = useRef('');
  const load = useCallback(async (poll: boolean) => {
    // A poll while another refresh is still running would only repeat it.
    if (poll && refreshing.current > 0) return;
    const seq = ++requestSeq.current;
    refreshing.current++;
    try {
      const info = await api<ServerInfo>('/status');
      const clips = await api<Clip[]>('/clips');
      if (seq < appliedSeq.current) return;
      appliedSeq.current = seq;
      const statusText = JSON.stringify(info);
      if (statusText !== lastStatus.current) {
        lastStatus.current = statusText;
        setServer(info);
      }
      // Game info is optional: without it the library still shows everything, just without covers.
      api<ServerGame[]>('/games')
        .then((list) => {
          const text = JSON.stringify(list);
          if (text === lastGames.current) return;
          lastGames.current = text;
          setGameInfo(
            Object.fromEntries(
              list
                .filter((g) => g.name)
                .flatMap((g) => [
                  [g.label, g],
                  [g.key, g],
                ]),
            ),
          );
        })
        .catch(() => {});
      const clipsText = JSON.stringify(clips);
      const patching = inFlightPatches.current.size > 0;
      if (poll && !patching && clipsText === lastClips.current) return;
      // While a change is on its way the merged list differs from the answer: compare anew next time.
      lastClips.current = patching ? '' : clipsText;
      setState((s) => ({
        ...s,
        clips: [
          ...clips.map((c) =>
            inFlightPatches.current.has(c.id) ? s.clips.find((old) => old.id === c.id) || c : c,
          ),
          // Once a server answers, sample clips are no longer needed: otherwise they would sit
          // between your own recordings forever. Your own browser uploads (local) stay.
          ...s.clips.filter((c) => !c.server && c.local),
        ],
        // The same goes for the sample collections, as long as nobody put their own clips in.
        collections: s.collections.filter(
          (c) =>
            !sampleCollectionIds.has(c.id) ||
            c.clipIds.some((id) => clips.some((clip) => clip.id === id)),
        ),
      }));
    } catch (error) {
      if (seq < appliedSeq.current) return;
      appliedSeq.current = seq;
      lastStatus.current = '';
      lastClips.current = '';
      // 401: the server wants a sign-in or its access key, whatever language it answers in.
      const authRequired = error instanceof ApiError && error.status === 401;
      setServer((s) =>
        !s.connected && s.authRequired === authRequired
          ? s
          : { ...s, connected: false, authRequired },
      );
    } finally {
      refreshing.current--;
    }
  }, []);
  const refreshServer = useCallback(() => load(false), [load]);
  useEffect(() => {
    void load(false);
    // Hidden tabs do not poll; coming back refreshes right away.
    const poll = () => {
      if (!document.hidden) void load(true);
    };
    const interval = setInterval(poll, POLL_INTERVAL);
    document.addEventListener('visibilitychange', poll);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [load]);
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
  /** Sends one clip change after the previous ones of the same clip; no refresh. */
  const sendPatch = useCallback(
    (id: string, allowed: Partial<Clip>) => {
      inFlightPatches.current.add(id);
      const chain: Promise<boolean> = (patchChains.current.get(id) || Promise.resolve(true))
        .then(() => api<Clip>(`/clips/${id}`, { method: 'PATCH', body: JSON.stringify(allowed) }))
        .then(() => true)
        .catch((error: Error) => {
          toast(error.message);
          return false;
        })
        .finally(() => {
          if (patchChains.current.get(id) === chain) {
            patchChains.current.delete(id);
            inFlightPatches.current.delete(id);
          }
        });
      patchChains.current.set(id, chain);
      return chain;
    },
    [toast],
  );
  const patchClips = useCallback(
    async (ids: string[], patch: Partial<Clip>) => {
      const synced = (key: string) => SERVER_FIELDS.includes(key);
      const allowed = Object.fromEntries(Object.entries(patch).filter(([key]) => synced(key)));
      // A plain account may not change server clips (the server answers 403); keep only the
      // local-only fields such as the measured duration, instead of showing an error.
      const localOnly = Object.fromEntries(Object.entries(patch).filter(([key]) => !synced(key)));
      const changes = new Map<string, Partial<Clip>>();
      const remote: string[] = [];
      let ok = true;
      for (const id of ids) {
        const onServer = !!stateRef.current.clips.find((c) => c.id === id)?.server;
        if (onServer && !adminRef.current) {
          if (Object.keys(localOnly).length) changes.set(id, localOnly);
          if (Object.keys(localOnly).length !== Object.keys(patch).length) ok = false;
          continue;
        }
        changes.set(id, patch);
        if (onServer && Object.keys(allowed).length) remote.push(id);
      }
      if (changes.size)
        setState((s) => ({
          ...s,
          clips: s.clips.map((c) => {
            const change = changes.get(c.id);
            return change ? { ...c, ...change } : c;
          }),
        }));
      if (!remote.length) return ok;
      const results = await mapLimited(remote, PATCH_CONCURRENCY, (id) => sendPatch(id, allowed));
      // A later change of one of these clips is still on its way and refreshes when it is done.
      if (!remote.some((id) => patchChains.current.has(id))) void refreshServer();
      return ok && results.every(Boolean);
    },
    [refreshServer, sendPatch],
  );
  const patchClip = useCallback(
    (id: string, patch: Partial<Clip>) => patchClips([id], patch),
    [patchClips],
  );
  const removeClips = useCallback(async (ids: string[]) => {
    for (const id of ids) {
      if (stateRef.current.clips.find((c) => c.id === id)?.server)
        await api(`/clips/${id}`, { method: 'DELETE' });
      setState((s) => deleteClips(s, [id]));
    }
  }, []);
  const connectServer = useCallback(
    async (token: string) => {
      await api('/session', { method: 'POST', body: JSON.stringify({ token }) });
      await refreshServer();
    },
    [refreshServer],
  );
  const analyzeClip = useCallback(
    async (id: string) => {
      await api(`/clips/${id}/analyze`, { method: 'POST' });
      await refreshServer();
      toast(t('app.store.analysisQueued'));
    },
    [refreshServer, toast],
  );
  const updateAnalysisSettings = useCallback(
    async (settings: ServerInfo['settings']) => {
      await api('/settings/analysis', { method: 'PUT', body: JSON.stringify(settings) });
      await refreshServer();
      toast(t('app.store.analysisSettingsSaved'));
    },
    [refreshServer, toast],
  );
  const importFiles = useCallback(
    async (files: File[], localOnly = false) => {
      // Plain accounts may not upload; their files stay local previews in this browser.
      if (serverRef.current.connected && !localOnly && adminRef.current) {
        for (const file of files) {
          const id = createId();
          setJobs((j) => [
            ...j,
            { id, name: file.name, progress: 0, status: 'reading', server: true },
          ]);
          try {
            if (file.size > 2 * 1024 ** 3) throw new Error(t('app.store.tooLarge'));
            const clip = await uploadToServer(file, (progress) =>
              setJobs((j) => j.map((job) => (job.id === id ? { ...job, progress } : job))),
            );
            setState((s) => ({ ...s, clips: [clip, ...s.clips.filter((c) => c.id !== clip.id)] }));
            setJobs((j) =>
              j.map((job) =>
                job.id === id
                  ? { ...job, status: 'complete', progress: 100, clipId: clip.id }
                  : job,
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
                      error: error instanceof Error ? error.message : t('app.api.uploadFailed'),
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
          ? t('app.store.unsupportedFormat')
          : file.size > 2 * 1024 ** 3
            ? t('app.store.tooLargeLocal')
            : file.size === 0
              ? t('app.store.emptyFile')
              : undefined;
        setJobs((j) => [
          ...j,
          { id, name: file.name, progress: 0, status: error ? 'error' : 'reading', error },
        ]);
        if (error) continue;
        const url = URL.createObjectURL(file);
        urls.current.set(id, url);
        pendingUrls.current.add(id);
        const result = await new Promise<{
          duration: number;
          width: number;
          height: number;
        } | null>((resolve) => {
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
        });
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
                    error: t('app.store.unreadable'),
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
    },
    [refreshServer],
  );
  const value = useMemo<Store>(
    () => ({
      state,
      setState,
      jobs,
      importFiles,
      toast,
      patchClip,
      patchClips,
      storageError,
      server,
      gameInfo,
      refreshServer,
      connectServer,
      analyzeClip,
      updateAnalysisSettings,
      removeClips,
    }),
    [
      state,
      jobs,
      importFiles,
      toast,
      patchClip,
      patchClips,
      storageError,
      server,
      gameInfo,
      refreshServer,
      connectServer,
      analyzeClip,
      updateAnalysisSettings,
      removeClips,
    ],
  );
  return (
    <Context.Provider value={value}>
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
