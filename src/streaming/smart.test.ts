import { describe, expect, it } from 'vitest';
import type { StreamClip } from './model';
import { buildRows } from './rows';
import { SMART_RULES, matchesRule, smartCollections, smartHref, tagKey } from './smart';

const NOW = new Date(2026, 8, 24, 21, 40).getTime();
const at = (hoursAgo: number) => new Date(NOW - hoursAgo * 3600000).toISOString();

function clip(id: string, patch: Partial<StreamClip> = {}): StreamClip {
  return {
    id,
    title: `Clip ${id}`,
    game: 'Counter-Strike 2',
    gameKey: 'cs2',
    thumbnail: `/media/${id}.webp`,
    duration: 30,
    recordedAt: at(10),
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

/** In welche automatischen Sammlungen ein einzelner Clip fiele. */
const rulesFor = (patch: Partial<StreamClip>) =>
  SMART_RULES.filter((rule) => matchesRule(rule, clip('x', patch))).map((rule) => rule.id);

describe('tagKey', () => {
  it('vergleicht ohne Groß- und Kleinschreibung, Leer- und Satzzeichen', () => {
    expect(tagKey('No-Scope')).toBe('noscope');
    expect(tagKey('Triple Kill')).toBe('triplekill');
    expect(tagKey('1 gegen 3')).toBe('1gegen3');
    expect(tagKey('Kopfschüsse')).toBe('kopfschüsse');
    expect(tagKey('Bosskampf!')).toBe('bosskampf');
  });
});

describe('matchesRule', () => {
  it('ordnet die festen Tags des Windows-Clients zu', () => {
    expect(rulesFor({ tags: ['Kill', 'Multikill', 'Ace'] })).toEqual(['aces', 'mehrfach-kills']);
    expect(rulesFor({ tags: ['Clutch', 'Rundensieg'] })).toEqual(['clutches']);
    expect(rulesFor({ tags: ['Kill', 'Headshot'] })).toEqual(['headshots']);
    expect(rulesFor({ tags: ['Sieg'] })).toEqual(['gewonnen']);
  });

  it('lässt gewöhnliche Runden, Tode und Rainbow Six Siege außen vor', () => {
    expect(rulesFor({ tags: ['Rundensieg', 'Tod', 'Kill', 'Runde verloren'] })).toEqual([]);
    expect(rulesFor({ tags: ['Siege'] })).toEqual([]);
  });

  it('versteht eigene Schreibweisen', () => {
    expect(rulesFor({ tags: ['1v3'] })).toEqual(['clutches']);
    expect(rulesFor({ tags: ['1 gegen 4'] })).toEqual(['clutches']);
    expect(rulesFor({ tags: ['1v1'] })).toEqual([]);
    expect(rulesFor({ tags: ['Doppel-Kill'] })).toEqual(['mehrfach-kills']);
    expect(rulesFor({ tags: ['kopfschuss'] })).toEqual(['headshots']);
    expect(rulesFor({ tags: ['No-Scope'] })).toEqual(['trickshots']);
    expect(rulesFor({ tags: ['Funny'] })).toEqual(['lustige-momente']);
    expect(rulesFor({ tags: ['Victory Royale'] })).toEqual(['gewonnen']);
    expect(rulesFor({ tags: ['Bossfight'] })).toEqual(['bosskaempfe']);
  });

  it('findet No-Scopes auch im Titel und in den Zeitmarken', () => {
    const mark = (title: string) => [{ seconds: 12, title, description: '' }];
    expect(rulesFor({ highlights: mark('No-Scope-Kill über 120 m') })).toEqual(['trickshots']);
    expect(rulesFor({ title: 'Quickscope auf dem Dach' })).toEqual(['trickshots']);
    expect(rulesFor({ highlights: mark('Snipe über 80 m') })).toEqual([]);
    // Andere Regeln lesen keine Titel: ein „Ace“ muss als Tag bestätigt sein.
    expect(rulesFor({ title: 'Fast ein Ace', highlights: mark('Ace') })).toEqual([]);
  });
});

describe('smartCollections', () => {
  const clips = [
    clip('alt', { tags: ['Ace'], recordedAt: at(30) }),
    clip('neu', { tags: ['Ace', 'Clutch'], recordedAt: at(2) }),
    clip('mitte', { tags: ['ace'], recordedAt: at(8) }),
    clip('clutch', { tags: ['Clutch'], recordedAt: at(5) }),
    clip('einzeln', { tags: ['Headshot'] }),
  ];

  it('zeigt ab zwei Clips, neueste zuerst, in der Reihenfolge der Regeln', () => {
    const result = smartCollections(clips);
    expect(result.map((c) => c.id)).toEqual(['aces', 'clutches']);
    expect(result[0].clipIds).toEqual(['neu', 'mitte', 'alt']);
    expect(result[0].updatedAt).toBe(at(2));
    expect(result[1].clipIds).toEqual(['neu', 'clutch']);
  });

  it('kommt ohne passende Tags ohne Sammlungen aus', () => {
    expect(smartCollections([clip('a'), clip('b', { tags: ['Kill'] })])).toEqual([]);
  });

  it('erscheint auf der Startseite als eigene Reihe mit Verweis auf die Sammlungsseite', () => {
    const row = buildRows({ clips, collections: [] }, NOW).find((r) => r.id === 'automatisch');
    expect(row?.kind).toBe('collections');
    expect(row?.href).toBe('/collections');
    expect(row?.kind === 'collections' && row.items.map((item) => [item.href, item.count])).toEqual(
      [
        [smartHref('aces'), 3],
        [smartHref('clutches'), 2],
      ],
    );
  });
});
