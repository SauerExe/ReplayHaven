import { useId, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  FolderPlus,
  Layers,
  Pencil,
  Play,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useActions } from '../components/Actions';
import { useIsAdmin } from '../components/AuthGate';
import { t } from '../i18n';
import { createId } from '../data/id';
import { useVault } from '../data/store';
import { ClipMenu } from './ClipMenu';
import {
  ClipLayers,
  useClipLayers,
  useMinuteClock,
  useStreamLibrary,
  type ClipLayerControls,
} from './connected';
import { countLabel, formatTotal, formatUpdated, formatWhen, isNew, titleSize } from './format';
import { GridClipTile } from './GridTile';
import { summarizeCollection, type CollectionSummary } from './library';
import { linkHandler } from './links';
import { Picture } from './Picture';
import { collectionTile, libraryHref, type CollectionTileData } from './rows';
import type { StreamClip, StreamCollection } from './model';
import { SMART_RULES, smartCollection, smartCollections, smartHref } from './smart';
import { CollectionTile } from './Tile';

export function StreamingCollectionsPage() {
  const action = useActions();
  const navigate = useNavigate();
  const now = useMinuteClock();
  const library = useStreamLibrary();
  const ownId = useId();
  const smartId = useId();
  const byId = useMemo(() => new Map(library.clips.map((c) => [c.id, c])), [library.clips]);
  const smart = useMemo(() => smartCollections(library.clips), [library.clips]);

  function tile(collection: StreamCollection, href?: string): CollectionTileData {
    const summary = summarizeCollection(library, collection);
    return {
      ...collectionTile(collection, byId),
      ...(href ? { href, automatic: true } : {}),
      meta: [
        countLabel(summary.clips.length),
        summary.clips.length > 0 ? formatTotal(summary.duration) : '',
        collection.updatedAt ? formatUpdated(collection.updatedAt, now) : '',
      ]
        .filter(Boolean)
        .join(' · '),
      games: summary.games.slice(0, 4),
    };
  }

  return (
    <div className="stream stream-page stream-collections">
      <header className="stream-page-head">
        <div className="stream-page-intro">
          <p className="stream-eyebrow">{t('collections.eyebrow')}</p>
          <h1 className="stream-page-title">
            {t('collections.title')}
            <span className="stream-count">{library.collections.length}</span>
          </h1>
          <p className="stream-page-lead">{t('collections.lead')}</p>
        </div>
        <div className="stream-page-actions">
          <button
            type="button"
            className="stream-action stream-action--primary"
            onClick={() => action({ kind: 'create' })}
          >
            <Plus size={18} strokeWidth={2.4} aria-hidden="true" />
            <span>{t('collections.new')}</span>
          </button>
        </div>
      </header>

      <section className="stream-page-section" aria-labelledby={ownId}>
        <h2 id={ownId} className="stream-section-title">
          {t('collections.own')}
        </h2>
        <ul className="stream-collection-grid">
          {library.collections.map((collection) => (
            <li key={collection.id}>
              <CollectionTile item={tile(collection)} onNavigate={navigate} />
            </li>
          ))}
          <li>
            <button
              type="button"
              className="stream-tile stream-tile--new-collection"
              onClick={() => action({ kind: 'create' })}
            >
              <span className="stream-tile-media">
                <FolderPlus size={30} strokeWidth={1.8} aria-hidden="true" />
                <span>{t('collections.create')}</span>
              </span>
            </button>
          </li>
        </ul>
      </section>

      {smart.length > 0 && (
        <section className="stream-page-section" aria-labelledby={smartId}>
          <div className="stream-section-intro">
            <h2 id={smartId} className="stream-section-title">
              {t('collections.smart.title')}
            </h2>
            <p>{t('collections.smart.lead')}</p>
          </div>
          <ul className="stream-collection-grid">
            {smart.map((collection) => (
              <li key={collection.id}>
                <CollectionTile
                  item={tile(collection, smartHref(collection.id))}
                  onNavigate={navigate}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Collection header: artwork, title, stats, games and the page's own buttons. */
function CollectionHero({
  eyebrow,
  title,
  description,
  meta,
  summary,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  meta: string[];
  summary: CollectionSummary;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const titleId = useId();
  const cover = summary.clips.find((c) => c.thumbnail);
  return (
    <section className="stream-collection-hero" aria-labelledby={titleId}>
      <span className="stream-collection-art" aria-hidden="true">
        {cover && <Picture src={cover.thumbnail} className="stream-hero-img" sizes="100vw" eager />}
      </span>
      <span className="stream-collection-shade" aria-hidden="true" />
      <div className="stream-collection-content">
        <a
          className="stream-back"
          href="/collections"
          onClick={linkHandler(navigate, '/collections')}
        >
          <ArrowLeft size={18} strokeWidth={2.4} aria-hidden="true" />
          {t('collections.back')}
        </a>
        <p className="stream-eyebrow">{eyebrow}</p>
        <h1 id={titleId} className="stream-hero-title" data-size={titleSize(title)}>
          {title}
        </h1>
        <p className="stream-collection-meta">
          {meta.map((part, index) => (
            <span key={index}>
              {index > 0 && (
                <span className="stream-sep" aria-hidden="true">
                  {' · '}
                </span>
              )}
              {part}
            </span>
          ))}
        </p>
        <p className="stream-collection-description">{description}</p>
        {summary.games.length > 0 && (
          <ul className="stream-game-chips" aria-label={t('collections.games')}>
            {summary.games.map((game) => (
              <li key={game.key}>
                <a
                  className="stream-game-chip"
                  href={libraryHref(game.key)}
                  onClick={linkHandler(navigate, libraryHref(game.key))}
                >
                  <Picture src={game.cover} className="stream-game-chip-img" sizes="40px" />
                  <span>{game.name}</span>
                  <span className="stream-game-chip-count">{countLabel(game.count)}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
        <div className="stream-collection-actions">{children}</div>
      </div>
    </section>
  );
}

function PlayButton({ clips, layers }: { clips: StreamClip[]; layers: ClipLayerControls }) {
  const first = clips.find((c) => c.status === 'ready') ?? clips[0];
  if (!first) return null;
  return (
    <button
      type="button"
      className="stream-button stream-button--primary"
      onClick={() => layers.open('play', first.id)}
    >
      <Play size={24} fill="currentColor" strokeWidth={0} aria-hidden="true" />
      {t('collections.play')}
    </button>
  );
}

/** A collection's clips as a grid, with a menu and an optional button under each tile. */
function CollectionGrid({
  clips,
  now,
  layers,
  footer,
}: {
  clips: StreamClip[];
  now: number;
  layers: ClipLayerControls;
  footer?: (clip: StreamClip) => ReactNode;
}) {
  const { patchClip } = useVault();
  const action = useActions();
  const navigate = useNavigate();
  // Plain accounts may not change clips; collections themselves live in this browser.
  const admin = useIsAdmin();

  function toggleFavorite(clipId: string) {
    const clip = clips.find((c) => c.id === clipId);
    if (clip) void patchClip(clipId, { favorite: !clip.favorite });
  }

  return (
    <ul className="stream-grid">
      {clips.map((clip) => (
        <li key={clip.id}>
          <GridClipTile
            clip={clip}
            meta={`${clip.game} · ${formatWhen(clip.recordedAt, now)}`}
            isNew={isNew(clip.recordedAt, now)}
            onOpen={(clipId) => layers.open('clip', clipId)}
            onPlay={(clipId) => layers.open('play', clipId)}
            onToggleFavorite={admin ? toggleFavorite : undefined}
            menu={
              <ClipMenu
                clip={clip}
                onPlay={(clipId) => layers.open('play', clipId)}
                onAddToCollection={(clipId, opener) =>
                  action({ kind: 'add', ids: [clipId] }, opener)
                }
                onRename={
                  admin
                    ? (clipId, opener) => action({ kind: 'rename', id: clipId }, opener)
                    : undefined
                }
                onEditTags={
                  admin
                    ? (clipId, opener) => action({ kind: 'tags', id: clipId }, opener)
                    : undefined
                }
                onShare={(clipId, opener) => action({ kind: 'share', id: clipId }, opener)}
                download
                pageHref={`/clips/${encodeURIComponent(clip.id)}`}
                onNavigate={navigate}
                onDelete={
                  admin
                    ? (clipId, opener) => action({ kind: 'delete', ids: [clipId] }, opener)
                    : undefined
                }
              />
            }
            footer={footer?.(clip)}
          />
        </li>
      ))}
    </ul>
  );
}

function NotFound({ title, text }: { title: string; text: string }) {
  const navigate = useNavigate();
  return (
    <div className="stream stream-page">
      <div className="stream-empty stream-empty--inline">
        <span className="stream-empty-icon">
          <Layers size={34} strokeWidth={1.5} aria-hidden="true" />
        </span>
        <h1>{title}</h1>
        <p>{text}</p>
        <a
          className="stream-button stream-button--primary stream-button--compact"
          href="/collections"
          onClick={linkHandler(navigate, '/collections')}
        >
          {t('collections.toCollections')}
        </a>
      </div>
    </div>
  );
}

export function StreamingCollectionDetailPage() {
  const { id } = useParams();
  const { setState } = useVault();
  const action = useActions();
  const now = useMinuteClock();
  const library = useStreamLibrary();
  const layers = useClipLayers();
  const collection = library.collections.find((c) => c.id === id);

  if (!collection)
    return <NotFound title={t('collections.notFound')} text={t('collections.notFound.text')} />;

  const collectionId = collection.id;
  const summary = summarizeCollection(library, collection);
  const meta = [
    countLabel(summary.clips.length),
    summary.clips.length > 0 ? formatTotal(summary.duration) : '',
    collection.updatedAt ? formatUpdated(collection.updatedAt, now) : '',
  ].filter(Boolean);

  function remove(clipId: string) {
    setState((s) => ({
      ...s,
      collections: s.collections.map((c) =>
        c.id === collectionId
          ? {
              ...c,
              clipIds: c.clipIds.filter((other) => other !== clipId),
              updatedAt: new Date().toISOString(),
            }
          : c,
      ),
    }));
  }

  return (
    <div className="stream stream-page stream-collection-page">
      <CollectionHero
        eyebrow={t('collections.detail.eyebrow')}
        title={collection.title}
        description={collection.description || t('collections.detail.description')}
        meta={meta}
        summary={summary}
      >
        <PlayButton clips={summary.clips} layers={layers} />
        <button
          type="button"
          className="stream-button stream-button--secondary"
          onClick={() => action({ kind: 'addClips', id: collectionId })}
        >
          <Plus size={22} strokeWidth={2.4} aria-hidden="true" />
          {t('collections.detail.addClips')}
        </button>
        <button
          type="button"
          className="stream-round stream-round--large"
          aria-label={t('collections.detail.edit')}
          title={t('collections.detail.edit')}
          onClick={() => action({ kind: 'editCollection', id: collectionId })}
        >
          <Pencil size={20} strokeWidth={2.2} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="stream-round stream-round--large"
          aria-label={t('collections.detail.delete')}
          title={t('collections.detail.delete')}
          onClick={() => action({ kind: 'deleteCollection', id: collectionId })}
        >
          <Trash2 size={20} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </CollectionHero>

      {summary.clips.length ? (
        <CollectionGrid
          clips={summary.clips}
          now={now}
          layers={layers}
          footer={(clip) => (
            <button
              type="button"
              className="stream-tile-remove"
              aria-label={t('collections.detail.removeLabel', { title: clip.title })}
              onClick={() => remove(clip.id)}
            >
              <X size={14} strokeWidth={2.6} aria-hidden="true" />
              <span className="stream-wide-only">{t('collections.detail.remove')}</span>
              <span className="stream-narrow-only">{t('collections.detail.removeShort')}</span>
            </button>
          )}
        />
      ) : (
        <div className="stream-empty stream-empty--inline">
          <span className="stream-empty-icon">
            <Layers size={34} strokeWidth={1.5} aria-hidden="true" />
          </span>
          <h2>{t('collections.detail.emptyTitle')}</h2>
          <p>{t('collections.detail.emptyText')}</p>
          <button
            type="button"
            className="stream-button stream-button--secondary stream-button--compact"
            onClick={() => action({ kind: 'addClips', id: collectionId })}
          >
            <Plus size={20} strokeWidth={2.4} aria-hidden="true" />
            {t('collections.detail.addClips')}
          </button>
        </div>
      )}

      <ClipLayers layers={layers} library={library} now={now} queue={summary.clips} />
    </div>
  );
}

/** An automatic collection: its content follows the tags; it can be saved as a fixed copy. */
export function StreamingSmartCollectionPage() {
  const { id } = useParams();
  const { setState } = useVault();
  const navigate = useNavigate();
  const now = useMinuteClock();
  const library = useStreamLibrary();
  const layers = useClipLayers();
  const rule = SMART_RULES.find((r) => r.id === id);

  if (!rule)
    return (
      <NotFound title={t('collections.notFound')} text={t('collections.notFound.smartText')} />
    );

  const { title, description, examples } = rule;
  const smart = smartCollection(library.clips, rule);
  const summary = summarizeCollection(library, smart);
  const count = summary.clips.length;
  const meta = [
    countLabel(count),
    count > 0 ? formatTotal(summary.duration) : '',
    smart.updatedAt ? formatUpdated(smart.updatedAt, now) : '',
  ].filter(Boolean);
  const tags = examples.map((tag) => t('collections.smart.tag', { tag })).join(', ');

  const save = () => {
    const newId = createId();
    setState((s) => ({
      ...s,
      collections: [
        ...s.collections,
        {
          id: newId,
          title,
          description,
          clipIds: smart.clipIds,
          updatedAt: new Date().toISOString(),
        },
      ],
    }));
    navigate(`/collections/${newId}`);
  };

  return (
    <div className="stream stream-page stream-collection-page">
      <CollectionHero
        eyebrow={t('collections.smart.eyebrow')}
        title={title}
        description={description}
        meta={meta}
        summary={summary}
      >
        <PlayButton clips={summary.clips} layers={layers} />
        {count > 0 && (
          <button type="button" className="stream-button stream-button--secondary" onClick={save}>
            <FolderPlus size={22} strokeWidth={2.2} aria-hidden="true" />
            {t('collections.smart.save')}
          </button>
        )}
      </CollectionHero>

      <p className="stream-smart-note">
        <Sparkles size={18} strokeWidth={2.2} aria-hidden="true" />
        <span>
          {t('collections.smart.note', {
            tags,
            titles: rule.titles ? t('collections.smart.noteTitles') : '',
          })}
        </span>
      </p>

      {count ? (
        <CollectionGrid clips={summary.clips} now={now} layers={layers} />
      ) : (
        <div className="stream-empty stream-empty--inline">
          <span className="stream-empty-icon">
            <Sparkles size={34} strokeWidth={1.5} aria-hidden="true" />
          </span>
          <h2>{t('collections.smart.emptyTitle')}</h2>
          <p>{t('collections.smart.emptyText', { tags })}</p>
          <a
            className="stream-button stream-button--secondary stream-button--compact"
            href="/library"
            onClick={linkHandler(navigate, '/library')}
          >
            {t('collections.smart.toLibrary')}
          </a>
        </div>
      )}

      <ClipLayers layers={layers} library={library} now={now} queue={summary.clips} />
    </div>
  );
}
