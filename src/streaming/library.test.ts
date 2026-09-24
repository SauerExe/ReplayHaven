import { describe, expect, it } from 'vitest';
import type { Clip, Game, ServerGame } from '../domain/models';
import { formatTotal, formatUpdated } from './format';
import {
  filterLibrary,
  gameSummary,
  nextInQueue,
  readFilters,
  summarizeCollection,
  tagOptions,
} from './library';
import { toStreamLibrary } from './model';
import { buildRows, gameTiles } from './rows';

const NOW = new Date(2026, 8, 24, 21, 40).getTime();
const at = (daysAgo: number, hours: number) => new Date(2026, 8, 24 - daysAgo, hours).toISOString();

const cs2: Game = {
  id: 'cs2',
  name: 'Counter-Strike 2',
  appId: 730,
  color: '#deae71',
  genre: 'Taktik-Shooter',
  cover: '/media/cs2-cover.webp',
  screenshots: [],
  movies: [],
  source: 'https://store.steampowered.com/app/730/',
};

const siege: ServerGame = {
  key: 'rainbow six siege',
  label: 'Rainbow Six Siege',
  name: 'Tom Clancy’s Rainbow Six® Siege',
  genre: 'Action',
  released: '1. Dez. 2015',
  description: 'Taktischer Shooter in zerstörbaren Räumen.',
  source: 'https://store.steampowered.com/app/359550/',
  cover: '/api/games/rainbow%20six%20siege/cover',
};

function clip(id: string, patch: Partial<Clip> = {}): Clip {
  return {
    id,
    title: `Clip ${id}`,
    gameId: 'cs2',
    thumbnail: `/media/${id}.webp`,
    duration: 60,
    recordedAt: at(1, 12),
    size: 0,
    resolution: '1080p',
    tags: [],
    favorite: false,
    status: 'ready',
    note: '',
    ...patch,
  };
}

const server = (id: string, patch: Partial<Clip> = {}) =>
  clip(id, { gameId: 'recording', gameName: 'Rainbow Six Siege', server: true, ...patch });

function setup(clips: Clip[], collections: { id: string; clipIds: string[] }[] = []) {
  const library = toStreamLibrary(
    {
      clips,
      collections: collections.map((c) => ({
        ...c,
        title: `Sammlung ${c.id}`,
        description: '',
        updatedAt: at(0, 9),
      })),
      progress: {},
    },
    { 'Rainbow Six Siege': siege },
    [cs2],
  );
  return { clips, library };
}

const filters = (query: string) => readFilters(new URLSearchParams(query));

describe('Spielinfos der Bibliothek', () => {
  it('nimmt Name, Cover und Steam-Angaben vom Server, sonst aus den Beispieldaten', () => {
    const { library } = setup([
      server('r6'),
      clip('demo'),
      server('ohne-info', { gameName: 'Mein Indie' }),
    ]);
    expect(library.games['name:Rainbow Six Siege']).toEqual({
      key: 'name:Rainbow Six Siege',
      name: 'Tom Clancy’s Rainbow Six® Siege',
      cover: '/api/games/rainbow%20six%20siege/cover',
      genre: 'Action',
      released: '1. Dez. 2015',
      description: 'Taktischer Shooter in zerstörbaren Räumen.',
      source: 'https://store.steampowered.com/app/359550/',
    });
    expect(library.games.cs2).toMatchObject({ name: 'Counter-Strike 2', genre: 'Taktik-Shooter' });
    expect(library.games['name:Mein Indie']).toEqual({
      key: 'name:Mein Indie',
      name: 'Mein Indie',
      cover: undefined,
      genre: undefined,
      released: undefined,
      description: undefined,
      source: undefined,
    });
  });

  it('lässt Clips ohne erkanntes Spiel aus', () => {
    const { library } = setup([clip('lokal', { gameId: 'local' })]);
    expect(library.games).toEqual({});
  });

  it('zeigt in der Spieleleiste dieselben Kacheln wie „Deine Spiele“', () => {
    const { library } = setup([server('a', { recordedAt: at(0, 9) }), server('b'), clip('c')]);
    const home = buildRows(library, NOW).find((row) => row.id === 'spiele');
    expect(gameTiles(library.clips)).toEqual(home?.items);
    expect(gameTiles(library.clips)[0]).toMatchObject({
      name: 'Tom Clancy’s Rainbow Six® Siege',
      cover: '/api/games/rainbow%20six%20siege/cover',
      count: 2,
      href: '/library?game=name%3ARainbow%20Six%20Siege',
    });
  });
});

