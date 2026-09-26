import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Clock3,
  Film,
  Folder,
  FolderPlus,
  Pencil,
  Play,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useVault } from '../data/store';
import { useActions } from '../components/Actions';
import { Artwork, ClipCard, CollectionCard, EmptyState } from '../components/Cards';
import type { Clip } from '../domain/models';
import { PageHeading } from '../components/PageHeading';
import { time, relativeDate } from '../data/repository';
export default function Collections() {
  const { state } = useVault();
  const action = useActions();
  return (
    <div className="page collections-page">
      <PageHeading
        eyebrow="GUTE MOMENTE GEHÖREN ZUSAMMEN"
        title="Sammlungen"
        count={state.collections.length}
        description="Deine Highlights, so sortiert wie du sie magst."
      >
        <button className="button primary" onClick={() => action({ kind: 'create' })}>
          <Plus size={18} />
          Neue Sammlung
        </button>
      </PageHeading>
      <div className="collections-grid">
        {state.collections.map((c) => (
          <CollectionCard key={c.id} collection={c} />
        ))}
        <button className="new-collection" onClick={() => action({ kind: 'create' })}>
          <span className="collection-create-symbol">
            <FolderPlus size={28} strokeWidth={1.3} />
          </span>
          <span className="collection-create-copy">
            <strong>Die nächste Geschichte gehört dir.</strong>
            <small>Gib deinen Lieblingsmomenten eine eigene Sammlung.</small>
          </span>
          <span className="collection-create-action">
            Sammlung erstellen
            <ArrowRight size={17} />
          </span>
        </button>
      </div>
    </div>
  );
}
export function CollectionDetail() {
  const { id } = useParams();
  const { state, setState } = useVault();
  const action = useActions();
  const collection = state.collections.find((c) => c.id === id);
  if (!collection)
    return (
      <div className="page">
        <EmptyState
          title="Sammlung nicht gefunden"
          description="Diese Sammlung existiert nicht mehr."
        >
          <Link to="/collections" className="button primary">
            Zu den Sammlungen
          </Link>
        </EmptyState>
      </div>
    );
  const clips = collection.clipIds
    .map((id) => state.clips.find((c) => c.id === id))
    .filter((c): c is Clip => !!c);
  const firstPlayable = clips.find((clip) => clip.status === 'ready' && clip.videoSource);
  const duration = clips.reduce((total, clip) => total + clip.duration, 0);
  return (
    <div className="page collection-detail-page">
      <Link className="back-link" to="/collections">
        <ArrowLeft size={17} />
        Alle Sammlungen
      </Link>
      <section className="collection-hero">
        {clips.length > 0 && (
          <div className="collection-filmstrip" aria-hidden="true">
            {clips.slice(0, 3).map((clip, index) => (
              <div key={clip.id}>
                <Artwork
                  src={clip.thumbnail}
                  eager={index === 0}
                  sizes="(max-width: 600px) 100vw, 65vw"
                />
              </div>
            ))}
          </div>
        )}
        <div className="collection-hero-gradient" />
        <div className="collection-hero-content">
          <span className="eyebrow">
            <Folder size={14} />
            DEINE SAMMLUNG
          </span>
          <h1>{collection.title}</h1>
          <p>{collection.description || 'Hier ist Platz für gute Momente.'}</p>
          <div className="collection-facts">
            <span>
              <Film size={14} />
              {clips.length} {clips.length === 1 ? 'Clip' : 'Clips'}
            </span>
            {duration > 0 && (
              <span>
                <Clock3 size={14} />
                {time(duration)} Gesamtlänge
              </span>
            )}
            <span>Aktualisiert: {relativeDate(collection.updatedAt)}</span>
          </div>
          <div className="button-row">
            {firstPlayable && (
              <Link className="button primary" to={`/clips/${firstPlayable.id}`}>
                <Play size={16} fill="currentColor" />
                Ersten Clip öffnen
              </Link>
            )}
            <button
              className={`button ${firstPlayable ? 'secondary' : 'primary'}`}
              onClick={() => action({ kind: 'addClips', id: collection.id })}
            >
              <Plus size={17} />
              Clips hinzufügen
            </button>
            <button
              className="button secondary"
              onClick={() => action({ kind: 'editCollection', id: collection.id })}
            >
              <Pencil size={16} />
              Bearbeiten
            </button>
            <button
              className="icon-button"
              aria-label="Sammlung löschen"
              onClick={() => action({ kind: 'deleteCollection', id: collection.id })}
            >
              <Trash2 size={18} />
            </button>
          </div>
        </div>
      </section>
      {clips.length > 0 && (
        <div className="collection-content-heading">
          <div>
            <span className="eyebrow">MOMENT FÜR MOMENT</span>
            <h2>
              In dieser Sammlung<span>{clips.length}</span>
            </h2>
          </div>
          <Link className="text-link" to="/library">
            Zur Bibliothek
            <ArrowRight size={15} />
          </Link>
        </div>
      )}
      {clips.length ? (
        <div className="clip-grid">
          {clips.map((c) => (
            <div className="collection-clip" key={c.id}>
              <ClipCard clip={c} />
              <button
                className="remove-from-collection"
                onClick={() => {
                  setState((s) => ({
                    ...s,
                    collections: s.collections.map((col) =>
                      col.id === id
                        ? {
                            ...col,
                            clipIds: col.clipIds.filter((cid) => cid !== c.id),
                            updatedAt: new Date().toISOString(),
                          }
                        : col,
                    ),
                  }));
                }}
              >
                <X size={13} />
                Aus Sammlung entfernen
              </button>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title="Der Anfang einer guten Sammlung"
          description="Füge die ersten Clips aus deiner Bibliothek hinzu."
          icon={FolderPlus}
        >
          <button
            className="button secondary"
            onClick={() => action({ kind: 'addClips', id: collection.id })}
          >
            <Plus size={17} />
            Clips hinzufügen
          </button>
        </EmptyState>
      )}
    </div>
  );
}
