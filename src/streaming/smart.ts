import type { StreamClip, StreamCollection } from './model';

/**
 * Automatische Sammlungen: Clips landen über ihre Tags darin, wie die Oberfläche sie zeigt (die
 * eigenen, sonst die der Analyse). Der Windows-Client vergibt feste Tags aus erkannten
 * Ereignissen: Ace, Clutch, Headshot, Multikill, Sieg und andere (server/schema.ts, CLIP_TAGS).
 * Alles Weitere, etwa „Lustig“ oder „Bossfight“, kommt von Hand oder von Gemini. Wer Tags
 * ändert, ändert damit auch diese Sammlungen. Erkannt wird hier nichts Neues.
 */
export interface SmartRule {
  id: string;
  title: string;
  description: string;
  /** So stehen die Tags in der Erklärung auf der Seite der Sammlung. */
  examples: string[];
  /** Tags, die hineinführen, in Vergleichsform (siehe tagKey). */
  tags: string[];
  /** Weitere Schreibweisen in Vergleichsform, etwa „1v3“ oder „1gegen3“ für Clutches. */
  patterns?: RegExp[];
  /**
   * Für Ereignisse ohne eigenes Tag: Treffer im Titel oder in einer Zeitmarke. No-Scopes etwa
   * stehen nur dort, bestätigt durch das Fortnite-Replay (agent/wording.ts).
   */
  titles?: RegExp;
}

/** Vergleichsform eines Tags: klein, ohne Leer- und Satzzeichen. „No-Scope“ wird „noscope“. */
export function tagKey(tag: string): string {
  return tag
    .toLocaleLowerCase('de')
    .replace(/ß/g, 'ss')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export const SMART_RULES: SmartRule[] = [
  {
    id: 'aces',
    title: 'Aces',
    description: 'Das ganze gegnerische Team in einer Runde.',
    examples: ['Ace'],
    tags: ['ace', 'aces', 'teamace'],
  },
  {
    id: 'clutches',
    title: 'Clutches',
    description: 'Allein gegen mehrere, und trotzdem geschafft.',
    examples: ['Clutch', '1v3'],
    tags: ['clutch', 'clutches'],
    patterns: [/^1(v|vs|gegen)[2-5]$/],
  },
  {
    id: 'mehrfach-kills',
    title: 'Mehrfach-Kills',
    description: 'Mehrere Gegner kurz hintereinander.',
    examples: ['Multikill', 'Doppel-Kill', 'Triple Kill'],
    tags: [
      'multikill',
      'multikills',
      'mehrfachkill',
      'doppelkill',
      'doublekill',
      'dreifachkill',
      'triplekill',
      'vierfachkill',
      'quadrakill',
      'quadkill',
      'fünffachkill',
      'pentakill',
    ],
  },
  {
    id: 'headshots',
    title: 'Headshots',
    description: 'Treffer, die sitzen.',
    examples: ['Headshot', 'Kopfschuss'],
    tags: ['headshot', 'headshots', 'kopfschuss', 'kopfschüsse', 'onetap'],
  },
  {
    id: 'trickshots',
    title: 'Trickshots',
    description: 'No-Scopes, Quickscopes und alles, was eigentlich nicht klappen sollte.',
    examples: ['Trickshot', 'No-Scope', 'Quickscope'],
    tags: [
      'trickshot',
      'trickshots',
      'noscope',
      'noscopes',
      'blindscope',
      'blindscopes',
      'quickscope',
      'quickscopes',
      '360noscope',
      'wallbang',
    ],
    titles: /\b(no|quick|blind)[ -]?scope|\btrickshot/i,
  },
  {
    id: 'lustige-momente',
    title: 'Lustige Momente',
    description: 'Fails, Chaos und alles, worüber ihr noch lacht.',
    examples: ['Lustig', 'Funny', 'Fail'],
    tags: [
      'lustig',
      'witzig',
      'funny',
      'funnymoment',
      'funnymoments',
      'fail',
      'fails',
      'epicfail',
      'lachen',
      'lacher',
      'lol',
      'chaos',
    ],
  },
  {
    // Nicht „Siege“: so heißt auch Rainbow Six Siege. Runden zählen nicht, sonst stünde fast alles hier.
    id: 'gewonnen',
    title: 'Gewonnene Matches',
    description: 'Matches, die ihr am Ende gewonnen habt.',
    examples: ['Sieg', 'Victory Royale'],
    tags: ['sieg', 'matchsieg', 'matchgewonnen', 'victoryroyale', 'victory', 'champion'],
  },
  {
    id: 'bosskaempfe',
    title: 'Bosskämpfe',
    description: 'Einmal noch. Diesmal klappt es.',
    examples: ['Bossfight', 'Bosskampf'],
    tags: ['boss', 'bossfight', 'bossfights', 'bosskampf', 'bosskämpfe'],
  },
];

/** Ab so vielen Clips erscheint eine automatische Sammlung. */
export const SMART_MIN = 2;

export interface SmartCollection extends StreamCollection {
  rule: SmartRule;
}

export function matchesRule(
  rule: SmartRule,
  clip: Pick<StreamClip, 'tags' | 'title' | 'highlights'>,
): boolean {
  const byTag = clip.tags.some((tag) => {
    const key = tagKey(tag);
    return rule.tags.includes(key) || (rule.patterns ?? []).some((pattern) => pattern.test(key));
  });
  if (byTag || !rule.titles) return byTag;
  const titles = rule.titles;
  return titles.test(clip.title) || clip.highlights.some((mark) => titles.test(mark.title));
}

const recorded = (clip: StreamClip) => Date.parse(clip.recordedAt) || 0;

export function smartCollection(clips: StreamClip[], rule: SmartRule): SmartCollection {
  const matching = clips
    .filter((clip) => matchesRule(rule, clip))
    .sort((a, b) => recorded(b) - recorded(a));
  return {
    id: rule.id,
    title: rule.title,
    description: rule.description,
    clipIds: matching.map((clip) => clip.id),
    updatedAt: matching[0]?.recordedAt,
    rule,
  };
}

/** Alle automatischen Sammlungen mit mindestens `min` Clips, in der Reihenfolge der Regeln. */
export function smartCollections(clips: StreamClip[], min = SMART_MIN): SmartCollection[] {
  return SMART_RULES.map((rule) => smartCollection(clips, rule)).filter(
    (collection) => collection.clipIds.length >= min,
  );
}

export function smartHref(id: string): string {
  return `/collections/auto/${encodeURIComponent(id)}`;
}
