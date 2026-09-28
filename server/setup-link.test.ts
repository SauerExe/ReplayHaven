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

it('offers the setup link with single sign-on too, and names the admin group', () => {
  const oidc = {
    issuer: 'https://auth.example.org',
    clientId: 'replayhaven',
    clientSecret: 'secret',
    name: 'Authelia',
    scopes: 'openid',
    adminGroup: '',
    autoCreate: true,
  };
  const config = {
    publicOrigin: 'https://replay.example.org',
    token: TEST_KEY,
    passwordLogin: false,
  };
  // Without an admin group, the first admin can only come from the setup link.
  const plain = setupNotice({ ...config, oidc }, false).join('\n');
  expect(plain).toContain(`#setup-key=${TEST_KEY}`);
  expect(plain).not.toContain('Authelia');
  const grouped = setupNotice({ ...config, oidc: { ...oidc, adminGroup: 'replay-admins' } }, false);
  expect(grouped.join('\n')).toContain(
    'Members of replay-admins may instead sign in with Authelia',
  );
});
