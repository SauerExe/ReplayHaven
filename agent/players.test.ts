import { expect, it } from 'vitest';
import { namesFor, sameGame, savedPlayerNames, tidyPlayerNames } from './players';

// Folder names as the NVIDIA App creates them; the player names are placeholders.
const R6 = "Tom Clancy's Rainbow Six Siege";
const list = [
  { name: 'PlayerOne', game: 'Fortnite' },
  { name: 'PlayerTwo', game: R6 },
  { name: 'PlayerThree', game: 'R6' },
  { name: 'PlayerFour', game: '' },
];

it('names only the names for the clip game, then those for every game', () => {
  expect(namesFor(list, 'Fortnite')).toEqual(['PlayerOne', 'PlayerFour']);
  expect(namesFor(list, R6)).toEqual(['PlayerTwo', 'PlayerThree', 'PlayerFour']);
  expect(namesFor(list, 'VALORANT')).toEqual(['PlayerFour']);
  expect(namesFor(list, 'Desktop')).toEqual(['PlayerFour']);
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
  // Whole words, not letter sequences.
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
      { name: '  Player   One ', game: 'Fortnite' },
      { name: 'player one', game: 'FORTNITE' },
      { name: '', game: 'Fortnite' },
      { name: 'x'.repeat(61) },
      'PlayerTwo',
      { name: 'PlayerTwo' },
      { name: 'PlayerTwo', game: 'R6' },
      { name: 'PlayerTwo', game: 'Rainbow Six' },
    ]),
  ).toEqual([
    { name: 'Player One', game: 'Fortnite' },
    { name: 'PlayerTwo', game: '' },
    { name: 'PlayerTwo', game: 'R6' },
  ]);
  expect(
    tidyPlayerNames(Array.from({ length: 30 }, (_, i) => ({ name: `Player${i}` }))),
  ).toHaveLength(20);
});

it('carries the single name of earlier settings over as a name for every game', () => {
  expect(savedPlayerNames({ playerName: 'PlayerOne' })).toEqual([{ name: 'PlayerOne', game: '' }]);
  expect(savedPlayerNames({ playerName: '' })).toEqual([]);
  expect(savedPlayerNames({})).toEqual([]);
  // Once the list exists, only it counts.
  expect(
    savedPlayerNames({
      playerName: 'PlayerOld',
      playerNames: [{ name: 'PlayerOne', game: 'Fortnite' }],
    }),
  ).toEqual([{ name: 'PlayerOne', game: 'Fortnite' }]);
});
