import media from './media.json';
import type { Clip, Game, VaultState } from '../domain/models';
export const games: Game[] = media;
const titles = [
  [
    'Dieser Boss hatte andere Pläne',
    'Ein letzter Versuch. Versprochen.',
    'Der Weg ist das Highlight',
    'Das war der letzte Schuss',
  ],
  [
    'Eine Runde. Fünf Treffer.',
    '1 HP und trotzdem gewonnen',
    'Niemand hat die Granate gesehen',
    'Der letzte auf dem Server',
  ],
  [
    'Nachts gehört uns die Stadt',
    'Ein ganz normaler Auftrag',
    'Die Aussicht war es wert',
    'Plan B: einfach weiterfahren',
  ],
  [
    'Der sauberste Drift bisher',
    'Nur noch diese eine Kurve',
    'Sonnenuntergang mit 300',
    'So war das nicht geplant',
  ],
  [
    'Wir hatten einen Plan',
    'Zur richtigen Zeit am falschen Ort',
    'Ein Team. Ein letzter Push.',
    'Komplettes Chaos',
  ],
];
/** Kennungen der Beispiel-Sammlungen, damit ein verbundener Server sie ausräumen kann. */
export const sampleCollectionIds = new Set([
  'favorites-2026',
  'clutches',
  'friends',
  'after-hours',
]);
/**
 * Beispiel-Clips gibt es nur in Entwicklung und Tests. Im ausgelieferten Build startet die
 * Bibliothek leer: Sonst stehen die Beispiele in jedem Browser, bis der Server einmal
 * erfolgreich geantwortet hat, und bleiben bei jedem Fehlschlag stehen.
 */
export const withSamples = import.meta.env.MODE !== 'production';
export function createSeed(): VaultState {
  if (!withSamples)
    return {
      version: 1,
      clips: [],
      collections: [],
      progress: {},
      preferences: { name: 'Spieler', speed: 1, reducedMotion: false, compact: false },
    };
  const clips: Clip[] = games.flatMap((g, gi) =>
    titles[gi].map((title, i) => ({
      id: `${g.id}-${i + 1}`,
      title,
      gameId: g.id,
      thumbnail: g.screenshots[i],
      videoSource: g.movies[i % g.movies.length]?.url,
      sourcePage: g.source,
      sourceTitle: g.movies[i % g.movies.length]?.name,
      duration: [42, 67, 31, 54][i],
      recordedAt: new Date(Date.now() - ((i * 5 + gi) * 14 + 2) * 3600000).toISOString(),
      size: 0,
      resolution: '1080p',
      tags: [
        ['Highlight', 'Bossfight'],
        ['Clutch', 'Mit Freunden'],
        ['Atmosphäre', 'Open World'],
        ['Drift', 'Racing'],
        ['Teamplay', 'Mit Freunden'],
      ][gi],
      favorite: (gi + i) % 3 === 0,
      status: 'ready',
      note: '',
    })),
  );
  return {
    version: 1,
    clips,
    collections: [
      {
        id: 'favorites-2026',
        title: 'Die besten Momente',
        description: 'Die Clips, die bleiben.',
        clipIds: ['elden-1', 'cs2-1', 'forza-1', 'apex-3'],
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'clutches',
        title: 'Gegen alle Chancen',
        description: 'Es ist erst vorbei, wenn es vorbei ist.',
        clipIds: ['cs2-2', 'apex-1', 'elden-2'],
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'friends',
        title: 'Mit den Jungs',
        description: 'Gute Gesellschaft. Fragwürdige Entscheidungen.',
        clipIds: ['apex-4', 'cs2-3', 'forza-4'],
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'after-hours',
        title: 'Nach Feierabend',
        description: 'Einfach mal die Spielwelt genießen.',
        clipIds: ['cyberpunk-1', 'forza-3', 'elden-3'],
        updatedAt: new Date().toISOString(),
      },
    ],
    progress: {},
    preferences: { name: 'Spieler', speed: 1, reducedMotion: false, compact: false },
  };
}
