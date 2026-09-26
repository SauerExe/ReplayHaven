import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setLanguage } from '../i18n';
import type { StreamClip, StreamCollection } from './model';
import {
  formatDuration,
  formatRemaining,
  formatSize,
  formatWhen,
  isNew,
  titleSize,
  DAY_MS,
} from './format';
import { buildRows, moreFromGame, nextClipAfter, pickHero, ROW_LIMIT } from './rows';

// These expectations use the German wording; English is covered in i18n.test.ts.
beforeAll(() => setLanguage('de', false));
afterAll(() => setLanguage('en', false));

// Ortszeit statt UTC, damit „Heute“ und „Gestern“ in jeder Zeitzone gleich ausfallen.
const NOW = new Date(2026, 8, 24, 21, 40).getTime();
const at = (daysAgo: number, hours: number, minutes = 0) =>
  new Date(2026, 8, 24 - daysAgo, hours, minutes).toISOString();

function clip(id: string, patch: Partial<StreamClip> = {}): StreamClip {
  return {
    id,
    title: `Clip ${id}`,
    game: 'Counter-Strike 2',
    gameKey: 'cs2',
    thumbnail: `/media/${id}.webp`,
    duration: 54,
    recordedAt: at(1, 12),
    resolution: '1080p',
    size: 0,
    tags: [],
    favorite: false,
    status: 'ready',
    analyzing: false,
    description: '',
    highlights: [],
    hasAnalysis: false,
    ...patch,
  };
}

const collection = (id: string, clipIds: string[]): StreamCollection => ({
  id,
  title: `Sammlung ${id}`,
  clipIds,
});

describe('pickHero', () => {
  it('features the most recently recorded playable clip, analyzed or not', () => {
    const hero = pickHero([
      clip('analyzed-older', { recordedAt: at(3, 20), hasAnalysis: true }),
      clip('processing', { recordedAt: at(0, 21), hasAnalysis: true, status: 'processing' }),
      clip('newest-ready', { recordedAt: at(0, 20) }),
      clip('analyzed', { recordedAt: at(0, 19), hasAnalysis: true }),
    ]);
    expect(hero?.id).toBe('newest-ready');
  });

  it('orders by recording time, not by list or upload order', () => {
    // Dec 2025 first in the list (e.g. uploaded last), newer recordings after it.
    const clips = [
      clip('december', { recordedAt: '2025-12-15T19:12:44.766Z', hasAnalysis: true }),
      clip('september', { recordedAt: '2026-09-16T17:35:07.309Z' }),
      clip('july', { recordedAt: '2026-07-19T11:25:29.478Z', hasAnalysis: true }),
      clip('broken-date', { recordedAt: 'not a date' }),
    ];
    expect(pickHero(clips)?.id).toBe('september');
    const newRow = buildRows({ clips, collections: [] }, NOW).find((row) => row.id === 'neu');
    expect(newRow?.kind === 'clips' && newRow.items.map((item) => item.clip.id)).toEqual([
      'september',
      'july',
      'december',
      'broken-date',
    ]);
  });

  it('falls back to the newest clip when none is playable', () => {
    expect(
      pickHero([
        clip('old', { recordedAt: at(2, 9), status: 'error' }),
        clip('new', { recordedAt: at(0, 9), status: 'processing' }),
      ])?.id,
    ).toBe('new');
    expect(pickHero([])).toBeNull();
  });
});

