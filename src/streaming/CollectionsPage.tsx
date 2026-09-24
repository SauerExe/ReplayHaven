import { useId, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FolderPlus, Layers, Pencil, Play, Plus, Trash2, X } from 'lucide-react';
import { useActions } from '../components/Actions';
import { useVault } from '../data/store';
import { ClipMenu } from './ClipMenu';
import { ClipLayers, useClipLayers, useMinuteClock, useStreamLibrary } from './connected';
import { countLabel, formatTotal, formatUpdated, formatWhen, isNew, titleSize } from './format';
import { GridClipTile } from './GridTile';
import { summarizeCollection } from './library';
import { linkHandler } from './links';
import { Picture } from './Picture';
import { collectionTile, libraryHref } from './rows';
import { CollectionTile } from './Tile';

export function StreamingCollectionsPage() {
  const action = useActions();
  const navigate = useNavigate();
  const now = useMinuteClock();
  const library = useStreamLibrary();
  const byId = useMemo(() => new Map(library.clips.map((c) => [c.id, c])), [library.clips]);

  return (
    <div className="stream stream-page stream-collections">
      <header className="stream-page-head">
        <div className="stream-page-intro">
          <p className="stream-eyebrow">Gute Momente gehören zusammen</p>
          <h1 className="stream-page-title">
            Sammlungen<span className="stream-count">{library.collections.length}</span>
          </h1>
          <p className="stream-page-lead">Deine Highlights, so sortiert wie du sie magst.</p>
        </div>
        <div className="stream-page-actions">
          <button
            type="button"
            className="stream-pill stream-pill--primary"
            onClick={() => action({ kind: 'create' })}
          >
            <Plus size={18} strokeWidth={2.4} aria-hidden="true" />
            <span>Neue Sammlung</span>
          </button>
        </div>
      </header>

      <ul className="stream-collection-grid">
        {library.collections.map((collection) => {
          const summary = summarizeCollection(library, collection);
          const item = {
            ...collectionTile(collection, byId),
            meta: [
              countLabel(summary.clips.length),
              summary.clips.length > 0 && formatTotal(summary.duration),
              collection.updatedAt && formatUpdated(collection.updatedAt, now),
            ]
              .filter(Boolean)
              .join(' · '),
            games: summary.games.slice(0, 4),
          };
          return (
            <li key={collection.id}>
              <CollectionTile item={item} onNavigate={navigate} />
            </li>
          );
        })}
        <li>
          <button
            type="button"
            className="stream-tile stream-tile--new-collection"
            onClick={() => action({ kind: 'create' })}
          >
            <span className="stream-tile-media">
              <FolderPlus size={30} strokeWidth={1.8} aria-hidden="true" />
              <span>Neue Sammlung anlegen</span>
            </span>
          </button>
        </li>
      </ul>
    </div>
  );
}

