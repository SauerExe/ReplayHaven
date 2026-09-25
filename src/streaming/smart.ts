import { getLanguage, t, type MessageKey } from '../i18n';
import type { StreamClip, StreamCollection } from './model';

/**
 * Automatic collections: clips land in them through their tags as the UI shows them (their own,
 * otherwise those of the analysis). The Windows client assigns fixed tags from detected events:
 * Ace, Clutch, Headshot, Multikill, Sieg and others (server/schema.ts, CLIP_TAGS). Everything
 * else, such as "Lustig" or "Bossfight", comes from the user or from Gemini. Changing tags changes
 * these collections too. Nothing new is detected here.
 *
 * Tags stay German on purpose (the AI writes German tags); only titles, descriptions and the
 * example tags shown on the page follow the UI language.
 */
export interface SmartRule {
  id: string;
  title: string;
  description: string;
  /** How the tags appear in the explanation on the collection page. */
  examples: string[];
  /** Tags that lead into the collection, in comparison form (see tagKey). */
  tags: string[];
  /** More spellings in comparison form, e.g. "1v3" or "1gegen3" for clutches. */
  patterns?: RegExp[];
  /**
   * For events without their own tag: a match in the title or in a highlight. No-scopes, for
   * example, only appear there, confirmed by the Fortnite replay (agent/wording.ts).
   */
  titles?: RegExp;
}

/** Comparison form of a tag: lower case, no spaces or punctuation. "No-Scope" becomes "noscope". */
export function tagKey(tag: string): string {
  return tag
    .toLocaleLowerCase('de')
    .replace(/ß/g, 'ss')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

type RuleSpec = Omit<SmartRule, 'title' | 'description' | 'examples'> & {
  /** Example tags shown per language. */
  examples: { en: string[]; de: string[] };
};

/** Title and description are looked up when read, so they follow the current UI language. */
function rule(spec: RuleSpec): SmartRule {
  const { examples, ...rest } = spec;
  return {
    ...rest,
    get title() {
      return t(`stream.smart.${spec.id}.title` as MessageKey);
    },
    get description() {
      return t(`stream.smart.${spec.id}.description` as MessageKey);
    },
    get examples() {
      return examples[getLanguage()];
    },
  };
}

export const SMART_RULES: SmartRule[] = [
  rule({
    id: 'aces',
    examples: { en: ['Ace'], de: ['Ace'] },
    tags: ['ace', 'aces', 'teamace'],
  }),
  rule({
    id: 'clutches',
    examples: { en: ['Clutch', '1v3'], de: ['Clutch', '1v3'] },
    tags: ['clutch', 'clutches'],
    patterns: [/^1(v|vs|gegen)[2-5]$/],
  }),
  rule({
    id: 'mehrfach-kills',
    examples: {
      en: ['Multikill', 'Double Kill', 'Triple Kill'],
      de: ['Multikill', 'Doppel-Kill', 'Triple Kill'],
    },
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
  }),
  rule({
    id: 'headshots',
    examples: { en: ['Headshot', 'One-Tap'], de: ['Headshot', 'Kopfschuss'] },
    tags: ['headshot', 'headshots', 'kopfschuss', 'kopfschüsse', 'onetap'],
  }),
  rule({
    id: 'trickshots',
    examples: {
      en: ['Trickshot', 'No-Scope', 'Quickscope'],
      de: ['Trickshot', 'No-Scope', 'Quickscope'],
    },
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
  }),
  rule({
    id: 'lustige-momente',
    examples: { en: ['Funny', 'Fail', 'Chaos'], de: ['Lustig', 'Funny', 'Fail'] },
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
  }),
  rule({
    // Not "Siege": that is also Rainbow Six Siege. Rounds do not count, or almost everything would be here.
    id: 'gewonnen',
    examples: { en: ['Victory', 'Victory Royale'], de: ['Sieg', 'Victory Royale'] },
    tags: ['sieg', 'matchsieg', 'matchgewonnen', 'victoryroyale', 'victory', 'champion'],
  }),
  rule({
    id: 'bosskaempfe',
    examples: { en: ['Bossfight', 'Boss'], de: ['Bossfight', 'Bosskampf'] },
    tags: ['boss', 'bossfight', 'bossfights', 'bosskampf', 'bosskämpfe'],
  }),
];

/** An automatic collection appears from this many clips on. */
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

/** All automatic collections with at least `min` clips, in rule order. */
export function smartCollections(clips: StreamClip[], min = SMART_MIN): SmartCollection[] {
  return SMART_RULES.map((rule) => smartCollection(clips, rule)).filter(
    (collection) => collection.clipIds.length >= min,
  );
}

export function smartHref(id: string): string {
  return `/collections/auto/${encodeURIComponent(id)}`;
}
