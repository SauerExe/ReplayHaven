import { afterAll, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildServer } from './app';
import type { ServerConfig } from './config';

const key = 'auth-test-token-with-at-least-32-chars';
const roots: string[] = [];
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});
async function start() {
  const root = await mkdtemp(join(tmpdir(), 'replayhaven-auth-'));
  roots.push(root);
  const config: ServerConfig = {
    host: '0.0.0.0',
    port: 8787,
    gameMetadata: false,
    dataDir: join(root, 'archive'),
    token: key,
    publicOrigin: 'https://replay.example.org',
    provider: 'none',
    model: '',
    geminiKey: '',
    localUrl: '',
    localKey: '',
    releaseDir: join(root, 'release'),
  };
  const { app } = await buildServer(config);
  return app;
}
/** The session cookie from a response, for the next request. */
function cookieOf(response: { headers: Record<string, unknown> }) {
  const set = [response.headers['set-cookie']].flat().join(';');
  const match = /rh_session=([^;]+)/.exec(set);
  return match ? `rh_session=${match[1]}` : '';
}

it('creates the first account only with the setup key and then logs in with it', async () => {
  const app = await start();
  expect((await app.inject({ url: '/api/clips' })).statusCode).toBe(401);
  expect((await app.inject({ url: '/api/auth/state' })).json()).toMatchObject({
    setupRequired: true,
    setupNeedsKey: true,
    loggedIn: false,
  });
  const body = { name: 'timo', password: 'geheimes-passwort' };
  const wrong = await app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    payload: { ...body, key: 'falsch' },
  });
  expect(wrong.statusCode).toBe(401);
  const setup = await app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    payload: { ...body, key },
  });
  expect(setup.statusCode).toBe(200);
  const cookie = cookieOf(setup);
  expect(cookie).toMatch(/^rh_session=/);
  expect(setup.headers['set-cookie']).toMatch(/HttpOnly/);
  expect(setup.headers['set-cookie']).toMatch(/Secure/);
  expect((await app.inject({ url: '/api/clips', headers: { cookie } })).statusCode).toBe(200);
  // A second account cannot be created this way.
  expect(
    (await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { ...body, key } }))
      .statusCode,
  ).toBe(409);
  // Sign in on another device; the name is case-insensitive.
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { name: 'Timo', password: 'falsch-falsch' },
      })
    ).statusCode,
  ).toBe(401);
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { name: 'Timo', password: body.password },
  });
  expect(login.statusCode).toBe(200);
  const state = await app.inject({ url: '/api/auth/state', headers: { cookie: cookieOf(login) } });
  expect(state.json()).toMatchObject({
    loggedIn: true,
    kind: 'browser',
    role: 'admin',
    user: { name: 'timo', role: 'admin' },
    passwordLogin: true,
    oidc: null,
  });
  // The access key only sets the server up; with an account in place it opens nothing.
  expect(
    (await app.inject({ url: '/api/clips', headers: { authorization: `Bearer ${key}` } }))
      .statusCode,
  ).toBe(401);
  // Signing out ends exactly this session.
  await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
  expect((await app.inject({ url: '/api/clips', headers: { cookie } })).statusCode).toBe(401);
  await app.close();
});

