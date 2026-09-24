import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Clip } from '../domain/models';
import { useActions } from '../components/Actions';
import { canContinue } from '../data/repository';
import { useVault } from '../data/store';
import { DetailDialog } from './DetailDialog';
import { serverStatus, toStreamLibrary } from './model';
import { PlayerOverlay } from './PlayerOverlay';
import { moreFromGame, nextClipAfter } from './rows';
import { StreamingHeader } from './StreamingHeader';
import { StreamingHome } from './StreamingHome';

type Layer = 'clip' | 'play';
/** Wie viele Ebenen diese Startseite selbst in den Verlauf gelegt hat; nur die schließt „Zurück“. */
type LayerState = { streamLayers?: number; streamStart?: number } | null;

function useMinuteClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

export function StreamingHeaderContainer() {
  const action = useActions();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const active =
    pathname === '/'
      ? '/'
      : (['/library', '/collections', '/devices'].find((path) => pathname.startsWith(path)) ?? '');
  return (
    <StreamingHeader
      active={active}
      onNavigate={navigate}
      onSearch={(query) => navigate(`/library?q=${encodeURIComponent(query)}`)}
      onAddClip={() => action({ kind: 'upload' })}
    />
  );
}

export function StreamingHomeContainer({ header = false }: { header?: boolean }) {
  const { state, setState, patchClip, gameInfo, server } = useVault();
  const action = useActions();
  const navigate = useNavigate();
  const location = useLocation();
  const now = useMinuteClock();
  const closing = useRef(false);
  useEffect(() => {
    closing.current = false;
  }, [location.key]);

  const library = useMemo(
    () =>
      toStreamLibrary(
        { clips: state.clips, collections: state.collections, progress: state.progress },
        gameInfo,
      ),
    [state.clips, state.collections, state.progress, gameInfo],
  );
  const params = new URLSearchParams(location.search);
  const layer = location.state as LayerState;
  const find = (id: string | null) => library.clips.find((c) => c.id === id) ?? null;
  const detail = find(params.get('clip'));
  const playing = find(params.get('play'));

  function open(key: Layer, id: string, start?: number) {
    const next = new URLSearchParams(location.search);
    next.set(key, id);
    navigate(
      { search: `?${next}` },
      { state: { streamLayers: (layer?.streamLayers ?? 0) + 1, streamStart: start } },
    );
  }

  function replace(key: Layer, id: string) {
    const next = new URLSearchParams(location.search);
    next.set(key, id);
    navigate(
      { search: `?${next}` },
      { replace: true, state: { ...layer, streamStart: undefined } },
    );
  }

  function close(key: Layer) {
    // Doppeltes Escape darf nicht zwei Schritte zurück und womöglich aus der App springen.
    if (closing.current) return;
    closing.current = true;
    if ((layer?.streamLayers ?? 0) > 0) {
      navigate(-1);
      return;
    }
    // Direkt aufgerufener Link: nichts im Verlauf, das wir zurücknehmen könnten.
    const next = new URLSearchParams(location.search);
    next.delete(key);
    const search = next.toString();
    navigate({ search: search ? `?${search}` : '' }, { replace: true, state: null });
  }

  function toggleFavorite(id: string) {
    const clip = find(id);
    if (clip) void patchClip(id, { favorite: !clip.favorite });
  }

  const saveProgress = useCallback(
    (id: string, seconds: number, duration: number) =>
      setState((s) => ({
        ...s,
        progress: {
          ...s.progress,
          [id]: { seconds, duration, updatedAt: new Date().toISOString() },
        },
      })),
    [setState],
  );

  const resume =
    playing?.progress && canContinue(playing.progress.seconds, playing.progress.duration)
      ? playing.progress.seconds
      : 0;

  return (
    <>
      {header && <StreamingHeaderContainer />}
      <StreamingHome
        library={library}
        now={now}
        status={serverStatus(server, now)}
        onOpenClip={(id) => open('clip', id)}
        onPlayClip={(id) => open('play', id)}
        onToggleFavorite={toggleFavorite}
        onNavigate={navigate}
        onAddClip={() => action({ kind: 'upload' })}
        onCreateCollection={() => action({ kind: 'create' })}
        connectHref="/devices"
      />
      <DetailDialog
        clip={detail}
        more={detail ? moreFromGame(library.clips, detail) : []}
        now={now}
        onClose={() => close('clip')}
        onPlay={(id, start) => open('play', id, start)}
        onOpenClip={(id) => replace('clip', id)}
        onToggleFavorite={toggleFavorite}
        onAddToCollection={(id) => action({ kind: 'add', ids: [id] })}
        onEditTags={(id) => action({ kind: 'tags', id })}
      />
      {playing && (
        <PlayerOverlay
          key={playing.id}
          clip={playing}
          startAt={layer?.streamStart ?? resume}
          nextClip={nextClipAfter(library.clips, playing.id)}
          playbackRate={state.preferences.speed}
          onClose={() => close('play')}
          onNext={(id) => replace('play', id)}
          onProgress={saveProgress}
          onMetadata={(id, { duration, height }) => {
            // Wie im bisherigen Player: echte Länge und Auflösung aus dem Video übernehmen.
            const patch: Partial<Clip> = {};
            if (duration && Math.abs(duration - playing.duration) > 0.5) patch.duration = duration;
            if (height && `${height}p` !== playing.resolution) patch.resolution = `${height}p`;
            if (Object.keys(patch).length) void patchClip(id, patch);
          }}
        />
      )}
    </>
  );
}
