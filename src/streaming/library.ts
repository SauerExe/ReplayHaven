import { filterClips } from '../data/repository';
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
  sort: string;
}

/** Was „Zurücksetzen“ zurücknimmt; die Sortierung gehört nicht dazu. */
export const FILTER_PARAMS = ['q', 'game', 'favorite', 'tag', 'period', 'status'] as const;

export function readFilters(params: URLSearchParams): LibraryFilters {
  return {
    query: params.get('q') || '',
    game: params.get('game') || '',
    favorite: params.get('favorite') === '1',
    tag: params.get('tag') || '',
    period: params.get('period') || '',
    status: params.get('status') || '',
    sort: params.get('sort') || '',
  };
}

export function hasFilters(params: URLSearchParams): boolean {
  return FILTER_PARAMS.some((key) => params.has(key));
}

/**
 * Clips der Bibliothek in Anzeigereihenfolge. Filter und Sortierung wie bisher (filterClips);
 * die Suche findet zusätzlich den Spielnamen von Steam und das Genre.
 */
export function filterLibrary(
  raw: Clip[],
  library: StreamLibrary,
  filters: LibraryFilters,
): StreamClip[] {
  const byId = new Map(library.clips.map((clip) => [clip.id, clip]));
  const query = filters.query.toLocaleLowerCase('de').trim();
  const direct = query
    ? new Set(filterClips(raw, { query: filters.query }).map((clip) => clip.id))
    : null;
  return filterClips(raw, { ...filters, query: '' })
    .map((clip) => byId.get(clip.id))
    .filter((clip): clip is StreamClip => !!clip)
    .filter(
      (clip) =>
        !direct ||
        direct.has(clip.id) ||
        `${clip.game} ${library.games[clip.gameKey]?.genre ?? ''}`
          .toLocaleLowerCase('de')
          .includes(query),
    );
}

/** Tags für den Filter; er vergleicht mit den Tags am Clip, nicht mit den Vorschlägen der KI. */
export function tagOptions(raw: Clip[]): string[] {
  return [...new Set(raw.flatMap((clip) => clip.tags))].sort((a, b) => a.localeCompare(b, 'de'));
}

function totalDuration(clips: StreamClip[]) {
  return clips.reduce((sum, clip) => sum + clip.duration, 0);
}

export interface GameSummary {
  game: StreamGame;
  cover: string;
  count: number;
  /** Gesamtlänge in Sekunden. */
  duration: number;
  newest: StreamClip;
}

/** Kopf der Bibliothek, wenn ein Spiel gewählt ist: Spielinfos wie in „Deine Spiele“ und mehr. */
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
  /** In der Reihenfolge der Sammlung. */
  clips: StreamClip[];
  duration: number;
  /** Nach Anzahl Clips, bei Gleichstand in der Reihenfolge der Sammlung. */
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

/** Nächster abspielbarer Clip nach `id` in einer festen Reihenfolge, etwa der einer Sammlung. */
export function nextInQueue(queue: StreamClip[], id: string): StreamClip | null {
  const index = queue.findIndex((clip) => clip.id === id);
  if (index < 0) return null;
  return queue.slice(index + 1).find((clip) => clip.status === 'ready') ?? null;
}
