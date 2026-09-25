import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Check,
  ChevronDown,
  FolderPlus,
  Film,
  Heart,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useVault } from '../data/store';
import { games } from '../data/seed';
import { filterClips } from '../data/repository';
import { ClipCard, EmptyState } from '../components/Cards';
import { useActions } from '../components/Actions';
import { PageHeading } from '../components/PageHeading';
export default function Library() {
  const { state, patchClip } = useVault();
  const action = useActions();
  const [params, setParams] = useSearchParams();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const set = (key: string, value: string) => {
    setParams(
      (p) => {
        if (value) p.set(key, value);
        else p.delete(key);
        return p;
      },
      { replace: true },
    );
    setSelected([]);
  };
  const clips = filterClips(state.clips, {
    query: params.get('q') || '',
    game: params.get('game') || '',
    favorite: params.get('favorite') === '1',
    tag: params.get('tag') || '',
    period: params.get('period') || '',
    status: params.get('status') || '',
    sort: params.get('sort') || '',
  });
  const active = ['q', 'game', 'favorite', 'tag', 'period', 'status'].some((k) => params.has(k));
  const tags = [...new Set(state.clips.flatMap((c) => c.tags))];
  const selectedIds = selected.filter((id) => clips.some((c) => c.id === id));
  return (
    <div className="page library-page">
      <PageHeading
        eyebrow="DEIN PERSÖNLICHES ARCHIV"
        title="Bibliothek"
        count={state.clips.length}
        description="Jeder Clip ein Moment, der bleibt."
      >
        <button className="button primary" onClick={() => action({ kind: 'upload' })}>
          <Upload size={17} />
          Clip hochladen
        </button>
      </PageHeading>
      <section className="library-controls" aria-label="Clips suchen und filtern">
        <div className="library-toolbar">
          <label className="search-field">
            <Search size={19} />
            <input
              aria-label="Bibliothek durchsuchen"
              placeholder="Clips, Spiele oder Tags suchen …"
              value={params.get('q') || ''}
              onChange={(e) => set('q', e.target.value)}
            />
            {params.get('q') && (
              <button
                className="icon-button"
                aria-label="Suche löschen"
                onClick={() => set('q', '')}
              >
                <X size={15} />
              </button>
            )}
          </label>
          <button
            className={`button filter-toggle ${filtersOpen || active ? 'active' : ''}`}
            onClick={() => setFiltersOpen((v) => !v)}
            aria-expanded={filtersOpen}
          >
            <SlidersHorizontal size={17} />
            Filter
          </button>
          <button
            className={`button secondary selection-toggle ${selecting ? 'active' : ''}`}
            aria-label={selecting ? 'Beenden' : 'Auswählen'}
            aria-pressed={selecting}
            onClick={() => {
              setSelecting(!selecting);
              setSelected([]);
            }}
          >
            {selecting ? <X size={16} /> : <Check size={16} />}
            <span>{selecting ? 'Beenden' : 'Auswählen'}</span>
          </button>
        </div>
        <div className={`filters ${filtersOpen ? 'filters-open' : ''}`}>
          <label className="filter-select">
            <span className="sr-only">Spiel</span>
            <select
              aria-label="Spiel filtern"
              value={params.get('game') || ''}
              onChange={(e) => set('game', e.target.value)}
            >
              <option value="">Alle Spiele</option>
              {state.clips.some((c) => c.server) && (
                <option value="recording">Eigene Aufnahmen</option>
              )}
              {[
                ...new Set(
                  state.clips.filter((c) => c.server && c.gameName).map((c) => c.gameName!),
                ),
              ]
                .sort()
                .map((name) => (
                  <option key={`name:${name}`} value={`name:${name}`}>
                    {name} · Aufnahmen
                  </option>
                ))}
              {games.map((g) => (
                <option value={g.id} key={g.id}>
                  {g.name}
                </option>
              ))}
              {state.clips.some((c) => c.local) && <option value="local">Lokale Videos</option>}
            </select>
            <ChevronDown size={14} />
          </label>
          <button
            className={`filter-chip ${params.has('favorite') ? 'active' : ''}`}
            onClick={() => set('favorite', params.has('favorite') ? '' : '1')}
            aria-pressed={params.has('favorite')}
          >
            <Heart size={15} />
            Favoriten
          </button>
          <label className="filter-select">
            <span className="sr-only">Zeitraum</span>
            <select
              aria-label="Zeitraum filtern"
              value={params.get('period') || ''}
              onChange={(e) => set('period', e.target.value)}
            >
              <option value="">Jederzeit</option>
              <option value="1">Letzte 24 Stunden</option>
              <option value="7">Letzte 7 Tage</option>
              <option value="30">Letzte 30 Tage</option>
            </select>
            <ChevronDown size={14} />
          </label>
          <label className="filter-select">
            <span className="sr-only">Tags</span>
            <select
              aria-label="Tag filtern"
              value={params.get('tag') || ''}
              onChange={(e) => set('tag', e.target.value)}
            >
              <option value="">Alle Tags</option>
              {tags.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <ChevronDown size={14} />
          </label>
          <label className="filter-select">
            <span className="sr-only">Status</span>
            <select
              aria-label="Status filtern"
              value={params.get('status') || ''}
              onChange={(e) => set('status', e.target.value)}
            >
              <option value="">Jeder Status</option>
              <option value="ready">Bereit</option>
              <option value="processing">Verarbeitung</option>
              <option value="error">Fehler</option>
            </select>
            <ChevronDown size={14} />
          </label>
          {active && (
            <button
              className="reset-filters"
              onClick={() => {
                setParams({});
                setSelected([]);
              }}
            >
              <X size={14} />
              Zurücksetzen
            </button>
          )}
        </div>
        <div className="results-header">
          <span>
            <strong>{clips.length}</strong> {clips.length === 1 ? 'Clip' : 'Clips'}
            {active ? ` von ${state.clips.length}` : ' in deiner Bibliothek'}
          </span>
          <label className="sort-select">
            <select
              aria-label="Clips sortieren"
              value={params.get('sort') || 'newest'}
              onChange={(e) => set('sort', e.target.value)}
            >
              <option value="newest">Neueste zuerst</option>
              <option value="oldest">Älteste zuerst</option>
              <option value="title">Titel A–Z</option>
              <option value="duration">Längste zuerst</option>
              <option value="size">Größte zuerst</option>
            </select>
            <ChevronDown size={14} />
          </label>
        </div>
      </section>
      {clips.length ? (
        <div className="clip-grid">
          {clips.map((c) => (
            <ClipCard
              key={c.id}
              clip={c}
              selecting={selecting}
              selected={selectedIds.includes(c.id)}
              onSelect={() =>
                setSelected((s) =>
                  s.includes(c.id) ? s.filter((id) => id !== c.id) : [...s, c.id],
                )
              }
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={active ? Search : Film}
          title={active ? 'Keine Treffer' : 'Noch keine Clips'}
          description={
            active
              ? 'Versuche einen anderen Suchbegriff oder setze die Filter zurück.'
              : 'Lade deine erste Aufnahme in deinen Vault.'
          }
        >
          <button
            className="button secondary"
            onClick={() => (active ? setParams({}) : action({ kind: 'upload' }))}
          >
            {active ? 'Filter zurücksetzen' : 'Clip hinzufügen'}
          </button>
        </EmptyState>
      )}
      {selecting && (
        <div className="bulk-bar" role="toolbar" aria-label="Aktionen für ausgewählte Clips">
          <button
            className="button secondary"
            disabled={clips.length === 0}
            onClick={() =>
              setSelected(selectedIds.length === clips.length ? [] : clips.map((c) => c.id))
            }
          >
            {clips.length > 0 && selectedIds.length === clips.length
              ? 'Alle abwählen'
              : 'Alle auswählen'}
          </button>
          <span className="bulk-count" role="status">
            <strong>{selectedIds.length}</strong> ausgewählt
          </span>
          <button
            className="icon-button"
            disabled={!selectedIds.length}
            aria-label="Auswahl favorisieren"
            onClick={() => selectedIds.forEach((id) => void patchClip(id, { favorite: true }))}
          >
            <Heart size={20} />
          </button>
          <button
            className="icon-button"
            disabled={!selectedIds.length}
            aria-label="Auswahl zu Sammlung hinzufügen"
            onClick={() => action({ kind: 'add', ids: selectedIds })}
          >
            <FolderPlus size={20} />
          </button>
          <button
            className="icon-button destructive"
            disabled={!selectedIds.length}
            aria-label="Auswahl löschen"
            onClick={() => action({ kind: 'delete', ids: selectedIds })}
          >
            <Trash2 size={20} />
          </button>
          <button
            className="icon-button bulk-exit"
            aria-label="Auswahlmodus beenden"
            onClick={() => {
              setSelecting(false);
              setSelected([]);
            }}
          >
            <X size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
