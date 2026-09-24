import { lazy, StrictMode, Suspense, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import './streaming.css';
import { canContinue } from '../data/repository';
import { DetailDialog } from './DetailDialog';
import { serverStatus, toStreamLibrary } from './model';
import { PlayerOverlay } from './PlayerOverlay';
import { createPreviewState, previewGames, previewNow, previewServer } from './preview-data';
import { moreFromGame, nextClipAfter } from './rows';
import { StreamingHeader } from './StreamingHeader';
import { StreamingHome } from './StreamingHome';

// Entwicklungsvorschau, nicht Teil des Builds. ?modus=app zeigt den Container in der echten App-Hülle,
// ?video=/pfad/clip.mp4 gibt allen Beispiel-Clips eine Videodatei.
const params = new URLSearchParams(window.location.search);
const AppPreview = lazy(() => import('./preview-app'));

function SamplePreview() {
  const [now] = useState(previewNow);
  const [state, setState] = useState(() =>
    createPreviewState(now, params.get('video') || undefined),
  );
  const [detailId, setDetailId] = useState<string | null>(null);
  const [player, setPlayer] = useState<{ id: string; startAt?: number } | null>(null);
  const [notice, setNotice] = useState('');
  const library = useMemo(() => toStreamLibrary(state, previewGames), [state]);
  const detail = library.clips.find((c) => c.id === detailId) ?? null;
  const playing = library.clips.find((c) => c.id === player?.id) ?? null;

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const inApp = (what: string) => () => setNotice(`In der App: ${what}`);
  const navigate = (href: string) => setNotice(`In der App: öffnet ${href}`);

  function toggleFavorite(id: string) {
    setState((s) => ({
      ...s,
      clips: s.clips.map((c) => (c.id === id ? { ...c, favorite: !c.favorite } : c)),
    }));
  }

  function play(id: string, startAt?: number) {
    const progress = library.clips.find((c) => c.id === id)?.progress;
    setPlayer({
      id,
      startAt:
        startAt ??
        (progress && canContinue(progress.seconds, progress.duration) ? progress.seconds : 0),
    });
  }

  return (
    <>
      <StreamingHeader
        active="/"
        onNavigate={navigate}
        onSearch={(query) => setNotice(`In der App: Suche nach „${query}“`)}
        onAddClip={inApp('Dialog „Clips hinzufügen“')}
      />
      <main>
        <StreamingHome
          library={library}
          now={now}
          status={serverStatus(previewServer(now), now)}
          onOpenClip={setDetailId}
          onPlayClip={(id) => play(id)}
          onToggleFavorite={toggleFavorite}
          onNavigate={navigate}
          onAddClip={inApp('Dialog „Clips hinzufügen“')}
          onCreateCollection={inApp('Dialog „Neue Sammlung“')}
          connectHref="/devices"
        />
      </main>
      <DetailDialog
        clip={detail}
        more={detail ? moreFromGame(library.clips, detail) : []}
        now={now}
        onClose={() => setDetailId(null)}
        onPlay={play}
        onOpenClip={setDetailId}
        onToggleFavorite={toggleFavorite}
        onAddToCollection={inApp('Dialog „Zur Sammlung hinzufügen“')}
        onEditTags={inApp('Dialog „Tags bearbeiten“')}
      />
      {playing && (
        <PlayerOverlay
          key={playing.id}
          clip={playing}
          startAt={player?.startAt}
          nextClip={nextClipAfter(library.clips, playing.id)}
          onClose={() => setPlayer(null)}
          onNext={(id) => setPlayer({ id })}
          onProgress={(id, seconds, duration) =>
            setState((s) => ({
              ...s,
              progress: {
                ...s.progress,
                [id]: { seconds, duration, updatedAt: new Date(now).toISOString() },
              },
            }))
          }
        />
      )}
      <p role="status" className="stream stream-preview-notice" data-visible={!!notice}>
        {notice}
      </p>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {params.get('modus') === 'app' ? (
      <Suspense fallback={null}>
        <AppPreview />
      </Suspense>
    ) : (
      <SamplePreview />
    )}
  </StrictMode>,
);
