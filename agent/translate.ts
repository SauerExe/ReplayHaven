import { z } from 'zod';
import type { AnalysisResult } from '../server/schema';

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

/** Multi-kill words in the German title and the English word that must survive translation. */
const KILL_COUNTS: [RegExp, RegExp][] = [
  [/\bdoppel-?kill|\bdoppelter kill/i, /\bdouble\b/i],
  [/\bdreifach-?kill|\btriple\b/i, /\btriple\b/i],
  [/\bvierfach-?kill|\bquad\b/i, /\bquad(?:ra)?\b/i],
  [/\bace\b/i, /\bace\b/i],
  [/\bclutch\b/i, /\bclutch\b/i],
];

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
  if (map && !title.includes(map)) throw fail('The translated title lost the map.');
  return {
    ...result,
    title,
    description: text(data.description, 1800) || result.description,
    uncertainty: result.uncertainty ? text(data.uncertainty, 500) : '',
    highlights: result.highlights.map((h, i) => ({
      ...h,
      title: text(data.highlights[i].title, 120) || h.title,
      description: h.description ? text(data.highlights[i].description, 400) : '',
    })),
  };
}
