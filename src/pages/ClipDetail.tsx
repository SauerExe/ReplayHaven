import { lazy, Suspense, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronDown,
  ExternalLink,
  FolderPlus,
  Heart,
  Pencil,
  Plus,
  Share2,
} from 'lucide-react';
import { games } from '../data/seed';
import { useVault } from '../data/store';
import { bytes } from '../data/repository';
import { ClipMenu, useActions } from '../components/Actions';
import { ClipCard, EmptyState, Section } from '../components/Cards';
import { Brand } from '../components/Layout';
import { AnalysisPanel } from '../components/AnalysisPanel';
const Player = lazy(() => import('../components/Player'));
export default function ClipDetail() {
  const { id } = useParams();
  const { state, patchClip } = useVault();
  const [seekTo, setSeekTo] = useState<{ seconds: number; nonce: number }>();
  const action = useActions();
  const clip = state.clips.find((c) => c.id === id);
  const game = games.find((g) => g.id === clip?.gameId);
  if (!clip)
    return (
      <div className="page">
        <EmptyState
          title="Clip nicht gefunden"
          description="Der Clip wurde entfernt oder ist eine lokale Vorschau aus einer früheren Sitzung."
        >
          <Link to="/library" className="button primary">
            Zur Bibliothek
          </Link>
        </EmptyState>
      </div>
    );
  const related = state.clips.filter(
    (c) =>
      (clip.server && clip.gameName
        ? c.server && c.gameName === clip.gameName
        : c.gameId === clip.gameId) && c.id !== clip.id,
  );
  return (
    <div className="page clip-page">
      <Link className="back-link" to="/library">
        <ArrowLeft size={17} />
        Zur Bibliothek
      </Link>
      <Suspense fallback={<div className="player-skeleton" />}>
        <Player key={clip.id} clip={clip} seekTo={seekTo} />
      </Suspense>
      <div className="clip-detail-heading">
        <div>
          <span className="eyebrow" style={{ color: game?.color }}>
            {game?.name || clip.gameName || 'DEINE AUFNAHME'}
          </span>
          <div className="editable-title">
            <h1>{clip.title}</h1>
            <button
              className="icon-button"
              aria-label="Titel bearbeiten"
              onClick={() => action({ kind: 'rename', id: clip.id })}
            >
              <Pencil size={17} />
            </button>
          </div>
          <p>
            {new Date(clip.recordedAt).toLocaleDateString('de-DE', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
            <span className="metadata-divider">·</span>
            {clip.resolution}
          </p>
        </div>
        <div className="button-row">
          <button
            className={`button secondary ${clip.favorite ? 'is-favorite' : ''}`}
            aria-pressed={clip.favorite}
            onClick={() => patchClip(clip.id, { favorite: !clip.favorite })}
          >
            <Heart size={17} fill={clip.favorite ? 'currentColor' : 'none'} />
            {clip.favorite ? 'Favorit' : 'Favorisieren'}
          </button>
          <button
            className="button secondary"
            onClick={() => action({ kind: 'add', ids: [clip.id] })}
          >
            <FolderPlus size={17} />
            <span>Zur Sammlung</span>
          </button>
          <button
            className="icon-button bordered"
            aria-label="Clip teilen"
            onClick={() => action({ kind: 'share', id: clip.id })}
          >
            <Share2 size={18} />
          </button>
          <ClipMenu clip={clip} />
        </div>
      </div>
      <div className="clip-tags">
        {clip.tags.map((t) => (
          <Link to={`/library?tag=${encodeURIComponent(t)}`} className="tag" key={t}>
            {t}
          </Link>
        ))}
        <button className="text-button" onClick={() => action({ kind: 'tags', id: clip.id })}>
          <Plus size={14} />
          Tags bearbeiten
        </button>
      </div>
      <div className="clip-information">
        <label className="field note-field">
          Deine Notiz
          <textarea
            aria-label="Notiz zum Clip"
            maxLength={2000}
            placeholder="Was diesen Moment besonders macht …"
            value={clip.note}
            onChange={(e) => patchClip(clip.id, { note: e.target.value })}
          />
          <small>Wird automatisch gespeichert</small>
        </label>
        <div className="source-information">
          {clip.local ? (
            <p>Nur in diesem Browser verfügbar – noch nicht auf dem Server gespeichert.</p>
          ) : clip.server ? (
            <>
              <span className="eyebrow">DEIN ORIGINAL</span>
              <p>{clip.originalName}</p>
              <small>Auf deinem Server archiviert · {clip.deviceName}</small>
              <a href={`/api/clips/${clip.id}/download`} download>
                Original herunterladen
              </a>
            </>
          ) : (
            <>
              <span className="eyebrow">VIDEOQUELLE</span>
              <p>{clip.sourceTitle}</p>
              <a href={clip.sourcePage} target="_blank" rel="noreferrer">
                Offizielles Video auf Steam <ExternalLink size={13} />
              </a>
              <small>
                Beispiel-Card mit echtem, extern eingebundenem Spielvideo. Der Kartentitel
                beschreibt nicht den Trailer.
              </small>
            </>
          )}
          <details>
            <summary>
              Technische Informationen <ChevronDown size={15} />
            </summary>
            <dl>
              <div>
                <dt>Quelle</dt>
                <dd>
                  {clip.local
                    ? 'Lokale Datei'
                    : clip.server
                      ? 'Dein Archiv-Server'
                      : 'Steam CDN · HLS'}
                </dd>
              </div>
              <div>
                <dt>Dateigröße</dt>
                <dd>{clip.size ? bytes(clip.size) : 'Externer Stream'}</dd>
              </div>
              <div>
                <dt>Auflösung</dt>
                <dd>{clip.resolution}</dd>
              </div>
              <div>
                <dt>Ursprungsgerät</dt>
                <dd>
                  {clip.local ? 'Dieser Browser' : clip.server ? clip.deviceName : 'Externes Video'}
                </dd>
              </div>
            </dl>
          </details>
        </div>
      </div>
      <AnalysisPanel
        key={`${clip.id}-${clip.analysis?.updatedAt || ''}`}
        clip={clip}
        onSeek={(seconds) => {
          setSeekTo({ seconds, nonce: Date.now() });
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />
      {related.length > 0 && (
        <Section
          title={`Mehr aus ${clip.gameName || game?.name || 'deinen Aufnahmen'}`}
          link={`/library?game=${encodeURIComponent(clip.server && clip.gameName ? `name:${clip.gameName}` : clip.gameId)}`}
        >
          {related.map((c) => (
            <ClipCard clip={c} key={c.id} />
          ))}
        </Section>
      )}
    </div>
  );
}
export function SharePage() {
  const { token } = useParams();
  const { state } = useVault();
  const id = token?.startsWith('preview-') ? token.slice(8) : null;
  const clip = state.clips.find((c) => c.id === id);
  return (
    <div className="share-page">
      <header>
        <Brand linked={false} />
        <span className="demo-label">Lokale Freigabevorschau</span>
      </header>
      {clip ? (
        <main>
          <p className="share-warning">
            Vorschau in diesem Browser · Kein öffentlicher Freigabelink
          </p>
          <Suspense fallback={<div className="player-skeleton" />}>
            <Player key={clip.id} clip={clip} shared />
          </Suspense>
          <span className="eyebrow">
            {games.find((g) => g.id === clip.gameId)?.name || 'LOKALE AUFNAHME'}
          </span>
          <h1>{clip.title}</h1>
          <p>Ein Moment, den man teilen möchte.</p>
        </main>
      ) : (
        <EmptyState
          title="Freigabe nicht verfügbar"
          description="Dieser Link ist ungültig. Lokale Vorschauen funktionieren nur im ursprünglichen Browser."
        />
      )}
      <footer>ReplayHaven · Ein guter Moment bleibt.</footer>
    </div>
  );
}
