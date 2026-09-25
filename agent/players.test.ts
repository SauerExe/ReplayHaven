import { expect, it } from 'vitest';
import { namesFor, sameGame, savedPlayerNames, tidyPlayerNames } from './players';

// Ordnernamen, wie die NVIDIA App sie anlegt; die Spielernamen sind Platzhalter.
const R6 = "Tom Clancy's Rainbow Six Siege";
const list = [
  { name: 'SpielerEins', game: 'Fortnite' },
  { name: 'SpielerZwei', game: R6 },
  { name: 'SpielerDrei', game: 'R6' },
  { name: 'SpielerVier', game: '' },
];

it('names only the names for the clip game, then those for every game', () => {
  expect(namesFor(list, 'Fortnite')).toEqual(['SpielerEins', 'SpielerVier']);
  expect(namesFor(list, R6)).toEqual(['SpielerZwei', 'SpielerDrei', 'SpielerVier']);
  expect(namesFor(list, 'VALORANT')).toEqual(['SpielerVier']);
  expect(namesFor(list, 'Desktop')).toEqual(['SpielerVier']);
  expect(namesFor([], 'Fortnite')).toEqual([]);
});

it.each([
  ['Fortnite', 'FORTNITE', true],
  ['Rainbow Six', R6, true],
  ['Siege', R6, true],
  ['R6', "Tom Clancy's Rainbow Six® Siege", true],
  ['Rainbow Six Siege', 'R6siege', true],
  ['Call of Duty', 'Call of Duty  Black Ops 7', true],
  ['CoD', 'Call of Duty Black Ops 7', true],
  ['CS2', 'Counter-strike 2', true],
  ['Valorant', 'VALORANT', true],
  // Ganze Wörter, nicht Buchstabenfolgen.
  ['Rust', 'Trust No One', false],
  ['2', 'Counter-strike 2', false],
  ['Fortnite', R6, false],
  ['', 'Fortnite', false],
])('matches the entry %s against the folder %s: %s', (entry, folder, expected) => {
  expect(sameGame(entry, folder)).toBe(expected);
});

it('drops empty, invalid and repeated entries and keeps the order', () => {
  expect(
    tidyPlayerNames([
      { name: '  Spieler   Eins ', game: 'Fortnite' },
      { name: 'spieler eins', game: 'FORTNITE' },
      { name: '', game: 'Fortnite' },
      { name: 'x'.repeat(61) },
      'SpielerZwei',
      { name: 'SpielerZwei' },
      { name: 'SpielerZwei', game: 'R6' },
      { name: 'SpielerZwei', game: 'Rainbow Six' },
    ]),
  ).toEqual([
    { name: 'Spieler Eins', game: 'Fortnite' },
    { name: 'SpielerZwei', game: '' },
    { name: 'SpielerZwei', game: 'R6' },
  ]);
  expect(
    tidyPlayerNames(Array.from({ length: 30 }, (_, i) => ({ name: `Spieler${i}` }))),
  ).toHaveLength(20);
});

it('carries the single name of earlier settings over as a name for every game', () => {
  expect(savedPlayerNames({ playerName: 'SpielerEins' })).toEqual([
    { name: 'SpielerEins', game: '' },
  ]);
  expect(savedPlayerNames({ playerName: '' })).toEqual([]);
  expect(savedPlayerNames({})).toEqual([]);
  // Sobald es die Liste gibt, gilt nur sie.
  expect(
    savedPlayerNames({
      playerName: 'SpielerAlt',
      playerNames: [{ name: 'SpielerEins', game: 'Fortnite' }],
    }),
  ).toEqual([{ name: 'SpielerEins', game: 'Fortnite' }]);
});
