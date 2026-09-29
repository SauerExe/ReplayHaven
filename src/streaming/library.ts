import { filterClips } from '../data/repository';
import { compareText, locale } from '../i18n';
import type { Clip } from '../domain/models';
import type { StreamClip, StreamCollection, StreamGame, StreamLibrary } from './model';
import { gameCover, newestFirst } from './rows';

export interface LibraryFilters {
  query: string;
  game: string;
  favorite: boolean;
  tag: string;
  period: string;
  status: string;
  /** Account ID of the uploader, or UNKNOWN_UPLOADER for clips without one. */
  uploader: string;
  sort: string;
}

/** Filter value for clips that name no uploader (older clips, browser uploads). */
export const UNKNOWN_UPLOADER = 'unknown';

/** What "Reset" clears; sorting is not part of it. */
export const FILTER_PARAMS = ['q', 'game', 'favorite', 'tag', 'period', 'status', 'by'] as const;

export function readFilters(params: URLSearchParams): LibraryFilters {
  return {
    query: params.get('q') || '',
    game: params.get('game') || '',
    favorite: params.get('favorite') === '1',
    tag: params.get('tag') || '',
    period: params.get('period') || '',
    status: params.get('status') || '',
    uploader: params.get('by') || '',
    sort: params.get('sort') || '',
  };
}

export function hasFilters(params: URLSearchParams): boolean {
  return FILTER_PARAMS.some((key) => params.has(key));
}

/**
 * Library clips in display order. Filtering and sorting as before (filterClips); search also
 * finds the Steam game name and the genre.
 */
export function filterLibrary(
  raw: Clip[],
  library: StreamLibrary,
  filters: LibraryFilters,
): StreamClip[] {
  const byId = new Map(library.clips.map((clip) => [clip.id, clip]));
  const query = filters.query.toLocaleLowerCase(locale()).trim();
  const direct = query
    ? new Set(filterClips(raw, { query: filters.query }).map((clip) => clip.id))
    : null;
  const byUploader = filters.uploader
    ? raw.filter((clip) => (clip.uploadedBy?.id ?? UNKNOWN_UPLOADER) === filters.uploader)
    : raw;
  return filterClips(byUploader, { ...filters, query: '' })
    .map((clip) => byId.get(clip.id))
    .filter((clip): clip is StreamClip => !!clip)
    .filter(
      (clip) =>
        !direct ||
        direct.has(clip.id) ||
        `${clip.game} ${library.games[clip.gameKey]?.genre ?? ''}`
          .toLocaleLowerCase(locale())
          .includes(query),
    );
}

/** Tags for the filter; it compares against the clip's tags, not the AI's suggestions. */
export function tagOptions(raw: Clip[]): string[] {
  return [...new Set(raw.flatMap((clip) => clip.tags))].sort(compareText);
}

export interface UploaderOptions {
  /** Everyone who uploaded clips, by name. */
  people: { id: string; name: string }[];
  /** Some clips name no uploader, so "Unknown" is offered as well. */
  unknown: boolean;
}

/**
 * People for the "Recorded by" filter, or null when it would not narrow anything down: all clips
 * come from one person, or none names an uploader.
 */
export function uploaderOptions(raw: Clip[]): UploaderOptions | null {
  const names = new Map<string, string>();
  for (const clip of raw) if (clip.uploadedBy) names.set(clip.uploadedBy.id, clip.uploadedBy.name);
  const unknown = raw.some((clip) => !clip.uploadedBy);
  if (names.size < 2 && !(names.size === 1 && unknown)) return null;
  const people = [...names]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => compareText(a.name, b.name));
  return { people, unknown };
}

/**
 * The `?by=` value if it names one of the offered people (or "Unknown"), otherwise '' for
 * everyone, so an outdated link does not leave the home page empty without a chip to undo it.
 */
export function selectedUploader(options: UploaderOptions | null, by: string): string {
  if (!options || !by) return '';
  if (by === UNKNOWN_UPLOADER) return options.unknown ? by : '';
  return options.people.some((person) => person.id === by) ? by : '';
}

/** Clips of one uploader, as the library filters them; '' keeps all. */
export function clipsByUploader(clips: StreamClip[], uploader: string): StreamClip[] {
  if (!uploader) return clips;
  return clips.filter((clip) => (clip.uploaderId ?? UNKNOWN_UPLOADER) === uploader);
}

function totalDuration(clips: StreamClip[]) {
  return clips.reduce((sum, clip) => sum + clip.duration, 0);
}

export interface GameSummary {
  game: StreamGame;
  cover: string;
  count: number;
  /** Total length in seconds. */
  duration: number;
  newest: StreamClip;
}

/** Library header when a game is selected: game info as in "Your games" and more. */
export function gameSummary(library: StreamLibrary, key: string): GameSummary | null {
  const game = library.games[key];
  const clips = newestFirst(library.clips.filter((clip) => clip.gameKey === key));
  if (!game || !clips.length) return null;
  return {
    game,
    cover: game.cover || gameCover(clips),
    count: clips.length,
    duration: totalDuration(clips),
    newest: clips[0],
  };
}

export interface CollectionGame {
  key: string;
  name: string;
  cover: string;
  count: number;
}

export interface CollectionSummary {
  /** In collection order. */
  clips: StreamClip[];
  duration: number;
  /** By number of clips; on a tie, in collection order. */
  games: CollectionGame[];
}

export function summarizeCollection(
  library: StreamLibrary,
  collection: StreamCollection,
): CollectionSummary {
  const byId = new Map(library.clips.map((clip) => [clip.id, clip]));
  const clips = collection.clipIds
    .map((id) => byId.get(id))
    .filter((clip): clip is StreamClip => !!clip);
  const groups = new Map<string, StreamClip[]>();
  for (const clip of clips) {
    if (!clip.gameKey) continue;
    groups.set(clip.gameKey, [...(groups.get(clip.gameKey) ?? []), clip]);
  }
  const games = [...groups]
    .map(([key, list]) => ({
      key,
      name: library.games[key]?.name || list[0].game,
      cover: library.games[key]?.cover || gameCover(list),
      count: list.length,
    }))
    .sort((a, b) => b.count - a.count);
  return { clips, duration: totalDuration(clips), games };
}

/** Next playable clip after `id` in a fixed order, e.g. that of a collection. */
export function nextInQueue(queue: StreamClip[], id: string): StreamClip | null {
  const index = queue.findIndex((clip) => clip.id === id);
  if (index < 0) return null;
  return queue.slice(index + 1).find((clip) => clip.status === 'ready') ?? null;
}
