import { afterAll, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Accounts } from './auth';
import { TEST_KEY, cookieOf, removeRoots, startServer } from './test-support';
import type { StoredClip } from './database';

afterAll(removeRoots);
const key = { authorization: `Bearer ${TEST_KEY}` };

async function withAdmin() {
  const server = await startServer();
  const setup = await server.app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    payload: { name: 'owner', password: 'owner-password', key: TEST_KEY },
  });
  expect(setup.statusCode).toBe(200);
  const admin = { cookie: cookieOf(setup) };
  const login = async (name: string, password: string) =>
    server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { name, password } });
  const createUser = async (name: string, role: 'admin' | 'user' = 'user') => {
    const created = await server.app.inject({
      method: 'POST',
      url: '/api/users',
      headers: admin,
      payload: { name, password: `${name}-password`, role },
    });
    expect(created.statusCode).toBe(201);
    const signedIn = await login(name, `${name}-password`);
    expect(signedIn.statusCode).toBe(200);
    return { id: created.json().id as string, headers: { cookie: cookieOf(signedIn) } };
  };
  return { ...server, admin, login, createUser };
}
function storedClip(): StoredClip {
  const id = randomUUID();
  return {
    id,
    title: 'Test clip',
    gameId: 'recording',
    gameName: '',
    thumbnail: '',
    duration: 2,
    recordedAt: new Date().toISOString(),
    size: 10,
    resolution: '180p',
    tags: [],
    favorite: false,
    status: 'ready',
    note: '',
    server: true,
    originalName: 'capture.mp4',
    hash: id,
    originalFile: join(tmpdir(), 'missing.mp4'),
  };
}

it('gives the only account of an older server the admin role and later ones the user role', async () => {
  const root = await mkdtemp(join(tmpdir(), 'replayhaven-auth-'));
  try {
    const db = new DatabaseSync(join(root, 'vault.sqlite'));
    db.exec(
      'CREATE TABLE users(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, data TEXT NOT NULL)',
    );
    // Rows as the server wrote them before roles existed.
    for (const name of ['timo', 'guest'])
      db.prepare('INSERT INTO users(id,name,data) VALUES(?,?,?)').run(
        `${name}-id`,
        name,
        JSON.stringify({ id: `${name}-id`, name, salt: '', hash: '', createdAt: '' }),
      );
    const accounts = new Accounts(db);
    expect(accounts.user('timo-id')?.role).toBe('admin');
    expect(accounts.user('guest-id')?.role).toBe('user');
    // Running the migration again changes nothing.
    accounts.setRole('guest-id', 'admin');
    expect(new Accounts(db).user('guest-id')?.role).toBe('admin');
    db.close();
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
});

it('lets plain users watch but keeps every change to the archive and server for admins', async () => {
  const { app, db, admin, createUser } = await withAdmin();
  const clip = storedClip();
  db.put(clip);
  const alice = await createUser('alice');
  const state = (await app.inject({ url: '/api/auth/state', headers: alice.headers })).json();
  expect(state).toMatchObject({ role: 'user', user: { name: 'alice', role: 'user' } });

  // Reading works for everyone who is signed in.
  for (const url of ['/api/clips', `/api/clips/${clip.id}`, '/api/status', '/api/games'])
    expect((await app.inject({ url, headers: alice.headers })).statusCode).toBe(200);
  // The thumbnail does not exist, but the request is allowed.
  expect(
    (await app.inject({ url: `/api/clips/${clip.id}/thumbnail`, headers: alice.headers }))
      .statusCode,
  ).toBe(404);

  const forbidden = [
    { method: 'PATCH', url: `/api/clips/${clip.id}`, payload: { title: 'Mine now' } },
    { method: 'DELETE', url: `/api/clips/${clip.id}` },
    { method: 'POST', url: `/api/clips/${clip.id}/analyze` },
    { method: 'POST', url: `/api/clips/${clip.id}/retry-media` },
    { method: 'POST', url: '/api/clips' },
    {
      method: 'PUT',
      url: '/api/settings/analysis',
      payload: { autoAnalyze: false, autoTitle: false, includeAudio: false },
    },
    { method: 'POST', url: '/api/games/refresh' },
    { method: 'GET', url: '/api/users' },
    { method: 'POST', url: '/api/users', payload: { name: 'mallory', password: 'x'.repeat(10) } },
    { method: 'GET', url: '/api/pair/pending' },
    { method: 'POST', url: `/api/pair/${randomUUID()}/approve` },
    { method: 'POST', url: `/api/pair/${randomUUID()}/deny` },
    { method: 'DELETE', url: `/api/users/${alice.id}/sessions` },
  ] as const;
  for (const request of forbidden) {
    const response = await app.inject({ ...request, headers: alice.headers });
    expect(response.statusCode, `${request.method} ${request.url}`).toBe(403);
    expect(response.json().error).toMatch(/admin/);
  }
  expect(db.get(clip.id)?.title).toBe('Test clip');

  // Own account actions stay open to users.
  expect((await app.inject({ url: '/api/auth/sessions', headers: alice.headers })).statusCode).toBe(
    200,
  );
  expect(
    (await app.inject({ method: 'POST', url: '/api/auth/qr', headers: alice.headers })).statusCode,
  ).toBe(200);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/password',
        headers: alice.headers,
        payload: { current: 'alice-password', next: 'alice-new-password' },
      })
    ).statusCode,
  ).toBe(200);

  // Admins may change things.
  expect(
    (
      await app.inject({
        method: 'PATCH',
        url: `/api/clips/${clip.id}`,
        headers: admin,
        payload: { title: 'Renamed' },
      })
    ).statusCode,
  ).toBe(200);
  // Once an account exists, the access key is no longer a way in: it only sets up the server.
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/settings/analysis',
        headers: key,
        payload: { autoAnalyze: false, autoTitle: true, includeAudio: false },
      })
    ).statusCode,
  ).toBe(401);
  expect((await app.inject({ url: '/api/clips', headers: key })).statusCode).toBe(401);
  await app.close();
});

