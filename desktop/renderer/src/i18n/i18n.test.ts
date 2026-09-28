import { expect, it } from 'vitest';
import { en } from './en';
import { de } from './de';

it('has a German text for every English key, with the same forms and placeholders', () => {
  // A message is a string or plural forms such as { one, other }.
  const shape = (message: unknown) =>
    Object.entries(typeof message === 'string' ? { text: message } : (message as object)).map(
      ([form, text]) =>
        `${form}:${[...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()}`,
    );
  const german = de as Record<string, unknown>;
  for (const [key, message] of Object.entries(en)) {
    expect(german[key], key).toBeDefined();
    expect(shape(german[key]), key).toEqual(shape(message));
  }
});
