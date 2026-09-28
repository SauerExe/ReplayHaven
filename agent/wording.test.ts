import { expect, it } from 'vitest';
import { factualText } from './wording';
import type { GameEvent } from './events';

const kill = { kind: 'kill', seconds: 4, source: 'screen', text: 'ELIMINIERT' } as GameEvent;

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
