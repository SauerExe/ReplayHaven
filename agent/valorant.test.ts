import { expect, it } from 'vitest';
import { feedEvents, feedLines, isValorant, sameName } from './valorant';
import { label, tidyHighlights } from './wording';
import { phrase } from './events';
import type { GameEvent } from './events';
import type { TextLine } from './ocr';

// Pieces as PaddleOCR read them in the killfeed region (VAL-B2, 2026-09-24): x and y within the
// region, the headshot icon as "小" just before the victim.
const piece = (x: number, y: number, text: string, score = 0.97): TextLine => ({
  text,
  score,
  box: { x, y, w: text.length * 8, h: 16 },
});
const frame = (seconds: number, ...lines: TextLine[]) => ({ seconds, lines });

const clip = [
  frame(107.3, piece(238, 26, 'PhoenixMain'), piece(111, 26, 'Deadlock')),
  frame(
    107.8,
    piece(212, 23, '步', 0.8),
    piece(238, 26, 'PhoenixMain'),
    piece(111, 26, 'Deadlock'),
  ),
  frame(
    108.3,
    piece(239, 26, 'PhoenixMain'),
    piece(112, 26, 'Deadlock'),
    piece(252, 51, 'yyds asdf', 0.95),
    piece(134, 53, 'PlayerOne', 0.99),
  ),
  frame(
    109.3,
    piece(112, 26, 'Deadlock'),
    piece(239, 26, 'PhoenixMain'),
    piece(228, 51, '小', 0.65),
    piece(253, 51, 'yydsasdf', 0.91),
    piece(133, 52, 'PlayerOne', 0.96),
  ),
  frame(
    109.8,
    piece(134, 52, 'PlayerOne', 0.94),
    piece(253, 53, 'yyds asdf', 0.96),
    piece(236, 76, '小', 0.64),
    piece(261, 78, 'liloberit', 0.98),
    piece(142, 79, 'PlayerOnc', 0.91),
  ),
  // Older entries have disappeared, the rest move up.
  frame(
    112.8,
    piece(252, 25, 'yyds asdf'),
    piece(134, 27, 'PlayerOne'),
    piece(261, 52, 'liloberit'),
    piece(142, 53, 'PlayerOne'),
  ),
  frame(116.3),
  frame(116.8, piece(250, 25, 'Harutio85'), piece(161, 26, 'Killjoy')),
  frame(
    117.3,
    piece(250, 25, 'Harutio85'),
    piece(162, 26, 'Killjoy'),
    piece(157, 52, 'Deadlock'),
    piece(263, 54, 'PlayerOne'),
  ),
];

it('finds the headshot symbol also as the latin PP-OCRv5 reads it', () => {
  // The same lines with the v5 recognition model: icon as "as" or "2", names without spaces.
  expect(
    feedLines([
      piece(111, 26, 'Deadlock'),
      piece(212, 24, 'as', 0.7),
      piece(238, 26, 'PhoenixMain'),
      piece(134, 52, 'PlayerOne-'),
      piece(233, 51, '2', 0.6),
      piece(253, 53, 'yydsasdf'),
    ]),
  ).toEqual([
    { killer: 'Deadlock', victim: 'PhoenixMain', headshot: true },
    { killer: 'PlayerOne-', victim: 'yydsasdf', headshot: true },
  ]);
  expect(sameName('PlayerOne-', 'PlayerOne')).toBe(true);
});

it('recognises Valorant by name', () => {
  expect(isValorant('VALORANT')).toBe(true);
  expect(isValorant("Tom Clancy's Rainbow Six Siege")).toBe(false);
});

it('forgives one misread letter in longer names only', () => {
  expect(sameName('PlayerOnc', 'PlayerOne')).toBe(true);
  expect(sameName('yyds asdf', 'yydsasdf')).toBe(true);
  expect(sameName('Deadlock', 'PlayerOne')).toBe(false);
  expect(sameName('Ab', 'Ac')).toBe(false);
});

it('splits a killfeed read into killer, victim and headshot', () => {
  expect(feedLines(clip[4].lines)).toEqual([
    { killer: 'PlayerOne', victim: 'yyds asdf', headshot: false },
    { killer: 'PlayerOnc', victim: 'liloberit', headshot: true },
  ]);
});

it('counts two own headshot kills and the own death once each, with the frame before as start', () => {
  const events = feedEvents(clip, ['PlayerTwo', 'PlayerOne']);
  expect(events.map((e) => [e.kind, e.seconds, e.from, e.other])).toEqual([
    ['kill', 108.3, 107.8, 'yyds asdf'],
    ['headshot', 108.3, 107.8, 'yyds asdf'],
    ['kill', 109.8, 109.3, 'liloberit'],
    ['headshot', 109.8, 109.3, 'liloberit'],
    ['multikill', 109.8, 109.3, undefined],
    ['death', 117.3, 116.8, 'Deadlock'],
  ]);
  const multi = events.find((e) => e.kind === 'multikill')!;
  expect(multi).toMatchObject({ count: 2, source: 'ocr', headshots: 2 });
  // The title should be able to mention the headshots, not just "Zwei Kills".
  expect(phrase(multi)).toBe(
    'Du hast zwei Gegner kurz nacheinander ausgeschaltet, beide per Kopfschuss',
  );
  expect(label(multi)).toBe('Doppel-Kill per Kopfschuss');
});

it('gives each killfeed moment one time mark, before the entry, without the model repeating it', () => {
  const events = feedEvents(clip, ['PlayerOne']);
  // How the model proposed the moments on 2026-09-24: at the time the entry appeared.
  const proposed = [
    { seconds: 109.8, title: 'Zwei Kills', description: '' },
    { seconds: 117.3, title: 'Tod', description: '' },
    { seconds: 60, title: 'Kaufphase', description: '' },
  ];
  expect(tidyHighlights(proposed, events, 120).map((h) => [h.seconds, h.title])).toEqual([
    [60, 'Kaufphase'],
    [106.8, 'Headshot'],
    [108.3, 'Doppel-Kill per Kopfschuss'],
    [115.8, 'Von Deadlock ausgeschaltet'],
  ]);
});

it('marks a round banner read twice only once', () => {
  const won = (seconds: number, text: string): GameEvent => ({
    kind: 'roundWon',
    seconds,
    text,
    source: 'screen',
  });
  expect(
    tidyHighlights([], [won(57.1, 'GEWONNEN'), won(60, 'MAKELLOS')], 120).map((h) => h.seconds),
  ).toEqual([57.1]);
});

it('reads nothing as own without a matching name', () => {
  expect(feedEvents(clip, [])).toEqual([]);
  expect(feedEvents(clip, ['PlayerTwo'])).toEqual([]);
});

it('counts a kill once when the reader appends punctuation to the victim', () => {
  // 2026-09-24, clip VAL 2025.08.19: "leavingtonight" and "leavingtonight)" gave three kills.
  const events = feedEvents(
    [
      frame(77.5, piece(134, 52, 'PlayerTwo'), piece(253, 53, 'leavingtonight')),
      frame(78.0, piece(134, 52, 'PlayerTwo'), piece(253, 53, 'leavingtonight)')),
      frame(78.5, piece(134, 52, 'PlayerTwa'), piece(253, 53, 'leavingtonight,')),
    ],
    ['PlayerTwo'],
  );
  expect(events.filter((e) => e.kind === 'kill')).toHaveLength(1);
});