describe('buildRows', () => {
  it('hält die Reihenfolge der Reihen ein', () => {
    const clips = [
      clip('a', {
        recordedAt: at(0, 21),
        favorite: true,
        progress: { seconds: 13, duration: 54, updatedAt: at(0, 21, 30) },
      }),
      clip('b', { recordedAt: at(0, 20) }),
      clip('c', { game: 'Apex Legends', gameKey: 'apex', recordedAt: at(1, 20) }),
      clip('d', { game: 'Apex Legends', gameKey: 'apex', recordedAt: at(2, 20) }),
    ];
    const rows = buildRows({ clips, collections: [collection('k', ['a', 'c'])] }, NOW);
    expect(rows.map((r) => r.title)).toEqual([
      'Weiterschauen',
      'Neu hinzugefügt',
      'Favoriten',
      'Counter-Strike 2',
      'Apex Legends',
      'Deine Spiele',
      'Deine Sammlungen',
    ]);
    expect(
      rows.find((r) => r.id === 'neu')?.items.map((i) => ('clip' in i ? i.clip.id : '')),
    ).toEqual(['a', 'b', 'c', 'd']);
  });

  it('lässt leere Reihen weg', () => {
    const rows = buildRows(
      {
        clips: [
          clip('a', { progress: { seconds: 1, duration: 54, updatedAt: at(0, 9) } }),
          clip('b', { progress: { seconds: 53, duration: 54, updatedAt: at(0, 9) } }),
          clip('c', { game: 'Elden Ring', gameKey: 'elden' }),
        ],
        collections: [],
      },
      NOW,
    );
    // Kaum angefangen oder fast fertig zählt nicht als „Weiterschauen“; ein einzelner Clip gibt keine Spielreihe.
    expect(rows.map((r) => r.id)).toEqual(['neu', 'spiel-1-cs2', 'spiele']);
    expect(buildRows({ clips: [], collections: [] }, NOW)).toEqual([]);
  });

  it('zeigt höchstens drei Spielreihen, nach Anzahl der Clips', () => {
    const games = [
      ['forza', 'Forza Horizon 5', 2],
      ['elden', 'Elden Ring', 3],
      ['apex', 'Apex Legends', 4],
      ['cyberpunk', 'Cyberpunk 2077', 2],
      ['einzeln', 'Einzelspiel', 1],
    ] as const;
    const clips = games.flatMap(([key, game, count], g) =>
      Array.from({ length: count }, (_, i) =>
        clip(`${key}-${i}`, { game, gameKey: key, recordedAt: at(g, 10 + i) }),
      ),
    );
    const rows = buildRows({ clips, collections: [] }, NOW);
    // Gleichstand bei Forza und Cyberpunk: der neuere Clip gewinnt (Forza heute, Cyberpunk vor 3 Tagen).
    expect(rows.filter((r) => r.id.startsWith('spiel-')).map((r) => r.title)).toEqual([
      'Apex Legends',
      'Elden Ring',
      'Forza Horizon 5',
    ]);
    const spiele = rows.find((r) => r.id === 'spiele');
    expect(spiele?.kind === 'games' && spiele.items.map((g) => [g.name, g.count])).toEqual([
      ['Apex Legends', 4],
      ['Elden Ring', 3],
      ['Forza Horizon 5', 2],
      ['Cyberpunk 2077', 2],
      ['Einzelspiel', 1],
    ]);
    expect(spiele?.kind === 'games' && spiele.items[0].href).toBe('/library?game=apex');
  });

  it('setzt „Neu“ nur unter 24 Stunden und nur in „Neu hinzugefügt“', () => {
    const rows = buildRows(
      {
        clips: [
          clip('grenze', { recordedAt: new Date(NOW - DAY_MS).toISOString(), favorite: true }),
          clip('knapp', {
            recordedAt: new Date(NOW - DAY_MS + 1000).toISOString(),
            favorite: true,
          }),
        ],
        collections: [],
      },
      NOW,
    );
    const neu = rows.find((r) => r.id === 'neu');
    const favoriten = rows.find((r) => r.id === 'favoriten');
    expect(neu?.kind === 'clips' && neu.items.map((i) => [i.clip.id, i.isNew])).toEqual([
      ['knapp', true],
      ['grenze', false],
    ]);
    expect(favoriten?.kind === 'clips' && favoriten.items.some((i) => i.isNew)).toBe(false);
    expect(isNew(new Date(NOW - DAY_MS).toISOString(), NOW)).toBe(false);
    expect(isNew(new Date(NOW - DAY_MS + 1).toISOString(), NOW)).toBe(true);
  });

  it('beschriftet „Weiterschauen“ mit Restzeit und Balken, zuletzt Gesehenes zuerst', () => {
    const rows = buildRows(
      {
        clips: [
          clip('frueher', { progress: { seconds: 20, duration: 40, updatedAt: at(1, 20) } }),
          clip('zuletzt', { progress: { seconds: 13, duration: 54, updatedAt: at(0, 21) } }),
        ],
        collections: [],
      },
      NOW,
    );
    const row = rows[0];
    expect(row.kind === 'clips' && row.variant).toBe('continue');
    if (row.kind !== 'clips') throw new Error('Clip-Reihe erwartet');
    expect(row.items.map((i) => i.clip.id)).toEqual(['zuletzt', 'frueher']);
    expect(row.items[0].meta).toBe('Counter-Strike 2 · noch 0:41');
    expect(row.items[0].progress?.remaining).toBe('noch 0:41');
    expect(row.items[0].progress?.percent).toBeCloseTo(24.07, 1);
  });

  it('baut Spiel-Cover und Sammlungs-Mosaik aus den vorhandenen Bildern', () => {
    const rows = buildRows(
      {
        clips: [
          clip('a', { gameCover: '/cover.webp' }),
          clip('b', { game: 'Elden Ring', gameKey: 'elden', thumbnail: '' }),
          clip('c', { game: 'Elden Ring', gameKey: 'elden', recordedAt: at(3, 9) }),
          clip('d'),
          clip('e'),
        ],
        collections: [collection('k', ['a', 'b', 'c', 'd', 'e']), collection('leer', [])],
      },
      NOW,
    );
    const spiele = rows.find((r) => r.id === 'spiele');
    expect(spiele?.kind === 'games' && spiele.items.map((g) => g.cover)).toEqual([
      '/cover.webp',
      '/media/c.webp',
    ]);
    const sammlungen = rows.find((r) => r.id === 'sammlungen');
    expect(
      sammlungen?.kind === 'collections' &&
        sammlungen.items.map((c) => [c.title, c.count, c.thumbnails, c.href]),
    ).toEqual([
      ['Sammlung k', 5, ['/media/a.webp', '/media/c.webp', '/media/d.webp'], '/collections/k'],
      ['Sammlung leer', 0, [], '/collections/leer'],
    ]);
  });

  it('begrenzt lange Reihen', () => {
    const clips = Array.from({ length: ROW_LIMIT + 5 }, (_, i) => clip(`c${i}`));
    const neu = buildRows({ clips, collections: [] }, NOW).find((r) => r.id === 'neu');
    expect(neu?.items).toHaveLength(ROW_LIMIT);
  });
});

