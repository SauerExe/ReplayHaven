import { afterAll, afterEach, beforeEach, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { OidcConfig } from './config';
import { loadConfig } from './config';
import { FlowSealer } from './oidc';
import { TEST_KEY, cookieOf, fakeIssuer, removeRoots, startServer } from './test-support';
import type { FakeUser } from './test-support';

let issuer: Awaited<ReturnType<typeof fakeIssuer>>;
beforeEach(async () => {
  issuer = await fakeIssuer();
});
afterEach(async () => {
  await issuer.close();
});
afterAll(removeRoots);

function oidcSettings(overrides: Partial<OidcConfig> = {}): OidcConfig {
  return {
    issuer: issuer.issuer,
    clientId: issuer.clientId,
    clientSecret: issuer.clientSecret,
    name: 'Authelia',
    scopes: 'openid profile email groups',
    adminGroup: 'replayhaven-admins',
    autoCreate: true,
    ...overrides,
  };
}
async function start(oidc: Partial<OidcConfig> = {}, passwordLogin = true) {
  return startServer({ oidc: oidcSettings(oidc), passwordLogin });
}
/** Runs the whole browser round trip: start, provider login, callback. */
async function signIn(app: FastifyInstance, user: FakeUser) {
  const started = await app.inject({ url: '/api/auth/oidc/start' });
  expect(started.statusCode).toBe(302);
  const flow = cookieOf(started, 'rh_oidc');
  expect(started.headers['set-cookie']).toMatch(/rh_oidc=.*HttpOnly/);
  expect(started.headers['set-cookie']).toMatch(/SameSite=Lax/);
  const { code, state, url } = issuer.authorize(String(started.headers.location), user);
  expect(url.searchParams.get('redirect_uri')).toBe(
    'https://replay.example.org/api/auth/oidc/callback',
  );
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(url.searchParams.get('scope')).toBe('openid profile email groups');
  const callback = await app.inject({
    url: `/api/auth/oidc/callback?code=${code}&state=${state}`,
    headers: { cookie: flow },
  });
  return { callback, session: cookieOf(callback) };
}
const loginError = (response: { headers: Record<string, unknown> }) => {
  const location = String(response.headers.location ?? '');
  return new URL(location, 'https://x').searchParams.get('login_error');
};

it('creates the first account as admin on the first OIDC sign-in and signs in again later', async () => {
  const { app } = await start();
  const state = (await app.inject({ url: '/api/auth/state' })).json();
  expect(state).toMatchObject({
    setupRequired: true,
    passwordLogin: true,
    oidc: { enabled: true, name: 'Authelia' },
  });
  const first = await signIn(app, { sub: 'uid-1', preferred_username: 'timo', groups: [] });
  expect(first.callback.statusCode).toBe(302);
  expect(first.callback.headers.location).toBe('/');
  expect(first.session).toMatch(/^rh_session=/);
  const me = (
    await app.inject({ url: '/api/auth/state', headers: { cookie: first.session } })
  ).json();
  expect(me).toMatchObject({
    loggedIn: true,
    role: 'admin',
    user: { name: 'timo', role: 'admin', oidcLinked: true, hasPassword: false },
  });
  // The same identity lands in the same account; no second one is created.
  const again = await signIn(app, { sub: 'uid-1', preferred_username: 'renamed' });
  const users = (
    await app.inject({ url: '/api/users', headers: { cookie: again.session } })
  ).json();
  expect(users).toHaveLength(1);
  // The token and UserInfo endpoints were used; nothing outside the loopback provider.
  expect(issuer.requests).toContain('/token');
  expect(issuer.requests).toContain('/userinfo');
  await app.close();
});

it('makes later identities users unless they are in the admin group', async () => {
  const { app } = await start();
  await signIn(app, { sub: 'uid-1', preferred_username: 'timo' });
  const friend = await signIn(app, { sub: 'uid-2', preferred_username: 'timo', groups: ['users'] });
  const friendState = (
    await app.inject({ url: '/api/auth/state', headers: { cookie: friend.session } })
  ).json();
  // The name is taken, so the new account gets a free variant of it.
  expect(friendState.user).toMatchObject({ name: 'timo-2', role: 'user' });
  const admin = await signIn(app, {
    sub: 'uid-3',
    email: 'sam@example.org',
    groups: ['replayhaven-admins'],
  });
  expect(
    (await app.inject({ url: '/api/auth/state', headers: { cookie: admin.session } })).json().user,
  ).toMatchObject({ name: 'sam', role: 'admin' });
  // Joining the admin group later promotes the existing account.
  const promoted = await signIn(app, { sub: 'uid-2', groups: ['replayhaven-admins'] });
  expect(
    (await app.inject({ url: '/api/auth/state', headers: { cookie: promoted.session } })).json()
      .role,
  ).toBe('admin');
  await app.close();
});

it('refuses unknown identities without auto-create but lets them claim a prepared account', async () => {
  const { app } = await start({ autoCreate: false }, false);
  // The server has an account already, created with the access key before any other existed.
  await app.inject({
    method: 'POST',
    url: '/api/users',
    headers: { authorization: `Bearer ${TEST_KEY}` },
    payload: { name: 'owner', role: 'admin' },
  });
  const stranger = await signIn(app, { sub: 'uid-9', preferred_username: 'stranger' });
  expect(stranger.session).toBe('');
  expect(loginError(stranger.callback)).toMatch(/Ask an admin/);
  // From now on the key opens nothing; the owner signs in through the provider and, as an admin,
  // prepares an account without a password, which the matching sign-in claims.
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/users',
        headers: { authorization: `Bearer ${TEST_KEY}` },
        payload: { name: 'stranger' },
      })
    ).statusCode,
  ).toBe(401);
  const owner = await signIn(app, { sub: 'uid-owner', preferred_username: 'owner' });
  await app.inject({
    method: 'POST',
    url: '/api/users',
    headers: { cookie: owner.session },
    payload: { name: 'stranger' },
  });
  const claimed = await signIn(app, { sub: 'uid-9', preferred_username: 'stranger' });
  expect(claimed.callback.headers.location).toBe('/');
  expect(
    (await app.inject({ url: '/api/auth/state', headers: { cookie: claimed.session } })).json()
      .user,
  ).toMatchObject({ name: 'stranger', role: 'user' });
  // Password sign-in is switched off, even for correct credentials.
  const password = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { name: 'owner', password: 'owner-password' },
  });
  expect(password.statusCode).toBe(403);
  expect((await app.inject({ url: '/api/auth/state' })).json()).toMatchObject({
    passwordLogin: false,
  });
  await app.close();
});