describe('filterLibrary', () => {
  it('filtert und sortiert wie bisher', () => {
    const { clips, library } = setup([
      clip('alt', { recordedAt: at(3, 9), favorite: true }),
      clip('neu', { recordedAt: at(0, 9), favorite: true }),
      clip('kein-favorit'),
      server('r6', { favorite: true }),
    ]);
    const ids = (query: string) => filterLibrary(clips, library, filters(query)).map((c) => c.id);
    expect(ids('game=cs2&favorite=1')).toEqual(['neu', 'alt']);
    expect(ids('game=cs2&favorite=1&sort=oldest')).toEqual(['alt', 'neu']);
    expect(ids('game=name%3ARainbow+Six+Siege')).toEqual(['r6']);
  });

  it('findet Clips auch über den Steam-Namen und das Genre des Spiels', () => {
    const { clips, library } = setup([server('r6'), clip('demo', { title: 'Ace auf Inferno' })]);
    const ids = (query: string) => filterLibrary(clips, library, filters(query)).map((c) => c.id);
    expect(ids('q=tom+clancy')).toEqual(['r6']);
    expect(ids('q=taktik')).toEqual(['demo']);
    expect(ids('q=INFERNO')).toEqual(['demo']);
    expect(ids('q=gibt+es+nicht')).toEqual([]);
  });

  it('bietet die Tags am Clip zum Filtern an, alphabetisch', () => {
    const { clips } = setup([clip('a', { tags: ['Clutch', 'Ace'] }), clip('b', { tags: ['Ace'] })]);
    expect(tagOptions(clips)).toEqual(['Ace', 'Clutch']);
  });
});

describe('gameSummary', () => {
  it('fasst ein Spiel zusammen: Anzahl, Gesamtlänge, neuester Clip', () => {
    const { library } = setup([
      server('alt', { recordedAt: at(2, 9), duration: 30 }),
      server('neu', { recordedAt: at(0, 9), duration: 90 }),
      clip('anderes-spiel'),
    ]);
    const summary = gameSummary(library, 'name:Rainbow Six Siege');
    expect(summary).toMatchObject({ count: 2, duration: 120, cover: siege.cover });
    expect(summary?.newest.id).toBe('neu');
    expect(summary?.game.released).toBe('1. Dez. 2015');
  });

  it('nimmt ohne Cover ein Vorschaubild und kennt keine leeren Spiele', () => {
    const { library } = setup([server('x', { gameName: 'Mein Indie' })]);
    expect(gameSummary(library, 'name:Mein Indie')?.cover).toBe('/media/x.webp');
    expect(gameSummary(library, 'cs2')).toBeNull();
  });
});

describe('summarizeCollection', () => {
  it('hält die Reihenfolge der Sammlung und zählt Spiele', () => {
    const { library } = setup(
      [clip('a', { duration: 20 }), server('b', { duration: 40 }), server('c'), clip('d')],
      [{ id: 'k', clipIds: ['b', 'a', 'geloescht', 'c'] }],
    );
    const summary = summarizeCollection(library, library.collections[0]);
    expect(summary.clips.map((c) => c.id)).toEqual(['b', 'a', 'c']);
    expect(summary.duration).toBe(120);
    expect(summary.games).toEqual([
      {
        key: 'name:Rainbow Six Siege',
        name: 'Tom Clancy’s Rainbow Six® Siege',
        cover: siege.cover,
        count: 2,
      },
      { key: 'cs2', name: 'Counter-Strike 2', cover: '/media/cs2-cover.webp', count: 1 },
    ]);
  });
});

describe('nextInQueue', () => {
  it('spielt in der vorgegebenen Reihenfolge weiter und überspringt Unfertiges', () => {
    const { library } = setup([
      clip('a'),
      clip('b', { status: 'processing' }),
      clip('c'),
      clip('d'),
    ]);
    const queue = ['a', 'b', 'c'].map((id) => library.clips.find((c) => c.id === id)!);
    expect(nextInQueue(queue, 'a')?.id).toBe('c');
    expect(nextInQueue(queue, 'c')).toBeNull();
    expect(nextInQueue(queue, 'd')).toBeNull();
  });
});

describe('Gesamtlänge und Änderungsdatum', () => {
  it('schreibt Längen in Sekunden, Minuten oder Stunden', () => {
    expect(formatTotal(45)).toBe('45 Sek.');
    expect(formatTotal(150)).toBe('3 Min.');
    expect(formatTotal(3900)).toBe('1 Std. 5 Min.');
    expect(formatTotal(7200)).toBe('2 Std.');
    expect(formatTotal(Number.NaN)).toBe('0 Sek.');
  });

  it('beginnt klein, wo es mitten im Satz steht', () => {
    expect(formatUpdated(at(0, 9), NOW)).toBe('aktualisiert heute');
    expect(formatUpdated(at(3, 9), NOW)).toBe('aktualisiert vor 3 Tagen');
    expect(formatUpdated(at(40, 9), NOW)).toMatch(/^aktualisiert am \d+\. /);
  });
});
