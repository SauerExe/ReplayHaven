import { expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  fromSaved,
  normalizeConfig,
  serverAddress,
  validateServer,
} from './config';

it('guesses the scheme of a typed server address', () => {
  expect(serverAddress('192.168.1.20:8787')).toBe('http://192.168.1.20:8787');
  expect(serverAddress('nas:8787')).toBe('http://nas:8787');
  expect(serverAddress('localhost')).toBe('http://localhost');
  expect(serverAddress('replay.example.com')).toBe('https://replay.example.com');
  expect(serverAddress('replay.example.com:443')).toBe('https://replay.example.com:443');
  expect(serverAddress('http://replay.example.com/')).toBe('http://replay.example.com');
});

it('refuses addresses that carry credentials or more than a server', () => {
  for (const address of [
    'http://user:pw@host',
    'http://host/?token=x',
    'http://host/#x',
    'file:///C:/Windows',
  ])
    expect(() => validateServer(address), address).toThrow();
});

it('tidies settings from the window and keeps the saved token when none is sent', () => {
  const input = normalizeConfig(
    {
      ...DEFAULT_CONFIG,
      server: 'http://192.168.1.20:8787/',
      token: '',
      epicAccounts: [' ABCDEF0123456789ABCDEF0123456789 ', 'abcdef0123456789abcdef0123456789'],
    },
    'rhd_saved',
  );
  expect(input.server).toBe('http://192.168.1.20:8787');
  expect(input.token).toBe('rhd_saved');
  expect(input.epicAccounts).toEqual(['abcdef0123456789abcdef0123456789']);
  expect(() => normalizeConfig({ ...DEFAULT_CONFIG, epicAccounts: ['not-an-id'] }, '')).toThrow(
    /32 characters/,
  );
  expect(() => normalizeConfig({ ...DEFAULT_CONFIG, model: 'llama3:70b' }, '')).toThrow();
});

it('loads settings saved by older versions', () => {
  const saved = {
    folder: 'D:/Clips',
    server: 'http://nas:8787',
    game: '',
    includeExisting: false,
    analyze: true,
    frames: 24,
    language: 'de',
    playerName: 'SpielerEins',
  };
  const config = fromSaved(saved, 'rhd_token');
  // A saved folder means setup was done; titles keep the language of the window.
  expect(config).toMatchObject({
    onboarded: true,
    titleLanguage: 'de',
    model: 'qwen3.5:9b',
    token: 'rhd_token',
  });
  expect(config.playerNames).toEqual([{ name: 'SpielerEins', game: '' }]);
  expect(fromSaved({ ...saved, titleLanguage: 'en' }, '').titleLanguage).toBe('en');
});