it('lets a paired PC upload and report, but not edit the archive', async () => {
  const { app, db, admin } = await withAdmin();
  const clip = storedClip();
  db.put(clip);
  const { id, secret } = (
    await app.inject({
      method: 'POST',
      url: '/api/pair/request',
      payload: { deviceId: randomUUID(), name: 'GAMING-PC' },
    })
  ).json();
  await app.inject({ method: 'POST', url: `/api/pair/${id}/approve`, headers: admin });
  const { token } = (
    await app.inject({ method: 'POST', url: '/api/pair/status', payload: { id, secret } })
  ).json();
  const pc = { authorization: `Bearer ${token}` };
  const heartbeat = await app.inject({
    method: 'POST',
    url: '/api/devices/heartbeat',
    headers: pc,
    payload: { id: randomUUID(), name: 'GAMING-PC', folder: 'C:\\Clips', error: '', uploaded: 3 },
  });
  expect(heartbeat.statusCode).toBe(200);
  // Uploading is allowed; an empty multipart body fails validation, not permission.
  const upload = await app.inject({
    method: 'POST',
    url: '/api/clips',
    headers: { ...pc, 'content-type': 'multipart/form-data; boundary=x' },
    payload: '--x--\r\n',
  });
  expect(upload.statusCode).not.toBe(403);
  expect(
    (
      await app.inject({
        method: 'PATCH',
        url: `/api/clips/${clip.id}`,
        headers: pc,
        payload: { title: 'x' },
      })
    ).statusCode,
  ).toBe(403);
  expect((await app.inject({ url: '/api/users', headers: pc })).statusCode).toBe(403);
  await app.close();
});

