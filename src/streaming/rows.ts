import { canContinue } from '../data/repository';
import { formatRemaining, formatWhen, isNew } from './format';
import type { StreamClip, StreamCollection, StreamLibrary } from './model';
import { smartCollections, smartHref } from './smart';

export interface ClipTileData {
  clip: StreamClip;
  meta: string;
  isNew: boolean;
  progress?: { percent: number; remaining: string };
}

export interface GameTileData {
  key: string;
  name: string;
  cover: string;
  count: number;
  href: string;
}

export interface CollectionTileData {
  id: string;
  title: string;
  thumbnails: string[];
  count: number;
  href: string;
  /** Ersetzt die Zeile „3 Clips“, etwa auf der Sammlungsseite. */
  meta?: string;
  /** Spiele in der Sammlung, für die kleinen Cover unter dem Titel. */
  games?: { key: string; name: string; cover: string }[];
  /** Markiert automatische Sammlungen. */
  automatic?: boolean;
}

interface RowBase {
  id: string;
  title: string;
  href?: string;
}

export type StreamRow =
  | (RowBase & { kind: 'clips'; variant: 'continue' | 'default'; items: ClipTileData[] })
  | (RowBase & { kind: 'games'; items: GameTileData[] })
  | (RowBase & { kind: 'collections'; items: CollectionTileData[] });

/** Mehr Kacheln pro Reihe bringen auf der Startseite nichts; der Rest liegt in der Bibliothek. */
export const ROW_LIMIT = 20;
const GAME_ROWS = 3;

function timeOf(iso: string) {
  const time = Date.parse(iso);
  return Number.isFinite(time) ? time : 0;
}

function recorded(clip: StreamClip) {
  return timeOf(clip.recordedAt);
}

export function newestFirst(clips: StreamClip[]): StreamClip[] {
  return [...clips].sort((a, b) => recorded(b) - recorded(a));
}

/** Neuester fertige Clip mit KI-Ergebnis, sonst schlicht der neueste. */
export function pickHero(clips: StreamClip[]): StreamClip | null {
  const sorted = newestFirst(clips);
  return sorted.find((c) => c.status === 'ready' && c.hasAnalysis) ?? sorted[0] ?? null;
}

export function libraryHref(gameKey: string): string {
  return `/library?game=${encodeURIComponent(gameKey)}`;
}

interface GameGroup {
  key: string;
  clips: StreamClip[];
}

/** Spiele nach Anzahl Clips, bei Gleichstand das mit dem neueren Clip zuerst. */
function groupByGame(sorted: StreamClip[]): GameGroup[] {
  const groups = new Map<string, StreamClip[]>();
  for (const clip of sorted) {
    if (!clip.gameKey) continue;
    const list = groups.get(clip.gameKey);
    if (list) list.push(clip);
    else groups.set(clip.gameKey, [clip]);
  }
  return [...groups]
    .map(([key, clips]) => ({ key, clips }))
    .sort(
      (a, b) =>
        b.clips.length - a.clips.length ||
        recorded(b.clips[0]) - recorded(a.clips[0]) ||
        a.clips[0].game.localeCompare(b.clips[0].game, 'de'),
    );
}

function slug(value: string) {
  return (
    value
      .toLocaleLowerCase('de')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'spiel'
  );
}

function clipTile(clip: StreamClip, meta: string, now: number, markNew = false): ClipTileData {
  return { clip, meta, isNew: markNew && isNew(clip.recordedAt, now) };
}

/** Cover vom Server oder aus den Beispieldaten, sonst das Vorschaubild eines Clips. */
export function gameCover(clips: StreamClip[]): string {
  return (
    clips.find((c) => c.gameCover)?.gameCover || clips.find((c) => c.thumbnail)?.thumbnail || ''
  );
}

function gameTile(group: GameGroup): GameTileData {
  return {
    key: group.key,
    name: group.clips[0].game,
    cover: gameCover(group.clips),
    count: group.clips.length,
    href: libraryHref(group.key),
  };
}

/** „Deine Spiele“ und die Spieleleiste der Bibliothek: an beiden Stellen dieselben Daten. */
export function gameTiles(clips: StreamClip[]): GameTileData[] {
  return groupByGame(newestFirst(clips)).map(gameTile);
}

