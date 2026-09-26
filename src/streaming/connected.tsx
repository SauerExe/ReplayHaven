import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Clip } from '../domain/models';
import { useActions } from '../components/Actions';
import { useIsAdmin } from '../components/AuthGate';
import { useDevicesHref } from '../components/settings/sections';
import { canContinue } from '../data/repository';
import { useVault } from '../data/store';
import { ClipMenu } from './ClipMenu';
import { DetailDialog } from './DetailDialog';
import { nextInQueue } from './library';
import { serverStatus, toStreamLibrary, type StreamClip, type StreamLibrary } from './model';
import { PlayerOverlay } from './PlayerOverlay';
import { moreFromGame, nextClipAfter } from './rows';
import { StreamingHeader } from './StreamingHeader';
import { StreamingHome } from './StreamingHome';

type Layer = 'clip' | 'play';
/** How many layers this page pushed onto the history itself; only those are closed by "Back". */
type LayerState = { streamLayers?: number; streamStart?: number } | null;

export function useMinuteClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/** Clips, collections and game info in the model of the streaming pages. */
export function useStreamLibrary(): StreamLibrary {
  const { state, gameInfo } = useVault();
  return useMemo(
    () =>
      toStreamLibrary(
        { clips: state.clips, collections: state.collections, progress: state.progress },
        gameInfo,
      ),
    [state.clips, state.collections, state.progress, gameInfo],
  );
}

/** Details and player hang on `?clip=` and `?play=`, so that "Back" closes them. */
export function useClipLayers() {
  const navigate = useNavigate();
  const location = useLocation();
  const closing = useRef(false);
  useEffect(() => {
    closing.current = false;
  }, [location.key]);
  const params = new URLSearchParams(location.search);
  const layer = location.state as LayerState;

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
    // A double Escape must not go back two steps and possibly leave the app.
    if (closing.current) return;
    closing.current = true;
    if ((layer?.streamLayers ?? 0) > 0) {
      navigate(-1);
      return;
    }
    // Link opened directly: nothing in the history that we could take back.
    const next = new URLSearchParams(location.search);
    next.delete(key);
    const search = next.toString();
    navigate({ search: search ? `?${search}` : '' }, { replace: true, state: null });
  }

  return {
    detailId: params.get('clip'),
    playId: params.get('play'),
    start: layer?.streamStart,
    open,
    replace,
    close,
  };
}

export type ClipLayerControls = ReturnType<typeof useClipLayers>;

/**
 * Detail dialog and player of a streaming page. `queue` sets the order for "Next clip", e.g. that
 * of the collection; without it, or for clips outside it, playback continues as on the home page.
 */
export function ClipLayers({
  layers,
  library,
  now,
  queue,
}: {
  layers: ClipLayerControls;
  library: StreamLibrary;
  now: number;
  queue?: StreamClip[];
}) {
  const { state, setState, patchClip } = useVault();
  const action = useActions();
  const navigate = useNavigate();
  // Plain accounts only watch: no favorites, tags, renaming or deleting (the server refuses them).
  const admin = useIsAdmin();
  const find = (id: string | null) => library.clips.find((c) => c.id === id) ?? null;
  const detail = find(layers.detailId);
  const playing = find(layers.playId);

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
  const next =
    playing &&
    (queue?.some((c) => c.id === playing.id)
      ? nextInQueue(queue, playing.id)
      : nextClipAfter(library.clips, playing.id));

  return (
    <>
      <DetailDialog
        clip={detail}
        more={detail ? moreFromGame(library.clips, detail) : []}
        now={now}
        onClose={() => layers.close('clip')}
        onPlay={(id, start) => layers.open('play', id, start)}
        onOpenClip={(id) => layers.replace('clip', id)}
        onToggleFavorite={admin ? toggleFavorite : undefined}
        onAddToCollection={(id) => action({ kind: 'add', ids: [id] })}
        onEditTags={admin ? (id) => action({ kind: 'tags', id }) : undefined}
        menu={
          detail && (
            <ClipMenu
              clip={detail}
              variant="round"
              onRename={admin ? (id, opener) => action({ kind: 'rename', id }, opener) : undefined}
              onShare={(id, opener) => action({ kind: 'share', id }, opener)}
              pageHref={`/clips/${encodeURIComponent(detail.id)}`}
              onNavigate={navigate}
              onDelete={
                admin ? (id, opener) => action({ kind: 'delete', ids: [id] }, opener) : undefined
              }
            />
          )
        }
      />
      {playing && (
        <PlayerOverlay
          key={playing.id}
          clip={playing}
          startAt={layers.start ?? resume}
          nextClip={next || null}
          playbackRate={state.preferences.speed}
          onClose={() => layers.close('play')}
          onNext={(id) => layers.replace('play', id)}
          onProgress={saveProgress}
          onMetadata={(id, { duration, height }) => {
            // As in the previous player: take the real length and resolution from the video.
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

export function StreamingHeaderContainer() {
  const devicesHref = useDevicesHref();
  const action = useActions();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const admin = useIsAdmin();
  const active =
    pathname === '/'
      ? '/'
      : pathname.startsWith('/settings')
        ? devicesHref
        : (['/library', '/collections'].find((path) => pathname.startsWith(path)) ?? '');
  return (
    <StreamingHeader
      active={active}
      onNavigate={navigate}
      onSearch={(query) => navigate(`/library?q=${encodeURIComponent(query)}`)}
      onAddClip={admin ? () => action({ kind: 'upload' }) : undefined}
      devicesHref={devicesHref}
    />
  );
}

export function StreamingHomeContainer({ header = false }: { header?: boolean }) {
  const devicesHref = useDevicesHref();
  const { server, patchClip } = useVault();
  const action = useActions();
  const navigate = useNavigate();
  const now = useMinuteClock();
  const library = useStreamLibrary();
  const layers = useClipLayers();
  const admin = useIsAdmin();

  function toggleFavorite(id: string) {
    const clip = library.clips.find((c) => c.id === id);
    if (clip) void patchClip(id, { favorite: !clip.favorite });
  }

  return (
    <>
      {header && <StreamingHeaderContainer />}
      <StreamingHome
        library={library}
        now={now}
        status={serverStatus(server, now)}
        onOpenClip={(id) => layers.open('clip', id)}
        onPlayClip={(id) => layers.open('play', id)}
        onToggleFavorite={admin ? toggleFavorite : undefined}
        onNavigate={navigate}
        onAddClip={admin ? () => action({ kind: 'upload' }) : undefined}
        onCreateCollection={() => action({ kind: 'create' })}
        connectHref={devicesHref}
      />
      <ClipLayers layers={layers} library={library} now={now} />
    </>
  );
}