it('pairs a recording PC after approval, hands its access out once and lets it be revoked', async () => {
  const app = await start();
  const setup = await app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    payload: { name: 'timo', password: 'geheimes-passwort', key },
  });
  const cookie = cookieOf(setup);
  const request = await app.inject({
    method: 'POST',
    url: '/api/pair/request',
    payload: { deviceId: randomUUID(), name: 'DESKTOP-TEST' },
  });
  const { id, secret, code } = request.json();
  expect(code).toMatch(/^\d{6}$/);
  const poll = () =>
    app.inject({ method: 'POST', url: '/api/pair/status', payload: { id, secret } });
  expect((await poll()).json()).toEqual({ status: 'pending' });
  // Without signing in nobody sees or approves open requests.
  expect((await app.inject({ url: '/api/pair/pending' })).statusCode).toBe(401);
  const pending = await app.inject({ url: '/api/pair/pending', headers: { cookie } });
  expect(pending.json()).toMatchObject([{ id, code, name: 'DESKTOP-TEST' }]);
  expect(
    (await app.inject({ method: 'POST', url: `/api/pair/${id}/approve`, headers: { cookie } }))
      .statusCode,
  ).toBe(200);
  const approved = (await poll()).json();
  expect(approved.status).toBe('approved');
  expect(approved.token).toMatch(/^rhd_/);
  // The access token comes exactly once; without the secret nobody learns anything.
  expect((await poll()).json()).toEqual({ status: 'expired' });
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/pair/status',
        payload: { id, secret: 'geraten' },
      })
    ).json(),
  ).toEqual({ status: 'expired' });
  const device = { authorization: `Bearer ${approved.token}` };
  expect((await app.inject({ url: '/api/status', headers: device })).statusCode).toBe(200);
  // A paired PC may not manage devices.
  expect((await app.inject({ url: '/api/auth/sessions', headers: device })).statusCode).toBe(403);
  const sessions = (await app.inject({ url: '/api/auth/sessions', headers: { cookie } })).json();
  const pc = sessions.find((s: { kind: string }) => s.kind === 'client');
  expect(pc).toMatchObject({ label: 'DESKTOP-TEST', current: false });
  expect(sessions.find((s: { kind: string }) => s.kind === 'browser')).toMatchObject({
    current: true,
  });
  expect(
    (
      await app.inject({
        method: 'DELETE',
        url: `/api/auth/sessions/${pc.id}`,
        headers: { cookie },
      })
    ).statusCode,
  ).toBe(200);
  expect((await app.inject({ url: '/api/status', headers: device })).statusCode).toBe(401);
  await app.close();
});

it('pairs a recording PC by link: only admins create tickets, each works once', async () => {
  const app = await start();
  const setup = await app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    payload: { name: 'timo', password: 'geheimes-passwort', key },
  });
  const cookie = cookieOf(setup);
  expect((await app.inject({ method: 'POST', url: '/api/pair/ticket' })).statusCode).toBe(401);
  const created = await app.inject({
    method: 'POST',
    url: '/api/pair/ticket',
    headers: { cookie },
  });
  const { ticket } = created.json();
  expect(ticket).toMatch(/^rht_/);
  const redeem = (value: string) =>
    app.inject({
      method: 'POST',
      url: '/api/pair/redeem',
      payload: { ticket: value, name: 'DESKTOP-LINK' },
    });
  expect((await redeem('rht_geraten')).statusCode).toBe(410);
  const first = await redeem(ticket);
  expect(first.statusCode).toBe(200);
  const device = { authorization: `Bearer ${first.json().token}` };
  expect((await app.inject({ url: '/api/status', headers: device })).statusCode).toBe(200);
  // A ticket is used up by its first redemption.
  expect((await redeem(ticket)).statusCode).toBe(410);
  const sessions = (await app.inject({ url: '/api/auth/sessions', headers: { cookie } })).json();
  expect(sessions.find((s: { kind: string }) => s.kind === 'client')).toMatchObject({
    label: 'DESKTOP-LINK',
  });
  // A paired PC cannot create tickets for further PCs.
  expect(
    (await app.inject({ method: 'POST', url: '/api/pair/ticket', headers: device })).statusCode,
  ).toBe(403);
  await app.close();
});

it('throttles failed sign-ins per address, so one attacker cannot lock everyone out', async () => {
  const app = await start();
  await app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    payload: { name: 'timo', password: 'geheimes-passwort', key },
  });
  const login = (password: string, remoteAddress: string) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/login',
      remoteAddress,
      payload: { name: 'timo', password },
    });
  for (let i = 0; i < 20; i++) await login('falsch', '203.0.113.9');
  expect((await login('geheimes-passwort', '203.0.113.9')).statusCode).toBe(429);
  expect((await login('geheimes-passwort', '192.168.1.20')).statusCode).toBe(200);
  await app.close();
});

