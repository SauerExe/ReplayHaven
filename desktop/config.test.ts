import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  backupFile,
  DEFAULT_CONFIG,
  fromSaved,
  normalizeConfig,
  parseSaved,
  readSaved,
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

it('keeps http for home-network hosts and uses https for other domains, also with a port', () => {
  expect(serverAddress('nas.local:8787')).toBe('http://nas.local:8787');
  expect(serverAddress('nas.fritz.box:8787')).toBe('http://nas.fritz.box:8787');
  expect(serverAddress('nas.lan')).toBe('http://nas.lan');
  expect(serverAddress('10.0.0.5')).toBe('http://10.0.0.5');
  expect(serverAddress('localhost:8787')).toBe('http://localhost:8787');
  expect(serverAddress('[::1]:8787')).toBe('http://[::1]:8787');
  expect(serverAddress('replay.example.com:8787')).toBe('https://replay.example.com:8787');
  expect(serverAddress('nas:443')).toBe('https://nas:443');
});

it('replaces only the broken fields of a saved file with their defaults', () => {
  const { config, repaired } = readSaved(
    {
      folder: 'D:/Clips',
      server: 'not a url',
      game: '',
      includeExisting: false,
      analyze: true,
      frames: 12,
      language: 'de',
      model: 'llama3:70b',
      notify: false,
    },
    'rhd_token',
  );
  expect(repaired.sort()).toEqual(['frames', 'model', 'server']);
  expect(config).toMatchObject({
    folder: 'D:/Clips',
    server: DEFAULT_CONFIG.server,
    frames: DEFAULT_CONFIG.frames,
    model: DEFAULT_CONFIG.model,
    language: 'de',
    notify: false,
    onboarded: true,
    token: 'rhd_token',
  });
  expect(readSaved(null, '')).toMatchObject({ config: DEFAULT_CONFIG, repaired: ['*'] });
  // Older files simply lack fields; that is no repair.
  expect(readSaved({ folder: 'D:/Clips' }, '').repaired).toEqual([]);
});

it('keeps the other settings when the access key cannot be decrypted or the file is damaged', () => {
  const text = JSON.stringify({ ...DEFAULT_CONFIG, folder: 'D:/Clips', encryptedToken: 'AAAA' });
  const lost = parseSaved(text, () => {
    throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.');
  });
  expect(lost.config).toMatchObject({ folder: 'D:/Clips', token: '' });
  expect(lost.repaired).toEqual(['token']);
  expect(parseSaved(text, () => 'rhd_key')).toMatchObject({
    config: { token: 'rhd_key' },
    repaired: [],
  });
  expect(parseSaved('{"folder": "D:/Cl', () => '')).toMatchObject({
    config: DEFAULT_CONFIG,
    repaired: ['*'],
  });
});

it('keeps a copy of a settings file before it is overwritten', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'replayhaven-config-'));
  try {
    const file = join(folder, 'preferences.json');
    await backupFile(file);
    expect(await readdir(folder)).toEqual([]);
    await writeFile(file, '{"folder": "D:/Clips"}');
    await backupFile(file);
    expect(await readFile(`${file}.bak`, 'utf8')).toBe('{"folder": "D:/Clips"}');
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
