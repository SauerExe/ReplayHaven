import { expect, it } from 'vitest';
import { factualText, titleProblems, unsupportedClaims } from './wording';
import type { GameEvent } from './events';

const kill = { kind: 'kill', seconds: 4, source: 'screen', text: 'ELIMINIERT' } as GameEvent;
const at = (kind: GameEvent['kind'], seconds = 4): GameEvent => ({
  kind,
  seconds,
  source: 'screen',
  text: kind.toUpperCase(),
});

it('drops description sentences that claim what no event backs up', () => {
  const text =
    'Du läufst durch die Gasse zum Spot B. Dort schaltest du einen Gegner aus. Am Ende gewinnst du die Runde.';
  // Only the kill is proven: the invented round win goes, the rest stays.
  expect(factualText(text, [kill])).toBe(
    'Du läufst durch die Gasse zum Spot B. Dort schaltest du einen Gegner aus.',
  );
  // Without any event, neither the kill nor the win may stay.
  expect(factualText(text, [])).toBe('Du läufst durch die Gasse zum Spot B.');
  expect(factualText('', [])).toBe('');
});

it('checks a counted streak against the proven kills, even without a multi-kill message', () => {
  for (const title of ['Dreifach-Kill im Keller', 'Drei Kills in Folge', 'Doppelter Kill'])
    expect(unsupportedClaims(title, [kill]).join(' '), title).toMatch(/belegt sind 1/);
  const two = [kill, at('kill', 8)];
  expect(unsupportedClaims('Doppel-Kill am Tor', two)).toEqual([]);
  expect(unsupportedClaims('Zwei Kills am Tor', two)).toEqual([]);
  expect(unsupportedClaims('Drei Kills am Tor', two).join(' ')).toMatch(/3 Kills, belegt sind 2/);
  // A streak message without a number counts by its own wording.
  const triple = { ...at('multikill'), text: 'DREIFACHE ELIMINIERUNG' };
  expect(unsupportedClaims('Dreifach-Kill', [kill, triple])).toEqual([]);
  // Without any kill the streak is reported as an invented kill.
  expect(unsupportedClaims('Triple auf dem Dach', []).join(' ')).toMatch(/3 Kills/);
});

it.each([
  'Gegner umgelegt',
  'Zwei Gegner erschossen',
  'Team ausgelöscht',
  'Team-Wipe am Tor',
  'Sauberer Wipe',
  'One-Tap durch die Tür',
  'Zwei Abschüsse',
  'Drei Frags in Folge',
  'Du legst ihn um',
])('treats the kill synonym %s as a claim', (title) => {
  expect(unsupportedClaims(title, []).length, title).toBeGreaterThan(0);
  expect(factualText(`Du läufst los. ${title}.`, [])).toBe('Du läufst los.');
});

it.each(['Chicken Dinner', 'Platz 1 im Finale', 'Erster Platz', 'Der Win in letzter Sekunde'])(
  'treats the win synonym %s as a claim',
  (title) => {
    expect(unsupportedClaims(title, []).join(' ')).toMatch(/Sieg/);
    expect(unsupportedClaims(title, [at('matchWon')])).toEqual([]);
  },
);

it('rejects a place outside R6, where no map is known, but keeps plain phrases', () => {
  const place = { maps: [] };
  expect(titleProblems('Gelber Bagger auf Dantzig', [], [], place).join(' ')).toMatch(
    /Ort Dantzig/,
  );
  const headshot = [kill, at('headshot')];
  expect(titleProblems('Kopfschuss auf Distanz', headshot, [], place)).toEqual([]);
  expect(titleProblems('Sprung in Deckung', [], [], place)).toEqual([]);
  expect(titleProblems('Bagger auf dem Hof', [], [], place)).toEqual([]);
});

it('reads "von hinten erwischt" without a subject as the own death', () => {
  expect(unsupportedClaims('Von hinten erwischt', [kill]).join(' ')).toMatch(/Tod/);
  expect(titleProblems('Von hinten erwischt', [at('death')], [at('death')])).toEqual([]);
  expect(unsupportedClaims('Gegner von hinten erwischt', [kill])).toEqual([]);
  expect(unsupportedClaims('Von Deadlock erschossen', [kill]).join(' ')).toMatch(/Tod/);
});
