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
  expectRejected(german, attempts);
});

it('rejects a translation that adds claims or leaves a text empty', () => {
  const kill: AnalysisResult = {
    ...german,
    title: 'Kill im Keller',
    description: 'Du schaltest einen Gegner aus.',
    highlights: [{ seconds: 4, title: 'Kill', description: 'Durch die Wand' }],
  };
  const fine = {
    title: 'Kill in the Basement',
    description: 'You take out an enemy.',
    uncertainty: '',
    highlights: [{ title: 'Kill', description: 'Through the wall' }],
  };
  expect(applyTranslation(kill, answer(fine)).title).toBe('Kill in the Basement');
  expectRejected(kill, [
    // More kills than the German title counted.
    { ...fine, title: 'Triple Kill in the Basement' },
    { ...fine, title: 'Ace in the Basement' },
    { ...fine, description: 'You take out 5 enemies.' },
    { ...fine, description: 'You take out three enemies.' },
    // A win nobody checked.
    { ...fine, description: 'You take out an enemy and win the round.' },
    { ...fine, highlights: [{ title: 'Victory', description: 'Through the wall' }] },
    // Empty texts would mix English with German.
    { ...fine, description: '' },
    { ...fine, highlights: [{ title: '', description: 'Through the wall' }] },
  ]);
  const quiet: AnalysisResult = {
    ...german,
    title: 'Sprung vom Dach',
    description: 'Du springst vom Dach.',
    highlights: [],
  };
  expectRejected(quiet, [
    {
      title: 'Double Kill after the Jump',
      description: 'You jump off the roof.',
      uncertainty: '',
      highlights: [],
    },
    {
      title: 'Jump off the Roof',
      description: 'You jump off the roof and take down two enemies.',
      uncertainty: '',
      highlights: [],
    },
  ]);
});

function expectRejected(source: AnalysisResult, attempts: unknown[]) {
  for (const attempt of attempts) {
    let error: unknown;
    try {
      applyTranslation(source, typeof attempt === 'string' ? attempt : answer(attempt));
    } catch (caught) {
      error = caught;
    }
    expect(isParseError(error), JSON.stringify(attempt)).toBe(true);
  }
}