describe('Mehr aus dem Spiel und nächster Clip', () => {
  const clips = [
    clip('a', { recordedAt: at(0, 21) }),
    clip('x', { game: 'Elden Ring', gameKey: 'elden', recordedAt: at(0, 20) }),
    clip('b', { recordedAt: at(1, 21) }),
    clip('c', { recordedAt: at(2, 21), status: 'processing' }),
    clip('d', { recordedAt: at(3, 21) }),
    clip('e', { recordedAt: at(4, 21) }),
  ];

  it('zeigt bis zu drei andere Clips desselben Spiels', () => {
    expect(moreFromGame(clips, clips[0]).map((c) => c.id)).toEqual(['b', 'c', 'd']);
    expect(moreFromGame(clips, clip('lokal', { gameKey: '' }))).toEqual([]);
  });

  it('spielt als Nächstes den älteren fertigen Clip desselben Spiels', () => {
    expect(nextClipAfter(clips, 'a')?.id).toBe('b');
    expect(nextClipAfter(clips, 'b')?.id).toBe('d');
    expect(nextClipAfter(clips, 'x')?.id).toBe('b');
    expect(nextClipAfter(clips, 'e')).toBeNull();
  });
});

describe('Formate', () => {
  it('schreibt Aufnahmezeiten wie im Entwurf', () => {
    expect(formatWhen(at(0, 21, 14), NOW)).toBe('Heute, 21:14');
    expect(formatWhen(at(0, 9, 5), NOW)).toBe('Heute, 09:05');
    expect(formatWhen(at(0, 21, 14), NOW, false)).toBe('Heute');
    expect(formatWhen(at(1, 23, 50), NOW)).toBe('Gestern');
    expect(formatWhen(at(3, 12), NOW)).toBe('Vor 3 Tagen');
    expect(formatWhen(at(10, 12), NOW)).toBe('14. Sept.');
    expect(formatWhen(new Date(2025, 8, 24, 12).toISOString(), NOW)).toBe('24. Sept. 2025');
    expect(formatWhen('kein Datum', NOW)).toBe('');
  });

  it('schreibt Dauer, Restzeit und Größe', () => {
    expect(formatDuration(54)).toBe('0:54');
    expect(formatDuration(72.9)).toBe('1:12');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(Number.NaN)).toBe('0:00');
    expect(formatRemaining(40.4, 54)).toBe('noch 0:14');
    expect(formatRemaining(60, 54)).toBe('noch 0:00');
    expect(formatSize(44669338)).toBe('42,6 MB');
    expect(formatSize(1610612736)).toBe('1,5 GB');
    expect(formatSize(0)).toBe('');
  });

  it('setzt lange Titel eine Stufe kleiner', () => {
    expect(titleSize('Ace auf Inferno')).toBe('short');
    expect(titleSize('Dieser Boss hatte andere Pläne')).toBe('long');
    expect(titleSize('Zur richtigen Zeit am falschen Ort gelandet')).toBe('xlong');
  });
});