export function StreamingCollectionDetailPage() {
  const { id } = useParams();
  const { setState, patchClip } = useVault();
  const action = useActions();
  const navigate = useNavigate();
  const now = useMinuteClock();
  const library = useStreamLibrary();
  const layers = useClipLayers();
  const titleId = useId();
  const collection = library.collections.find((c) => c.id === id);

  if (!collection)
    return (
      <div className="stream stream-page">
        <div className="stream-empty stream-empty--inline">
          <span className="stream-empty-icon">
            <Layers size={34} strokeWidth={1.5} aria-hidden="true" />
          </span>
          <h1>Sammlung nicht gefunden</h1>
          <p>Diese Sammlung existiert nicht mehr.</p>
          <a
            className="stream-button stream-button--primary stream-button--compact"
            href="/collections"
            onClick={linkHandler(navigate, '/collections')}
          >
            Zu den Sammlungen
          </a>
        </div>
      </div>
    );

  const collectionId = collection.id;
  const summary = summarizeCollection(library, collection);
  const cover = summary.clips.find((c) => c.thumbnail);
  const first = summary.clips.find((c) => c.status === 'ready') ?? summary.clips[0];
  const meta = [
    countLabel(summary.clips.length),
    summary.clips.length > 0 && formatTotal(summary.duration),
    collection.updatedAt && formatUpdated(collection.updatedAt, now),
  ].filter(Boolean);

  function toggleFavorite(clipId: string) {
    const clip = library.clips.find((c) => c.id === clipId);
    if (clip) void patchClip(clipId, { favorite: !clip.favorite });
  }

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
      <section className="stream-collection-hero" aria-labelledby={titleId}>
        <span className="stream-collection-art" aria-hidden="true">
          {cover && (
            <Picture src={cover.thumbnail} className="stream-hero-img" sizes="100vw" eager />
          )}
        </span>
        <span className="stream-collection-shade" aria-hidden="true" />
        <div className="stream-collection-content">
          <a
            className="stream-back"
            href="/collections"
            onClick={linkHandler(navigate, '/collections')}
          >
            <ArrowLeft size={18} strokeWidth={2.4} aria-hidden="true" />
            Alle Sammlungen
          </a>
          <p className="stream-eyebrow">Sammlung</p>
          <h1 id={titleId} className="stream-hero-title" data-size={titleSize(collection.title)}>
            {collection.title}
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
          <p className="stream-collection-description">
            {collection.description || 'Hier ist Platz für gute Momente.'}
          </p>
          {summary.games.length > 0 && (
            <ul className="stream-game-chips" aria-label="Spiele in dieser Sammlung">
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
          <div className="stream-collection-actions">
            {first && (
              <button
                type="button"
                className="stream-button stream-button--primary"
                onClick={() => layers.open('play', first.id)}
              >
                <Play size={24} fill="currentColor" strokeWidth={0} aria-hidden="true" />
                Abspielen
              </button>
            )}
            <button
              type="button"
              className="stream-button stream-button--secondary"
              onClick={() => action({ kind: 'addClips', id: collectionId })}
            >
              <Plus size={22} strokeWidth={2.4} aria-hidden="true" />
              Clips hinzufügen
            </button>
            <button
              type="button"
              className="stream-round stream-round--large"
              aria-label="Sammlung bearbeiten"
              title="Sammlung bearbeiten"
              onClick={() => action({ kind: 'editCollection', id: collectionId })}
            >
              <Pencil size={20} strokeWidth={2.2} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="stream-round stream-round--large"
              aria-label="Sammlung löschen"
              title="Sammlung löschen"
              onClick={() => action({ kind: 'deleteCollection', id: collectionId })}
            >
              <Trash2 size={20} strokeWidth={2.2} aria-hidden="true" />
            </button>
          </div>
        </div>
      </section>

      {summary.clips.length ? (
        <ul className="stream-grid">
          {summary.clips.map((clip) => (
            <li key={clip.id}>
              <GridClipTile
                clip={clip}
                meta={`${clip.game} · ${formatWhen(clip.recordedAt, now)}`}
                isNew={isNew(clip.recordedAt, now)}
                onOpen={(clipId) => layers.open('clip', clipId)}
                onPlay={(clipId) => layers.open('play', clipId)}
                onToggleFavorite={toggleFavorite}
                menu={
                  <ClipMenu
                    clip={clip}
                    onPlay={(clipId) => layers.open('play', clipId)}
                    onAddToCollection={(clipId) => action({ kind: 'add', ids: [clipId] })}
                    onRename={(clipId) => action({ kind: 'rename', id: clipId })}
                    onEditTags={(clipId) => action({ kind: 'tags', id: clipId })}
                    onShare={(clipId) => action({ kind: 'share', id: clipId })}
                    download
                    pageHref={`/clips/${encodeURIComponent(clip.id)}`}
                    onNavigate={navigate}
                    onDelete={(clipId) => action({ kind: 'delete', ids: [clipId] })}
                  />
                }
                footer={
                  <button
                    type="button"
                    className="stream-tile-remove"
                    aria-label={`${clip.title} aus Sammlung entfernen`}
                    onClick={() => remove(clip.id)}
                  >
                    <X size={14} strokeWidth={2.6} aria-hidden="true" />
                    <span className="stream-wide-only">Aus Sammlung entfernen</span>
                    <span className="stream-narrow-only">Entfernen</span>
                  </button>
                }
              />
            </li>
          ))}
        </ul>
      ) : (
        <div className="stream-empty stream-empty--inline">
          <span className="stream-empty-icon">
            <Layers size={34} strokeWidth={1.5} aria-hidden="true" />
          </span>
          <h2>Der Anfang einer guten Sammlung</h2>
          <p>Füge die ersten Clips aus deiner Bibliothek hinzu.</p>
          <button
            type="button"
            className="stream-button stream-button--secondary stream-button--compact"
            onClick={() => action({ kind: 'addClips', id: collectionId })}
          >
            <Plus size={20} strokeWidth={2.4} aria-hidden="true" />
            Clips hinzufügen
          </button>
        </div>
      )}

      <ClipLayers layers={layers} library={library} now={now} queue={summary.clips} />
    </div>
  );
}
