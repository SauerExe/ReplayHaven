import { Fragment, useId, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Film,
  FolderPlus,
  Heart,
  LayoutGrid,
  Play,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useActions } from '../components/Actions';
import { useVault } from '../data/store';
import { ClipMenu } from './ClipMenu';
import { ClipLayers, useClipLayers, useMinuteClock, useStreamLibrary } from './connected';
import { countLabel, formatTotal, formatWhen, isNew } from './format';
import { GridClipTile } from './GridTile';
import { useScrollPager } from './useScrollPager';
import {
  filterLibrary,
  gameSummary,
  hasFilters,
  readFilters,
  tagOptions,
  type GameSummary,
} from './library';
import { Picture } from './Picture';
import { gameTiles } from './rows';

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <label className="stream-select" data-active={value !== options[0][0]}>
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([option, text]) => (
          <option key={option} value={option}>
            {text}
          </option>
        ))}
      </select>
      <ChevronDown size={15} strokeWidth={2.4} aria-hidden="true" />
    </label>
  );
}

/** Spielinfos wie in „Deine Spiele“, dazu Genre, Erscheinungsdatum und Beschreibung von Steam. */
function GameSpotlight({
  summary,
  onPlay,
  onClear,
}: {
  summary: GameSummary;
  onPlay: () => void;
  onClear: () => void;
}) {
  const titleId = useId();
  const { game } = summary;
  const facts = [
    game.genre,
    game.released && `Erschienen ${game.released}`,
    countLabel(summary.count),
    formatTotal(summary.duration),
  ].filter(Boolean);
  const steam = game.source?.includes('steampowered.com');
  return (
    <section className="stream-spotlight" aria-labelledby={titleId}>
      <span className="stream-spotlight-backdrop" aria-hidden="true">
        <Picture src={summary.cover} className="stream-spotlight-backdrop-img" sizes="60vw" />
      </span>
      <Picture
        src={summary.cover}
        className="stream-spotlight-cover"
        sizes="(max-width: 600px) 96px, 168px"
        alt={`Cover von ${game.name}`}
      />
      <div className="stream-spotlight-body">
        <p className="stream-eyebrow">Spiel</p>
        <h2 id={titleId} className="stream-spotlight-title">
          {game.name}
        </h2>
        <p className="stream-spotlight-facts">
          {facts.map((fact, index) => (
            <Fragment key={index}>
              {index > 0 && (
                <span className="stream-sep" aria-hidden="true">
                  ·
                </span>
              )}
              <span>{fact}</span>
            </Fragment>
          ))}
        </p>
        {game.description && <p className="stream-spotlight-description">{game.description}</p>}
        <div className="stream-spotlight-actions">
          <button
            type="button"
            className="stream-button stream-button--primary stream-button--compact"
            onClick={onPlay}
          >
            <Play size={20} fill="currentColor" strokeWidth={0} aria-hidden="true" />
            Neuesten Clip abspielen
          </button>
          {game.source && (
            <a
              className="stream-button stream-button--secondary stream-button--compact"
              href={game.source}
              target="_blank"
              rel="noreferrer"
            >
              {steam ? 'Auf Steam ansehen' : 'Spielseite öffnen'}
              <ArrowUpRight size={18} strokeWidth={2.4} aria-hidden="true" />
            </a>
          )}
          <button type="button" className="stream-text-button" onClick={onClear}>
            <X size={16} strokeWidth={2.4} aria-hidden="true" />
            Alle Spiele zeigen
          </button>
        </div>
      </div>
    </section>
  );
}