it('stops the PCs of a demoted admin and hides PC folders from users', async () => {
  const { app, admin, createUser } = await withAdmin();
  const eve = await createUser('eve', 'admin');
  const alice = await createUser('alice');
  const { id, secret } = (
    await app.inject({
      method: 'POST',
      url: '/api/pair/request',
      payload: { deviceId: randomUUID(), name: 'EVE-PC' },
    })
  ).json();
  await app.inject({ method: 'POST', url: `/api/pair/${id}/approve`, headers: eve.headers });
  const { token } = (
    await app.inject({ method: 'POST', url: '/api/pair/status', payload: { id, secret } })
  ).json();
  const pc = { authorization: `Bearer ${token}` };
  const heartbeat = () =>
    app.inject({
      method: 'POST',
      url: '/api/devices/heartbeat',
      headers: pc,
      payload: { id: randomUUID(), name: 'EVE-PC', folder: 'D:\\Clips', error: '', uploaded: 0 },
    });
  expect((await heartbeat()).statusCode).toBe(200);
  const devices = async (headers: Record<string, string>) =>
    (await app.inject({ url: '/api/status', headers })).json().devices as { folder: string }[];
  expect((await devices(admin))[0].folder).toBe('D:\\Clips');
  expect((await devices(alice.headers))[0].folder).toBe('');

  await app.inject({
    method: 'PATCH',
    url: `/api/users/${eve.id}`,
    headers: admin,
    payload: { role: 'user' },
  });
  expect((await heartbeat()).statusCode).toBe(403);
  await app.close();
});