export function collectionTile(
  collection: StreamCollection,
  byId: Map<string, StreamClip>,
): CollectionTileData {
  const clips = collection.clipIds.map((id) => byId.get(id)).filter((c): c is StreamClip => !!c);
  return {
    id: collection.id,
    title: collection.title,
    thumbnails: clips
      .map((c) => c.thumbnail)
      .filter(Boolean)
      .slice(0, 3),
    count: clips.length,
    href: `/collections/${encodeURIComponent(collection.id)}`,
  };
}

export function buildRows(
  library: Pick<StreamLibrary, 'clips' | 'collections'>,
  now: number,
): StreamRow[] {
  const sorted = newestFirst(library.clips);
  const when = (clip: StreamClip) => `${clip.game} · ${formatWhen(clip.recordedAt, now)}`;
  const rows: StreamRow[] = [];

  const continuing = sorted
    .filter((c) => c.progress && canContinue(c.progress.seconds, c.progress.duration))
    .sort((a, b) => timeOf(b.progress!.updatedAt) - timeOf(a.progress!.updatedAt))
    .slice(0, ROW_LIMIT);
  rows.push({
    kind: 'clips',
    variant: 'continue',
    id: 'weiterschauen',
    title: 'Weiterschauen',
    items: continuing.map((clip) => {
      const { seconds, duration } = clip.progress!;
      return {
        ...clipTile(clip, `${clip.game} · ${formatRemaining(seconds, duration)}`, now),
        progress: {
          percent: Math.min(100, Math.max(0, (seconds / duration) * 100)),
          remaining: formatRemaining(seconds, duration),
        },
      };
    }),
  });

  rows.push({
    kind: 'clips',
    variant: 'default',
    id: 'neu',
    title: 'Neu hinzugefügt',
    href: '/library',
    items: sorted.slice(0, ROW_LIMIT).map((clip) => clipTile(clip, when(clip), now, true)),
  });

  rows.push({
    kind: 'clips',
    variant: 'default',
    id: 'favoriten',
    title: 'Favoriten',
    href: '/library?favorite=1',
    items: sorted
      .filter((c) => c.favorite)
      .slice(0, ROW_LIMIT)
      .map((clip) => clipTile(clip, when(clip), now)),
  });

  const groups = groupByGame(sorted);
  groups
    .filter((g) => g.clips.length >= 2)
    .slice(0, GAME_ROWS)
    .forEach((group, index) =>
      rows.push({
        kind: 'clips',
        variant: 'default',
        id: `spiel-${index + 1}-${slug(group.key)}`,
        title: group.clips[0].game,
        href: libraryHref(group.key),
        items: group.clips
          .slice(0, ROW_LIMIT)
          .map((clip) =>
            clipTile(
              clip,
              clip.tags.slice(0, 2).join(' · ') || formatWhen(clip.recordedAt, now),
              now,
            ),
          ),
      }),
    );

  rows.push({
    kind: 'games',
    id: 'spiele',
    title: 'Deine Spiele',
    href: '/library',
    items: groups.map(gameTile),
  });

  const byId = new Map(library.clips.map((c) => [c.id, c]));
  rows.push({
    kind: 'collections',
    id: 'sammlungen',
    title: 'Deine Sammlungen',
    href: '/collections',
    items: library.collections.map((collection) => collectionTile(collection, byId)),
  });

  rows.push({
    kind: 'collections',
    id: 'automatisch',
    title: 'Automatisch sortiert',
    href: '/collections',
    items: smartCollections(library.clips).map((collection) => ({
      ...collectionTile(collection, byId),
      href: smartHref(collection.id),
      automatic: true,
    })),
  });

  return rows.filter((row) => row.items.length > 0);
}

/** „Mehr aus <Spiel>“ im Detaildialog. */
export function moreFromGame(clips: StreamClip[], clip: StreamClip, limit = 3): StreamClip[] {
  if (!clip.gameKey) return [];
  return newestFirst(clips.filter((c) => c.gameKey === clip.gameKey && c.id !== clip.id)).slice(
    0,
    limit,
  );
}

/** Nächster Clip im Player: zuerst älter im selben Spiel, sonst der nächste der ganzen Liste. */
export function nextClipAfter(clips: StreamClip[], id: string): StreamClip | null {
  const sorted = newestFirst(clips.filter((c) => c.status === 'ready' || c.id === id));
  const index = sorted.findIndex((c) => c.id === id);
  if (index < 0) return null;
  const current = sorted[index];
  const later = sorted.slice(index + 1);
  return (current.gameKey && later.find((c) => c.gameKey === current.gameKey)) || later[0] || null;
}
