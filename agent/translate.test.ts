import { expect, it } from 'vitest';
import { applyTranslation, translationPrompt } from './translate';
import { isParseError } from '../server/schema';
import type { AnalysisResult } from '../server/schema';

const german: AnalysisResult = {
  title: 'Dreifachkill auf Oregon',
  description: 'Du schaltest drei Gegner im Keller aus.',
  game: 'Rainbow Six Siege',
  tags: ['Multikill', 'Kill'],
  confidence: 'high',
  uncertainty: '',
  highlights: [
    { seconds: 4, title: 'Erster Kill', description: '' },
    { seconds: 9, title: 'Dritter Kill', description: 'Durch die Wand' },
  ],
};
const answer = (value: unknown) => JSON.stringify(value);
const english = {
  title: '"Triple Kill on Oregon"',
  description: 'You take out three enemies in the basement.',
  uncertainty: 'should stay empty',
  highlights: [
    { title: 'First kill', description: 'ignored' },
    { title: 'Third kill', description: 'Through the wall' },
  ],
};

it('asks only for the texts and names the gaming terms', () => {
  const prompt = translationPrompt(german);
  expect(prompt).toContain('Dreifachkill = Triple Kill');
  expect(prompt).toContain('Dreifachkill auf Oregon');
  expect(prompt).not.toContain('Rainbow Six Siege');
  expect(prompt).not.toContain('"seconds"');
});

it('replaces the texts and keeps everything the code decided', () => {
  const result = applyTranslation(german, answer(english));
  expect(result.title).toBe('Triple Kill on Oregon');
  expect(result.description).toBe('You take out three enemies in the basement.');
  // Fields that were empty in German stay empty: the model must not add caveats or details.
  expect(result.uncertainty).toBe('');
  expect(result.highlights).toEqual([
    { seconds: 4, title: 'First kill', description: '' },
    { seconds: 9, title: 'Third kill', description: 'Through the wall' },
  ]);
  expect(result.tags).toEqual(german.tags);
  expect(result.confidence).toBe('high');
  expect(result.game).toBe('Rainbow Six Siege');
});

it('does not take a common phrase after "auf" for a map', () => {
  const headshot = { ...german, title: 'Kopfschuss auf Distanz', highlights: [] };
  expect(
    applyTranslation(
      headshot,
      JSON.stringify({
        title: 'Long-Range Headshot',
        description: 'x',
        uncertainty: '',
        highlights: [],
      }),
    ).title,
  ).toBe('Long-Range Headshot');
});

it('rejects a translation that loses the kill count, a highlight or the title', () => {
  const attempts = [
    { ...english, title: 'Double Kill on Oregon' },
    { ...english, title: 'Triple Kill on Bank' },
    { ...english, title: 'Triple Kill on Oregon in 3 Seconds' },
    { ...english, highlights: english.highlights.slice(0, 1) },
    { ...english, title: '  ' },
    'not json',
  ];
  for (const attempt of attempts) {
    let error: unknown;
    try {
      applyTranslation(german, typeof attempt === 'string' ? attempt : answer(attempt));
    } catch (caught) {
      error = caught;
    }
    expect(isParseError(error), JSON.stringify(attempt)).toBe(true);
  }
});
