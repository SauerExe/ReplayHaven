import { afterEach, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { setLanguage } from '../i18n';
import { KNOWN_SERVER_MESSAGES, localizeServerMessage } from './server-messages';

afterEach(() => setLanguage('en', false));

it('shows server messages in German when the interface is German, and as sent otherwise', () => {
  expect(localizeServerMessage('Name or password is wrong.')).toBe('Name or password is wrong.');
  setLanguage('de', false);
  expect(localizeServerMessage('Name or password is wrong.')).toBe(
    'Name oder Passwort ist falsch.',
  );
  expect(localizeServerMessage('Password sign-in is disabled. Sign in with Authelia.')).toBe(
    'Die Anmeldung mit Passwort ist abgeschaltet. Melde dich mit Authelia an.',
  );
  expect(localizeServerMessage('Something new the server says.')).toBe(
    'Something new the server says.',
  );
});

it('only knows texts the server really sends', () => {
  // Messages may span two source lines ('…' + line break + '…'); join them first.
  const source = readdirSync('server')
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => readFileSync(`server/${f}`, 'utf8'))
    .join('\n')
    .replace(/'\s*\+?\s*\n\s*'/g, '');
  for (const message of KNOWN_SERVER_MESSAGES) expect(source, message).toContain(message);
});
