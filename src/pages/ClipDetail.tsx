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
import { useCanEdit } from '../components/AuthGate';
import { bytes } from '../data/repository';
import { ClipMenu, useActions } from '../components/Actions';
import { ClipCard, EmptyState, Section } from '../components/Cards';
import { Brand } from '../components/Layout';
import { AnalysisPanel } from '../components/AnalysisPanel';
import { locale, t, tagLabel } from '../i18n';
const Player = lazy(() => import('../components/Player'));
export default function ClipDetail() {
  const { id } = useParams();
  const { state, patchClip } = useVault();
  const [seekTo, setSeekTo] = useState<{ seconds: number; nonce: number }>();
  const action = useActions();
  const clip = state.clips.find((c) => c.id === id);
  const game = games.find((g) => g.id === clip?.gameId);
  // Plain accounts may watch server clips but not change them.
  const editable = useCanEdit(clip);
  if (!clip)
    return (
      <div className="page">
        <EmptyState
          title={t('pages.clip.notFound.title')}
          description={t('pages.clip.notFound.text')}
        >
          <Link to="/library" className="button primary">
            {t('pages.clip.toLibrary')}
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
        {t('pages.clip.toLibrary')}
      </Link>
      <Suspense fallback={<div className="player-skeleton" />}>
        <Player key={clip.id} clip={clip} seekTo={seekTo} />
      </Suspense>
      <div className="clip-detail-heading">
        <div>
          <span className="eyebrow" style={{ color: game?.color }}>
            {game?.name || clip.gameName || t('pages.clip.yourRecording')}
          </span>
          <div className="editable-title">
            <h1>{clip.title}</h1>
            {editable && (
              <button
                className="icon-button"
                aria-label={t('pages.clip.editTitle')}
                onClick={() => action({ kind: 'rename', id: clip.id })}
              >
                <Pencil size={17} />
              </button>
            )}
          </div>
          <p>
            {new Date(clip.recordedAt).toLocaleDateString(locale(), {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
            <span className="metadata-divider">·</span>
            {clip.resolution}
          </p>
        </div>
        <div className="button-row">
          {editable && (
            <button
              className={`button secondary ${clip.favorite ? 'is-favorite' : ''}`}
              aria-pressed={clip.favorite}
              onClick={() => patchClip(clip.id, { favorite: !clip.favorite })}
            >
              <Heart size={17} fill={clip.favorite ? 'currentColor' : 'none'} />
              {clip.favorite ? t('pages.clip.favorite') : t('pages.clip.addFavorite')}
            </button>
          )}
          <button
            className="button secondary"
            onClick={() => action({ kind: 'add', ids: [clip.id] })}
          >
            <FolderPlus size={17} />
            <span>{t('pages.clip.addToCollection')}</span>
          </button>
          <button
            className="icon-button bordered"
            aria-label={t('pages.clip.share')}
            onClick={() => action({ kind: 'share', id: clip.id })}
          >
            <Share2 size={18} />
          </button>
          <ClipMenu clip={clip} />
        </div>
      </div>
      <div className="clip-tags">
        {clip.tags.map((tag) => (
          <Link to={`/library?tag=${encodeURIComponent(tag)}`} className="tag" key={tag}>
            {tagLabel(tag)}
          </Link>
        ))}
        {editable && (
          <button className="text-button" onClick={() => action({ kind: 'tags', id: clip.id })}>
            <Plus size={14} />
            {t('pages.clip.editTags')}
          </button>
        )}
      </div>
      <div className="clip-information">
        <label className="field note-field">
          {t('pages.clip.note')}
          <textarea
            aria-label={t('pages.clip.noteLabel')}
            maxLength={2000}
            placeholder={t('pages.clip.notePlaceholder')}
            value={clip.note}
            readOnly={!editable}
            onChange={(e) => patchClip(clip.id, { note: e.target.value })}
          />
          {editable && <small>{t('pages.clip.noteSaved')}</small>}
        </label>
        <div className="source-information">
          {clip.local ? (
            <p>{t('pages.clip.localOnly')}</p>
          ) : clip.server ? (
            <>
              <span className="eyebrow">{t('pages.clip.original')}</span>
              <p>{clip.originalName}</p>
              <small>{t('pages.clip.archivedOn', { device: clip.deviceName ?? '' })}</small>
              <a href={`/api/clips/${clip.id}/download`} download>
                {t('pages.clip.downloadOriginal')}
              </a>
            </>
          ) : (
            <>
              <span className="eyebrow">{t('pages.clip.videoSource')}</span>
              <p>{clip.sourceTitle}</p>
              <a href={clip.sourcePage} target="_blank" rel="noreferrer">
                {t('pages.clip.steamVideo')} <ExternalLink size={13} />
              </a>
              <small>{t('pages.clip.sampleNote')}</small>
            </>
          )}
          <details>
            <summary>
              {t('pages.clip.technical')} <ChevronDown size={15} />
            </summary>
            <dl>
              <div>
                <dt>{t('pages.clip.source')}</dt>
                <dd>
                  {clip.local
                    ? t('pages.clip.sourceLocal')
                    : clip.server
                      ? t('pages.clip.sourceServer')
                      : t('pages.clip.sourceSteam')}
                </dd>
              </div>
              <div>
                <dt>{t('pages.clip.fileSize')}</dt>
                <dd>{clip.size ? bytes(clip.size) : t('pages.clip.externalStream')}</dd>
              </div>
              <div>
                <dt>{t('pages.clip.resolution')}</dt>
                <dd>{clip.resolution}</dd>
              </div>
              <div>
                <dt>{t('pages.clip.device')}</dt>
                <dd>
                  {clip.local
                    ? t('pages.clip.thisBrowser')
                    : clip.server
                      ? clip.deviceName
                      : t('pages.clip.externalVideo')}
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
          title={t('pages.clip.moreFrom', {
            game: clip.gameName || game?.name || t('pages.clip.moreFromYours'),
          })}
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
        <span className="demo-label">{t('pages.share.label')}</span>
      </header>
      {clip ? (
        <main>
          <p className="share-warning">{t('pages.share.warning')}</p>
          <Suspense fallback={<div className="player-skeleton" />}>
            <Player key={clip.id} clip={clip} shared />
          </Suspense>
          <span className="eyebrow">
            {games.find((g) => g.id === clip.gameId)?.name || t('pages.share.localRecording')}
          </span>
          <h1>{clip.title}</h1>
          <p>{t('pages.share.tagline')}</p>
        </main>
      ) : (
        <EmptyState
          title={t('pages.share.unavailable.title')}
          description={t('pages.share.unavailable.text')}
        />
      )}
      <footer>{t('pages.share.footer')}</footer>
    </div>
  );
}
