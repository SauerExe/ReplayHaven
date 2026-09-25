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
/** Das Sitzungs-Cookie aus einer Antwort, für die nächste Anfrage. */
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
  // Ein zweites Konto lässt sich so nicht anlegen.
  expect(
    (await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { ...body, key } }))
      .statusCode,
  ).toBe(409);
  // Anmelden auf einem weiteren Gerät, Groß- und Kleinschreibung im Namen egal.
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
  expect(state.json()).toMatchObject({ loggedIn: true, kind: 'browser', user: { name: 'timo' } });
  // Der Zugangsschlüssel aus der Einrichtung gilt weiter, für ältere Clients.
  expect(
    (await app.inject({ url: '/api/clips', headers: { authorization: `Bearer ${key}` } }))
      .statusCode,
  ).toBe(200);
  // Abmelden beendet genau diese Sitzung.
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
  // Ohne Anmeldung sieht niemand offene Anfragen oder gibt sie frei.
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
  // Der Zugang kommt genau einmal; wer das Geheimnis nicht kennt, erfährt nichts.
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
  // Ein gekoppelter PC darf keine Geräte verwalten.
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
  const phone = await app.inject({
    method: 'POST',
    url: '/api/auth/qr/redeem',
    payload: { code },
    headers: { 'user-agent': 'Mozilla/5.0 (iPhone) Safari/604.1' },
  });
  expect(phone.statusCode).toBe(200);
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
  expect(labels).toContain('Safari auf iPhone/iPad');
  await app.close();
});