it('limits open pairing requests per address', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { Accounts } = await import('./auth');
  const accounts = new Accounts(new DatabaseSync(':memory:'));
  for (let i = 0; i < 3; i++) accounts.requestPairing(`PC ${i}`, randomUUID(), 0, '203.0.113.9');
  expect(() => accounts.requestPairing('PC 4', randomUUID(), 0, '203.0.113.9')).toThrow(/Too many/);
  // Your own PC on another address still gets through.
  expect(accounts.requestPairing('DESKTOP', randomUUID(), 0, '192.168.1.20').code).toMatch(
    /^\d{6}$/,
  );
});

it('lets a pairing ticket expire', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { Accounts } = await import('./auth');
  const accounts = new Accounts(new DatabaseSync(':memory:'));
  const admin = await accounts.createUser('timo', 'geheimes-passwort');
  const { ticket } = accounts.pairingTicket(admin.id, 0);
  expect(accounts.redeemTicket(ticket, 'PC', 11 * 60000)).toBeUndefined();
});

it('denies a pairing request and signs in another device once per QR code', async () => {
  const app = await start();
  const setup = await app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    payload: { name: 'timo', password: 'geheimes-passwort', key },
  });
  const cookie = cookieOf(setup);
  const { id, secret } = (
    await app.inject({
      method: 'POST',
      url: '/api/pair/request',
      payload: { deviceId: randomUUID(), name: 'FREMDER-PC' },
    })
  ).json();
  await app.inject({ method: 'POST', url: `/api/pair/${id}/deny`, headers: { cookie } });
  expect(
    (await app.inject({ method: 'POST', url: '/api/pair/status', payload: { id, secret } })).json(),
  ).toEqual({ status: 'denied' });
  const qr = await app.inject({
    method: 'POST',
    url: '/api/auth/qr',
    headers: { cookie, origin: 'https://replay.example.org' },
  });
  const url = new URL(qr.json().url);
  expect(url.origin + url.pathname).toBe('https://replay.example.org/connect');
  const code = url.searchParams.get('code')!;
  const state = async () =>
    (await app.inject({ url: `/api/auth/qr/${qr.json().id}`, headers: { cookie } })).json();
  expect(await state()).toEqual({ status: 'waiting' });
  const phone = await app.inject({
    method: 'POST',
    url: '/api/auth/qr/redeem',
    payload: { code },
    headers: { 'user-agent': 'Mozilla/5.0 (iPhone) Safari/604.1' },
  });
  expect(phone.statusCode).toBe(200);
  expect(await state()).toEqual({ status: 'used', label: 'Safari on iPhone/iPad' });
  expect(
    (await app.inject({ url: '/api/clips', headers: { cookie: cookieOf(phone) } })).statusCode,
  ).toBe(200);
  expect(
    (await app.inject({ method: 'POST', url: '/api/auth/qr/redeem', payload: { code } }))
      .statusCode,
  ).toBe(401);
  const labels = (await app.inject({ url: '/api/auth/sessions', headers: { cookie } }))
    .json()
    .map((s: { label: string }) => s.label);
  expect(labels).toContain('Safari on iPhone/iPad');
  await app.close();
});

it('accepts the page it served itself from any address and still rejects other sites', async () => {
  const app = await start();
  const call = (origin: string, host: string) =>
    app.inject({ url: '/api/auth/state', headers: { origin, host } });
  // Opened at a LAN address that is not in REPLAYHAVEN_PUBLIC_ORIGIN.
  expect((await call('http://192.168.1.10:8787', '192.168.1.10:8787')).statusCode).toBe(200);
  const foreign = await call('http://evil.example', '192.168.1.10:8787');
  expect(foreign.statusCode).toBe(403);
  expect(foreign.json().error).toMatch(/REPLAYHAVEN_PUBLIC_ORIGIN/);
  // Same host, different scheme is another origin.
  expect((await call('https://192.168.1.10:8787', '192.168.1.10:8787')).statusCode).toBe(403);
  await app.close();
});