it('rejects forged, missing or cancelled flows with a readable error', async () => {
  const { app } = await start();
  const started = await app.inject({ url: '/api/auth/oidc/start' });
  const flow = cookieOf(started, 'rh_oidc');
  const { code } = issuer.authorize(String(started.headers.location), { sub: 'uid-1' });
  // Wrong state.
  const forged = await app.inject({
    url: `/api/auth/oidc/callback?code=${code}&state=forged`,
    headers: { cookie: flow },
  });
  expect(loginError(forged)).toMatch(/could not be completed/);
  expect(cookieOf(forged)).toBe('');
  // No flow cookie, e.g. the callback was opened in another browser.
  const missing = await app.inject({ url: `/api/auth/oidc/callback?code=${code}&state=x` });
  expect(loginError(missing)).toMatch(/took too long/);
  // A cookie signed by someone else.
  const foreign = new FlowSealer().seal({
    state: 's',
    nonce: 'n',
    verifier: 'v',
    expires: Date.now() + 60000,
  });
  const tampered = await app.inject({
    url: `/api/auth/oidc/callback?code=${code}&state=s`,
    headers: { cookie: `rh_oidc=${foreign}` },
  });
  expect(loginError(tampered)).toMatch(/took too long/);
  // The user cancelled at the provider.
  const cancelled = await app.inject({
    url: '/api/auth/oidc/callback?error=access_denied&error_description=User%20declined',
    headers: { cookie: flow },
  });
  expect(loginError(cancelled)).toBe('Sign-in was cancelled: User declined');
  await app.close();
});

it('links an OIDC identity to a signed-in local account', async () => {
  // With ?link=1 the identity is added to the current account instead of creating a new one.
  const second = await start();
  const owner = cookieOf(
    await second.app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { name: 'timo', password: 'timo-password', key: TEST_KEY },
    }),
  );
  const started = await second.app.inject({
    url: '/api/auth/oidc/start?link=1',
    headers: { cookie: owner },
  });
  const { code, state } = issuer.authorize(String(started.headers.location), {
    sub: 'authelia-timo',
  });
  const callback = await second.app.inject({
    url: `/api/auth/oidc/callback?code=${code}&state=${state}`,
    headers: { cookie: cookieOf(started, 'rh_oidc') },
  });
  expect(callback.headers.location).toBe('/settings/account?linked=1');
  const again = await signIn(second.app, { sub: 'authelia-timo' });
  const state2 = (
    await second.app.inject({ url: '/api/auth/state', headers: { cookie: again.session } })
  ).json();
  expect(state2.user).toMatchObject({ name: 'timo', role: 'admin', oidcLinked: true });
  expect(
    (await second.app.inject({ url: '/api/users', headers: { cookie: again.session } })).json(),
  ).toHaveLength(1);
  await second.app.close();
});

it('reads OIDC, proxy and origin settings from the environment', () => {
  const config = loadConfig({
    REPLAYHAVEN_ACCESS_TOKEN: TEST_KEY,
    REPLAYHAVEN_HOST: '0.0.0.0',
    REPLAYHAVEN_PUBLIC_ORIGIN: 'https://clips.example.org/, http://192.168.1.5:8787',
    REPLAYHAVEN_TRUST_PROXY: 'true',
    REPLAYHAVEN_OIDC_ISSUER: 'https://auth.example.org',
    REPLAYHAVEN_OIDC_CLIENT_ID: 'replayhaven',
    REPLAYHAVEN_OIDC_CLIENT_SECRET: 'secret',
    REPLAYHAVEN_PASSWORD_LOGIN: 'false',
    REPLAYHAVEN_OIDC_AUTO_CREATE: '0',
  });
  expect(config.publicOrigin).toBe('https://clips.example.org');
  expect(config.extraOrigins).toEqual(['http://192.168.1.5:8787']);
  expect(config.trustProxy).toBe(true);
  expect(config.passwordLogin).toBe(false);
  expect(config.oidc).toMatchObject({
    name: 'Single sign-on',
    scopes: 'openid profile email groups',
    autoCreate: false,
    adminGroup: '',
  });
  // Without OIDC, password sign-in cannot be switched off (nobody could sign in).
  expect(
    loadConfig({ REPLAYHAVEN_PASSWORD_LOGIN: 'false', REPLAYHAVEN_PUBLIC_ORIGIN: '' })
      .passwordLogin,
  ).toBe(true);
  expect(() => loadConfig({ REPLAYHAVEN_OIDC_ISSUER: 'https://auth.example.org' })).toThrow(
    /CLIENT_ID/,
  );
  expect(loadConfig({ REPLAYHAVEN_TRUST_PROXY: '2' }).trustProxy).toBe(2);
});