it('keeps a device ID with the PC that reported it and pairs no PC for a demoted admin', async () => {
  const { app, admin, createUser } = await withAdmin();
  const pairPc = async (name: string, approver: Record<string, string>) => {
    const { id, secret } = (
      await app.inject({
        method: 'POST',
        url: '/api/pair/request',
        payload: { deviceId: randomUUID(), name },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/api/pair/${id}/approve`, headers: approver });
    const { token } = (
      await app.inject({ method: 'POST', url: '/api/pair/status', payload: { id, secret } })
    ).json();
    return { authorization: `Bearer ${token}` };
  };
  const first = await pairPc('PC-1', admin);
  const second = await pairPc('PC-2', admin);
  const device = randomUUID();
  const beat = (headers: Record<string, string>, name: string) =>
    app.inject({
      method: 'POST',
      url: '/api/devices/heartbeat',
      headers,
      payload: { id: device, name, folder: '', error: '', uploaded: 0 },
    });
  expect((await beat(first, 'PC-1')).statusCode).toBe(200);
  expect((await beat(second, 'PC-2')).statusCode).toBe(409);
  expect((await beat(first, 'PC-1')).statusCode).toBe(200);

  // A ticket created by an admin who is demoted before it is redeemed pairs nothing.
  const eve = await createUser('eve', 'admin');
  const { ticket } = (
    await app.inject({ method: 'POST', url: '/api/pair/ticket', headers: eve.headers })
  ).json();
  await app.inject({
    method: 'PATCH',
    url: `/api/users/${eve.id}`,
    headers: admin,
    payload: { role: 'user' },
  });
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/pair/redeem',
        payload: { ticket, name: 'EVE-PC' },
      })
    ).statusCode,
  ).toBe(410);
  await app.close();
});

it('signs out other browsers on a password change and throttles wrong current passwords', async () => {
  const { app, createUser, login } = await withAdmin();
  const alice = await createUser('alice');
  const other = { cookie: cookieOf(await login('alice', 'alice-password')) };
  const change = (current: string, next: string) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: alice.headers,
      remoteAddress: '203.0.113.7',
      payload: { current, next },
    });
  expect((await change('alice-password', 'alice-new-password')).statusCode).toBe(200);
  expect((await app.inject({ url: '/api/clips', headers: alice.headers })).statusCode).toBe(200);
  expect((await app.inject({ url: '/api/clips', headers: other })).statusCode).toBe(401);
  for (let i = 0; i < 20; i++) await change('wrong-password', 'whatever-password');
  expect((await change('alice-new-password', 'another-password')).statusCode).toBe(429);
  await app.close();
});

it('stays open without setup only for requests addressed to this machine', async () => {
  const { app } = await startServer({ token: '' });
  const clips = (host: string) => app.inject({ url: '/api/clips', headers: { host } });
  expect((await clips('localhost:8787')).statusCode).toBe(200);
  expect((await clips('127.0.0.1:5173')).statusCode).toBe(200);
  // A dev proxy on the LAN forwards from 127.0.0.1 but keeps the Host the browser used.
  expect((await clips('192.168.1.20:5173')).statusCode).toBe(401);
  // A broken address is a client error, never a server error.
  expect(
    (await app.inject({ url: '/%E0%A4%A', headers: { host: 'localhost' } })).statusCode,
  ).toBeLessThan(500);
  await app.close();
});

it('manages users and never loses the last admin', async () => {
  const { app, admin, login, createUser } = await withAdmin();
  const users = (await app.inject({ url: '/api/users', headers: admin })).json();
  expect(users).toMatchObject([{ name: 'owner', role: 'admin', self: true, hasPassword: true }]);
  const ownerId = users[0].id as string;

  // Names are unique regardless of case; passwords need eight characters.
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/users',
        headers: admin,
        payload: { name: 'OWNER', password: 'another-password' },
      })
    ).statusCode,
  ).toBe(409);
  const short = await app.inject({
    method: 'POST',
    url: '/api/users',
    headers: admin,
    payload: { name: 'bob', password: 'short' },
  });
  expect(short.statusCode).toBe(400);
  expect(short.json().error).toMatch(/8 characters/);

  // The only admin can neither demote, disable nor delete itself.
  const patch = (id: string, payload: object, headers: Record<string, string> = admin) =>
    app.inject({ method: 'PATCH', url: `/api/users/${id}`, headers, payload });
  expect((await patch(ownerId, { role: 'user' })).statusCode).toBe(409);
  expect((await patch(ownerId, { disabled: true })).statusCode).toBe(409);
  expect(
    (await app.inject({ method: 'DELETE', url: `/api/users/${ownerId}`, headers: admin }))
      .statusCode,
  ).toBe(409);
  // The access key no longer opens anything once accounts exist.
  expect(
    (await app.inject({ method: 'DELETE', url: `/api/users/${ownerId}`, headers: key })).statusCode,
  ).toBe(401);

  // Disabling signs a user out and blocks new sign-ins until enabled again.
  const bob = await createUser('bob');
  expect((await patch(bob.id, { disabled: true })).json()).toMatchObject({ disabled: true });
  expect((await app.inject({ url: '/api/clips', headers: bob.headers })).statusCode).toBe(401);
  expect((await login('bob', 'bob-password')).statusCode).toBe(403);
  await patch(bob.id, { disabled: false });
  expect((await login('bob', 'bob-password')).statusCode).toBe(200);

  // Resetting a password signs the user out and replaces the old one.
  const bobAgain = (await login('bob', 'bob-password')).headers;
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/users/${bob.id}/password`,
        headers: admin,
        payload: { password: 'reset-password' },
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (await app.inject({ url: '/api/clips', headers: { cookie: cookieOf({ headers: bobAgain }) } }))
      .statusCode,
  ).toBe(401);
  expect((await login('bob', 'bob-password')).statusCode).toBe(401);
  expect((await login('bob', 'reset-password')).statusCode).toBe(200);

  // With a second admin the first may step down; the new admin cannot delete itself.
  const carol = await createUser('carol', 'admin');
  expect((await patch(ownerId, { role: 'user' })).json()).toMatchObject({ role: 'user' });
  expect(
    (await app.inject({ method: 'DELETE', url: `/api/users/${carol.id}`, headers: carol.headers }))
      .statusCode,
  ).toBe(409);
  // The demoted owner lost admin rights at once.
  expect((await app.inject({ url: '/api/users', headers: admin })).statusCode).toBe(403);
  expect(
    (await app.inject({ method: 'DELETE', url: `/api/users/${bob.id}`, headers: carol.headers }))
      .statusCode,
  ).toBe(200);
  expect((await login('bob', 'reset-password')).statusCode).toBe(401);
  // Signing out all sessions of another account.
  const revoked = await app.inject({
    method: 'DELETE',
    url: `/api/users/${ownerId}/sessions`,
    headers: carol.headers,
  });
  expect(revoked.json().revoked).toBeGreaterThan(0);
  expect((await app.inject({ url: '/api/clips', headers: admin })).statusCode).toBe(401);
  await app.close();
});