export default function StreamingLibraryPage() {
  const { state, patchClip } = useVault();
  const action = useActions();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const now = useMinuteClock();
  const library = useStreamLibrary();
  const layers = useClipLayers();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const search = params.toString();
  const filters = useMemo(() => readFilters(new URLSearchParams(search)), [search]);
  const active = hasFilters(params);
  const clips = useMemo(
    () => filterLibrary(state.clips, library, filters),
    [state.clips, library, filters],
  );
  const shelf = useMemo(() => gameTiles(library.clips), [library.clips]);
  const shelfPager = useScrollPager(shelf.length);
  const tags = useMemo(() => tagOptions(state.clips), [state.clips]);
  const spotlight = filters.game ? gameSummary(library, filters.game) : null;
  const selectedIds = selected.filter((id) => clips.some((c) => c.id === id));
  const extraFilters = [filters.favorite, filters.period, filters.tag, filters.status].filter(
    Boolean,
  ).length;

  function set(key: string, value: string) {
    setParams(
      (p) => {
        if (value) p.set(key, value);
        else p.delete(key);
        return p;
      },
      { replace: true },
    );
    setSelected([]);
  }

  function reset() {
    setParams({});
    setSelected([]);
  }

  function toggleFavorite(id: string) {
    const clip = library.clips.find((c) => c.id === id);
    if (clip) void patchClip(id, { favorite: !clip.favorite });
  }

  // Im gewählten Spiel stünde überall derselbe Name; dann zählen Datum und Tags.
  const metaFor = (clip: (typeof clips)[number]) =>
    filters.game
      ? [formatWhen(clip.recordedAt, now), ...clip.tags.slice(0, 2)].filter(Boolean).join(' · ')
      : `${clip.game} · ${formatWhen(clip.recordedAt, now)}`;

  return (
    <div className="stream stream-page stream-library">
      <header className="stream-page-head">
        <div className="stream-page-intro">
          <p className="stream-eyebrow">Dein persönliches Archiv</p>
          <h1 className="stream-page-title">
            Bibliothek<span className="stream-count">{state.clips.length}</span>
          </h1>
          <p className="stream-page-lead">Jeder Clip ein Moment, der bleibt.</p>
        </div>
        <div className="stream-page-actions">
          <button
            type="button"
            className="stream-action"
            aria-pressed={selecting}
            onClick={() => {
              setSelecting(!selecting);
              setSelected([]);
            }}
          >
            {selecting ? (
              <X size={17} strokeWidth={2.4} aria-hidden="true" />
            ) : (
              <Check size={17} strokeWidth={2.4} aria-hidden="true" />
            )}
            <span>{selecting ? 'Beenden' : 'Auswählen'}</span>
          </button>
          <button
            type="button"
            className="stream-action stream-action--primary"
            onClick={() => action({ kind: 'upload' })}
          >
            <Upload size={17} strokeWidth={2.4} aria-hidden="true" />
            <span>Clip hochladen</span>
          </button>
        </div>
      </header>

      {shelf.length > 0 && (
        <div className="stream-shelf" role="group" aria-label="Nach Spiel filtern">
          <ul className="stream-shelf-track" ref={shelfPager.trackRef}>
            <li>
              <button
                type="button"
                className="stream-shelf-item stream-shelf-item--all"
                aria-pressed={!filters.game}
                onClick={() => set('game', '')}
              >
                <span className="stream-shelf-media">
                  <LayoutGrid size={30} strokeWidth={1.8} aria-hidden="true" />
                </span>
                <span className="stream-shelf-name">Alle Spiele</span>
                <span className="stream-shelf-count">{countLabel(state.clips.length)}</span>
              </button>
            </li>
            {shelf.map((game) => (
              <li key={game.key}>
                <button
                  type="button"
                  className="stream-shelf-item"
                  aria-pressed={filters.game === game.key}
                  onClick={() => set('game', filters.game === game.key ? '' : game.key)}
                >
                  <span className="stream-shelf-media">
                    <Picture
                      src={game.cover}
                      className="stream-shelf-img"
                      sizes="(max-width: 600px) 84px, 120px"
                    />
                  </span>
                  <span className="stream-shelf-name">{game.name}</span>
                  <span className="stream-shelf-count">{countLabel(game.count)}</span>
                </button>
              </li>
            ))}
          </ul>
          {/* Wie in den Reihen der Startseite: die Knöpfe sind per Tab erreichbar, die Pfeile Mauskomfort. */}
          <button
            type="button"
            className="stream-row-arrow stream-row-arrow--prev stream-shelf-arrow"
            tabIndex={-1}
            aria-label="Spiele: zurück"
            data-visible={shelfPager.edges.start}
            onClick={() => shelfPager.page(-1)}
          >
            <ChevronLeft size={30} strokeWidth={2.5} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="stream-row-arrow stream-row-arrow--next stream-shelf-arrow"
            tabIndex={-1}
            aria-label="Spiele: weiter"
            data-visible={shelfPager.edges.end}
            onClick={() => shelfPager.page(1)}
          >
            <ChevronRight size={30} strokeWidth={2.5} aria-hidden="true" />
          </button>
        </div>
      )}

      {spotlight && (
        <GameSpotlight
          summary={spotlight}
          onPlay={() => layers.open('play', spotlight.newest.id)}
          onClear={() => set('game', '')}
        />
      )}

      <div className="stream-toolbar">
        <label className="stream-search-field">
          <Search size={19} strokeWidth={2.2} aria-hidden="true" />
          <input
            aria-label="Bibliothek durchsuchen"
            placeholder="Clips, Spiele oder Tags suchen …"
            value={params.get('q') || ''}
            onChange={(event) => set('q', event.target.value)}
          />
          {params.get('q') && (
            <button
              type="button"
              className="stream-search-clear"
              aria-label="Suche löschen"
              onClick={() => set('q', '')}
            >
              <X size={16} strokeWidth={2.4} aria-hidden="true" />
            </button>
          )}
        </label>
        <button
          type="button"
          className="stream-action stream-filter-toggle"
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <SlidersHorizontal size={17} strokeWidth={2.4} aria-hidden="true" />
          Filter
          {extraFilters > 0 && <span className="stream-action-count">{extraFilters}</span>}
        </button>
        <div className="stream-filters" data-open={filtersOpen}>
          <button
            type="button"
            className="stream-action"
            aria-pressed={filters.favorite}
            onClick={() => set('favorite', filters.favorite ? '' : '1')}
          >
            <Heart
              size={16}
              strokeWidth={2.4}
              fill={filters.favorite ? 'currentColor' : 'none'}
              aria-hidden="true"
            />
            Favoriten
          </button>
          <FilterSelect
            label="Zeitraum filtern"
            value={filters.period}
            onChange={(value) => set('period', value)}
            options={[
              ['', 'Jederzeit'],
              ['1', 'Letzte 24 Stunden'],
              ['7', 'Letzte 7 Tage'],
              ['30', 'Letzte 30 Tage'],
            ]}
          />
          <FilterSelect
            label="Tag filtern"
            value={filters.tag}
            onChange={(value) => set('tag', value)}
            options={[['', 'Alle Tags'], ...tags.map((tag): [string, string] => [tag, tag])]}
          />
          <FilterSelect
            label="Status filtern"
            value={filters.status}
            onChange={(value) => set('status', value)}
            options={[
              ['', 'Jeder Status'],
              ['ready', 'Bereit'],
              ['processing', 'Verarbeitung'],
              ['error', 'Fehler'],
            ]}
          />
          {active && (
            <button type="button" className="stream-text-button" onClick={reset}>
              <X size={16} strokeWidth={2.4} aria-hidden="true" />
              Zurücksetzen
            </button>
          )}
        </div>
      </div>

      <div className="stream-results">
        <p className="stream-results-count" aria-live="polite">
          {countLabel(clips.length)}
          {active ? ' gefunden' : ''}
        </p>
        <FilterSelect
          label="Clips sortieren"
          value={filters.sort || 'newest'}
          onChange={(value) => set('sort', value === 'newest' ? '' : value)}
          options={[
            ['newest', 'Neueste zuerst'],
            ['oldest', 'Älteste zuerst'],
            ['title', 'Titel A–Z'],
            ['duration', 'Längste zuerst'],
            ['size', 'Größte zuerst'],
          ]}
        />
      </div>

      {clips.length ? (
        <ul className="stream-grid">
          {clips.map((clip) => (
            <li key={clip.id}>
              <GridClipTile
                clip={clip}
                meta={metaFor(clip)}
                isNew={isNew(clip.recordedAt, now)}
                onOpen={(id) => layers.open('clip', id)}
                onPlay={(id) => layers.open('play', id)}
                onToggleFavorite={toggleFavorite}
                selecting={selecting}
                selected={selectedIds.includes(clip.id)}
                onSelect={(id) =>
                  setSelected((ids) =>
                    ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id],
                  )
                }
                menu={
                  <ClipMenu
                    clip={clip}
                    onPlay={(id) => layers.open('play', id)}
                    onAddToCollection={(id) => action({ kind: 'add', ids: [id] })}
                    onRename={(id) => action({ kind: 'rename', id })}
                    onEditTags={(id) => action({ kind: 'tags', id })}
                    onShare={(id) => action({ kind: 'share', id })}
                    download
                    pageHref={`/clips/${encodeURIComponent(clip.id)}`}
                    onNavigate={navigate}
                    onDelete={(id) => action({ kind: 'delete', ids: [id] })}
                  />
                }
              />
            </li>
          ))}
        </ul>
      ) : (
        <div className="stream-empty stream-empty--inline">
          <span className="stream-empty-icon">
            <Film size={34} strokeWidth={1.5} aria-hidden="true" />
          </span>
          <h2>{active ? 'Keine Treffer' : 'Noch keine Clips'}</h2>
          <p>
            {active
              ? 'Versuche einen anderen Suchbegriff oder setze die Filter zurück.'
              : 'Lade deine erste Aufnahme in deinen Vault.'}
          </p>
          <button
            type="button"
            className="stream-button stream-button--secondary stream-button--compact"
            onClick={() => (active ? reset() : action({ kind: 'upload' }))}
          >
            {active ? 'Filter zurücksetzen' : 'Clip hinzufügen'}
          </button>
        </div>
      )}

      {selecting && (
        <div className="stream-bulk">
          <button
            type="button"
            className="stream-action"
            onClick={() =>
              setSelected(selectedIds.length === clips.length ? [] : clips.map((c) => c.id))
            }
          >
            {selectedIds.length === clips.length ? 'Alle abwählen' : 'Alle auswählen'}
          </button>
          <span className="stream-bulk-count" aria-live="polite">
            {selectedIds.length}
            <span className="stream-bulk-label"> ausgewählt</span>
          </span>
          <button
            type="button"
            className="stream-round"
            disabled={!selectedIds.length}
            aria-label="Auswahl favorisieren"
            title="Auswahl favorisieren"
            onClick={() => selectedIds.forEach((id) => void patchClip(id, { favorite: true }))}
          >
            <Heart size={19} strokeWidth={2.2} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="stream-round"
            disabled={!selectedIds.length}
            aria-label="Auswahl zu Sammlung hinzufügen"
            title="Auswahl zu Sammlung hinzufügen"
            onClick={() => action({ kind: 'add', ids: selectedIds })}
          >
            <FolderPlus size={19} strokeWidth={2.2} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="stream-round stream-round--danger"
            disabled={!selectedIds.length}
            aria-label="Auswahl löschen"
            title="Auswahl löschen"
            onClick={() => action({ kind: 'delete', ids: selectedIds })}
          >
            <Trash2 size={19} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      )}

      <ClipLayers layers={layers} library={library} now={now} queue={clips} />
    </div>
  );
}
