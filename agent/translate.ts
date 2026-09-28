import { z } from 'zod';
import type { AnalysisResult } from '../server/schema';
import { COMMON_AFTER_AUF } from './wording';

/**
 * Language of the generated title, description and highlights. The analysis itself (frame
 * review, event checks, title checks) runs in German, because every measurement in
 * docs/AI-RECOGNITION.md was made that way; English output is a translation of the finished and
 * checked German result, so it keeps the same guarantees.
 */
export const TITLE_LANGUAGES = ['de', 'en'] as const;
export type TitleLanguage = (typeof TITLE_LANGUAGES)[number];

const translationSchema = z.object({
  title: z.string(),
  description: z.string(),
  uncertainty: z.string(),
  highlights: z.array(z.object({ title: z.string(), description: z.string() })),
});
export const translationJsonSchema = z.toJSONSchema(translationSchema);

/** The texts to translate; seconds, tags, game and confidence stay untouched. */
function source(result: AnalysisResult) {
  return {
    title: result.title,
    description: result.description,
    uncertainty: result.uncertainty,
    highlights: result.highlights.map((h) => ({ title: h.title, description: h.description })),
  };
}

export function translationPrompt(result: AnalysisResult) {
  return `Translate the texts of this gaming clip from German into natural English. Keep the meaning exactly: add nothing, drop nothing, no new claims. Keep names of games, maps, players, operators, agents and weapons unchanged. Use the usual gaming terms: Doppelkill = Double Kill, Dreifachkill = Triple Kill, Vierfachkill = Quad Kill, Kopfschuss = headshot, Rundensieg = round win, Runde verloren = round lost, Sieg = victory, Niederlage = defeat; Ace and Clutch stay as they are. The title is a short headline as a gamer would name the clip, in title case, without quotes. The description speaks to the player as "you". Empty strings stay empty. Keep the number and order of the highlights. Output JSON.\n${JSON.stringify(source(result))}`;
}

/**
 * Multi-kill words in German and their English counterpart. The German title's word must survive
 * translation; an English one the German text does not have is an added claim.
 */
const KILL_COUNTS: [RegExp, RegExp][] = [
  [/\bdoppel-?kill|\bdoppelte[rnms]? (?:kill|kopfschuss)|\bdouble\b/i, /\bdouble\b/i],
  [/\bdreifach-?kill|\btriple\b/i, /\btriple\b/i],
  [/\bvierfach-?kill|\bquad\b/i, /\bquad(?:ra)?\b/i],
  [/\bfünffach-?kill|\bpenta\b/i, /\bpenta\b/i],
  [/\bace\b/i, /\bace\b/i],
  [/\bclutch\b/i, /\bclutch\b/i],
];

/**
 * Claims the German checks (agent/wording.ts) confirmed. An English text may only make them
 * where its German source does: a kill or a win the translation adds was never checked.
 */
const CLAIMS: [RegExp, RegExp][] = [
  [
    /kill|eliminier|ausgeschaltet|ausschalt|schaltest|erledig|erwisch|abschuss|abschüsse|abgeschossen|kopfsch|headshot|töte|getötet|besiegt|umgelegt|umlegen|legst|erschoss|erschieß|ausgelöscht|wipe|one-?tap|frag|\bace\b|doppel|dreifach|vierfach|fünffach|abtausch|trade/i,
    /\bkill|eliminat|headshot|\bfrags?\b|\bfragged\b|\b(?:take[sn]?|took|taking) (?:\w+ )?(?:out|down)\b|takedown|\bwipe|one-?tap|\bace\b|\bdouble\b|\btriple\b|\bquad|\bpenta\b|\bshot dead\b|\bshoots? (?:down|dead)\b|\bgun(?:s|ned)? down\b/i,
  ],
  [
    /(?<!be)sieg|gewonnen|gewinn|victory|chicken\s*dinner|platz\s*(?:1|eins)(?!\d)|erste[rnms]?\s+platz|\bwin\b/i,
    /\b(?:win|wins|won|winning|winner|victory|victorious|chicken dinner|first place)\b/i,
  ],
];

const NUMBER_WORDS: Record<string, number> = {
  zwei: 2,
  drei: 3,
  vier: 4,
  fünf: 5,
  sechs: 6,
  sieben: 7,
  acht: 8,
  neun: 9,
  zehn: 10,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};
/** Numbers in a text, as digits or words from two to ten. */
function numbersIn(text: string) {
  return new Set(
    (text.toLowerCase().match(/\d+|\p{L}+/gu) ?? []).flatMap((w) =>
      /^\d+$/.test(w) ? [Number(w)] : w in NUMBER_WORDS ? [NUMBER_WORDS[w]] : [],
    ),
  );
}

/** What the English text claims beyond its German source, or empty. */
function addedClaim(german: string, english: string) {
  for (const [de, en] of [...KILL_COUNTS, ...CLAIMS])
    if (en.test(english) && !de.test(german)) return en.exec(english)![0];
  const known = numbersIn(german);
  return [...numbersIn(english)].find((n) => !known.has(n))?.toString() ?? '';
}

/**
 * Applies a translation to the German result. Throws a ZodError for an unusable answer: missing
 * title, a different number of highlights or a title that lost the kill count.
 */
export function applyTranslation(result: AnalysisResult, raw: string): AnalysisResult {
  const clean = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const data = translationSchema.parse(JSON.parse(clean));
  const text = (value: string, max: number) => value.replace(/\s+/g, ' ').trim().slice(0, max);
  const fail = (message: string) =>
    new z.ZodError([{ code: 'custom', path: ['translation'], message }]);
  const title = text(data.title, 120).replace(/^["'“„]+|["'”“]+$/g, '');
  if (!title) throw fail('No translated title.');
  if (data.highlights.length !== result.highlights.length)
    throw fail('The translation changed the number of highlights.');
  for (const [german, english] of KILL_COUNTS)
    if (german.test(result.title) && !english.test(title))
      throw fail('The translated title lost what the German title counted.');
  // Numbers and the map are facts the German checks confirmed; the translation keeps exactly
  // those and adds none.
  const numbers = (text: string) => (text.match(/\d+/g) ?? []).sort().join(',');
  if (numbers(title) !== numbers(result.title))
    throw fail('The translated title changed a number.');
  const map = /\bauf ([A-ZÄÖÜ][\wäöüß-]+)/.exec(result.title)?.[1];
  if (map && !COMMON_AFTER_AUF.test(map) && !title.includes(map))
    throw fail('The translated title lost the map.');
  const translated: AnalysisResult = {
    ...result,
    title,
    description: text(data.description, 1800),
    uncertainty: result.uncertainty ? text(data.uncertainty, 500) : '',
    highlights: result.highlights.map((h, i) => ({
      ...h,
      title: text(data.highlights[i].title, 120),
      description: h.description ? text(data.highlights[i].description, 400) : '',
    })),
  };
  // Field by field: an English text next to its German source. A missing translation would mix
  // the languages, an added claim was never checked; either way the German result stays.
  const pairs: [string, string][] = [
    [result.title, translated.title],
    [result.description, translated.description],
    [result.uncertainty, translated.uncertainty],
    ...result.highlights.flatMap((h, i): [string, string][] => [
      [h.title, translated.highlights[i].title],
      [h.description, translated.highlights[i].description],
    ]),
  ];
  for (const [german, english] of pairs) {
    if (german.trim() && !english) throw fail('The translation left a text empty.');
    const added = addedClaim(german, english);
    if (added) throw fail(`The translation added a claim: ${added}.`);
  }
  return translated;
}
