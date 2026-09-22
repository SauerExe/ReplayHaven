import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, FolderPlus, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useVault } from '../data/store';
import { useActions } from '../components/Actions';
import { Artwork, ClipCard, CollectionCard, EmptyState } from '../components/Cards';
import type { Clip } from '../domain/models';
export default function Collections() {
  const { state } = useVault();
  const action = useActions();
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">GUTE MOMENTE GEHÖREN ZUSAMMEN</span>
          <h1>
            Sammlungen<span className="count-badge">{state.collections.length}</span>
          </h1>
          <p>Deine Highlights, so sortiert wie du sie magst.</p>
        </div>
        <button className="button primary" onClick={() => action({ kind: 'create' })}>
          <Plus size={18} />
          Neue Sammlung
        </button>
      </div>
      <div className="collections-grid">
        {state.collections.map((c) => (
          <CollectionCard key={c.id} collection={c} />
        ))}
        <button className="new-collection" onClick={() => action({ kind: 'create' })}>
          <FolderPlus size={29} strokeWidth={1.3} />
          <h3>Platz für neue Geschichten</h3>
          <p>Eine neue Sammlung erstellen</p>
          <Plus size={20} />
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
  return (
    <div className="page">
      <Link className="back-link" to="/collections">
        <ArrowLeft size={17} />
        Alle Sammlungen
      </Link>
      <section className="collection-hero">
        {clips[0] && <Artwork src={clips[0].thumbnail} className="collection-hero-art" />}
        <div className="collection-hero-gradient" />
        <div className="collection-hero-content">
          <span className="eyebrow">DEINE SAMMLUNG · {clips.length} CLIPS</span>
          <h1>{collection.title}</h1>
          <p>{collection.description || 'Hier ist Platz für gute Momente.'}</p>
          <div className="button-row">
            <button
              className="button primary"
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
