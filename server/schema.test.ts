import { expect, it } from 'vitest';
import { parseFrameBatch, parseSummary, salvageFrameBatch } from './schema';

const frame = (index: number) => ({
  frame: index,
  kind: 'gameplay',
  observation: `Bild ${index}`,
  visibleText: '',
});

it('accepts a batch numbered across batches or from one, as long as the count is right', () => {
  const across = JSON.stringify({ frames: [4, 5, 6, 7].map(frame) });
  expect(parseFrameBatch(across, 4).map((f) => [f.frame, f.observation])).toEqual([
    [0, 'Bild 4'],
    [1, 'Bild 5'],
    [2, 'Bild 6'],
    [3, 'Bild 7'],
  ]);
  const shuffled = JSON.stringify({ frames: [2, 0, 3, 1].map(frame) });
  expect(parseFrameBatch(shuffled, 4).map((f) => f.observation)).toEqual([
    'Bild 0',
    'Bild 1',
    'Bild 2',
    'Bild 3',
  ]);
  expect(() => parseFrameBatch(JSON.stringify({ frames: [0, 1, 2].map(frame) }), 4)).toThrow();
});

it('salvages what it can from a broken batch and marks the rest as unclear', () => {
  const short = salvageFrameBatch(JSON.stringify({ frames: [0, 2].map(frame) }), 4);
  expect(short.map((f) => [f.frame, f.kind, f.observation])).toEqual([
    [0, 'gameplay', 'Bild 0'],
    [1, 'other', ''],
    [2, 'gameplay', 'Bild 2'],
    [3, 'other', ''],
  ]);
  expect(salvageFrameBatch('Ich beschreibe die Bilder.', 2).map((f) => f.kind)).toEqual([
    'other',
    'other',
  ]);
});

it('drops time marks outside the clip instead of rejecting the whole summary', () => {
  const summary = parseSummary(
    JSON.stringify({
      title: '  Runde   gewonnen ',
      description: 'Dein Team gewinnt.',
      uncertainty: '',
      highlights: [
        { seconds: 5, title: 'Sieg', description: '' },
        { seconds: 50, title: 'Zu spät', description: '' },
        { seconds: -1, title: 'Zu früh', description: '' },
      ],
    }),
    20,
  );
  expect(summary.title).toBe('Runde gewonnen');
  expect(summary.highlights.map((h) => h.title)).toEqual(['Sieg']);
  expect(() => parseSummary(JSON.stringify({ title: '' }), 20)).toThrow();
});
