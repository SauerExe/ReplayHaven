import { afterAll, expect, it } from 'vitest';
import { Accounts } from './auth';
import { setupLink, setupNotice } from './setup-link';
import { TEST_KEY, removeRoots, startServer } from './test-support';

afterAll(removeRoots);

it('puts the access key into the fragment of the public address', () => {
  expect(setupLink('https://replay.example.org/', 'abc123')).toBe(
    'https://replay.example.org/#setup-key=abc123',
  );
  expect(setupLink('http://192.168.1.10:8787', 'a b&c')).toBe(
    'http://192.168.1.10:8787/#setup-key=a%20b%26c',
  );
  // Loopback-only servers without an access key need no key in the link.
  expect(setupLink('http://localhost:8787', '')).toBe('http://localhost:8787');
});

it('logs the setup link only while the server has no account', async () => {
  const { app, db, config } = await startServer();
  const accounts = new Accounts(db.db);
  const before = setupNotice(config, accounts.hasUsers());
  const link = `https://replay.example.org/#setup-key=${TEST_KEY}`;
  expect(before.join('\n')).toContain(link);

  // The key from the link creates the first account ...
  const key = new URLSearchParams(new URL(link).hash.slice(1)).get('setup-key') ?? '';
  const payload = { name: 'timo', password: 'geheimes-passwort', key };
  expect((await app.inject({ method: 'POST', url: '/api/auth/setup', payload })).statusCode).toBe(
    200,
  );
  // ... and afterwards neither the log nor the link offers a setup anymore.
  expect(setupNotice(config, accounts.hasUsers())).toEqual([]);
  expect((await app.inject({ method: 'POST', url: '/api/auth/setup', payload })).statusCode).toBe(
    409,
  );
});

it('points single-sign-on-only servers to the provider instead of a key link', () => {
  const lines = setupNotice(
    {
      publicOrigin: 'https://replay.example.org',
      token: TEST_KEY,
      passwordLogin: false,
      oidc: {
        issuer: 'https://auth.example.org',
        clientId: 'replayhaven',
        clientSecret: 'secret',
        name: 'Authelia',
        scopes: 'openid',
        adminGroup: '',
        autoCreate: true,
      },
    },
    false,
  );
  expect(lines.join('\n')).toContain('sign in with Authelia');
  expect(lines.join('\n')).not.toContain(TEST_KEY);
});
