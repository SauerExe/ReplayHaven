import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildServer } from './app';
import type { ServerConfig } from './config';
import { MediaProcessor, runFile } from './media';
import { TEST_KEY, cookieOf, removeRoots, startServer } from './test-support';

const CHUNK = 512;
let fixtureRoot: string;
let video: Buffer;
beforeAll(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), 'replayhaven-uploads-'));
  const media = new MediaProcessor({});
  const fixture = join(fixtureRoot, 'test-only.mp4');
  await runFile(media.ffmpeg, [
    '-nostdin',
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=teal:s=160x90:r=10',
    '-t',
    '2',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    fixture,
  ]);
  video = await readFile(fixture);
});
afterAll(async () => {
  await removeRoots();
  if (
    fixtureRoot &&
    resolve(fixtureRoot).startsWith(resolve(tmpdir()) + sep) &&
    fixtureRoot.includes('replayhaven-uploads-')
  )
    await rm(fixtureRoot, { recursive: true, force: true });
});

type Headers = Record<string, string>;
/** A server with small pieces, an admin in the browser and paired PCs. */
async function withServer() {
  const server = await startServer();
  await server.app.close();
  const config = server.config;
  let { app, db } = await buildServer(config, { chunkSize: CHUNK });
  const setup = await app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    payload: { name: 'owner', password: 'owner-password', key: TEST_KEY },
  });
  const admin = { cookie: cookieOf(setup) };
  const pairPc = async (name: string) => {
    const { id, secret } = (
      await app.inject({
        method: 'POST',
        url: '/api/pair/request',
        payload: { deviceId: randomUUID(), name },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/api/pair/${id}/approve`, headers: admin });
    const { token } = (
      await app.inject({ method: 'POST', url: '/api/pair/status', payload: { id, secret } })
    ).json();
    return { authorization: `Bearer ${token as string}` };
  };
  const api = {
    start: (headers: Headers, body: object = {}) =>
      app.inject({
        method: 'POST',
        url: '/api/uploads',
        headers,
        payload: {
          size: video.length,
          name: 'capture.mp4',
          game: 'Test game',
          deviceName: 'PC-1',
          recordedAt: '2026-09-20T18:00:00.000Z',
          clientAnalysis: true,
          ...body,
        },
      }),
    offset: (headers: Headers, id: string) => app.inject({ url: `/api/uploads/${id}`, headers }),
    put: (headers: Headers, id: string, offset: number, piece: Buffer) =>
      app.inject({
        method: 'PUT',
        url: `/api/uploads/${id}?offset=${offset}`,
        headers: { ...headers, 'content-type': 'application/octet-stream' },
        payload: piece,
      }),
    complete: (headers: Headers, id: string) =>
      app.inject({ method: 'POST', url: `/api/uploads/${id}/complete`, headers }),
    abort: (headers: Headers, id: string) =>
      app.inject({ method: 'DELETE', url: `/api/uploads/${id}`, headers }),
    /** Sends the video from `from` up to `to` in pieces; returns the last offset. */
    async send(headers: Headers, id: string, from = 0, to = video.length) {
      let offset = from;
      while (offset < to) {
        const answer = await api.put(
          headers,
          id,
          offset,
          video.subarray(offset, Math.min(offset + CHUNK, to)),
        );
        expect(answer.statusCode, answer.body).toBe(200);
        offset = answer.json().offset;
      }
      return offset;
    },
  };
  const incoming = join(config.dataDir, 'incoming');
  return {
    get app() {
      return app;
    },
    get db() {
      return db;
    },
    config,
    admin,
    pairPc,
    api,
    incoming,
    /** Builds a second server on the same data, as after a restart. */
    async restart() {
      await app.close();
      ({ app, db } = await buildServer(config, { chunkSize: CHUNK }));
    },
  };
}

it('takes a recording in several pieces and stores it like a normal upload', async () => {
  expect(video.length).toBeGreaterThan(3 * CHUNK);
  const vault = await withServer();
  const pc = await vault.pairPc('PC-1');
  const status = (await vault.app.inject({ url: '/api/status', headers: pc })).json();
  expect(status.uploads).toEqual({ resumable: true, chunkSize: CHUNK });
  const started = await vault.api.start(pc);
  expect(started.statusCode).toBe(201);
  const { id, offset, chunkSize } = started.json();
  expect([offset, chunkSize]).toEqual([0, CHUNK]);
  expect(await vault.api.send(pc, id)).toBe(video.length);
  const done = await vault.api.complete(pc, id);
  expect(done.statusCode).toBe(201);
  expect(done.json()).toMatchObject({
    duplicate: false,
    clip: {
      title: 'capture',
      gameName: 'Test game',
      size: video.length,
      recordedAt: '2026-09-20T18:00:00.000Z',
    },
  });
  const stored = vault.db.get(done.json().clip.id)!;
  expect(stored.deviceName).toBe('PC-1');
  expect(stored.expectsClientAnalysis).toBe(true);
  expect(stored.uploader?.session).toBeTruthy();
  expect(await readFile(stored.originalFile)).toEqual(video);
  expect(await readdir(vault.incoming)).toEqual([]);
  expect((await vault.api.offset(pc, id)).statusCode).toBe(404);
  await vault.app.close();
});

it('resumes at the stored position and refuses pieces at the wrong one or too large', async () => {
  const vault = await withServer();
  const pc = await vault.pairPc('PC-1');
  const { id } = (await vault.api.start(pc)).json();
  await vault.api.send(pc, id, 0, 2 * CHUNK);
  expect((await vault.api.offset(pc, id)).json()).toEqual({
    offset: 2 * CHUNK,
    size: video.length,
  });
  // A piece whose answer got lost is sent again: the server names where it stands.
  const again = await vault.api.put(pc, id, CHUNK, video.subarray(CHUNK, 2 * CHUNK));
  expect(again.statusCode).toBe(409);
  expect(again.json().offset).toBe(2 * CHUNK);
  const large = await vault.api.put(pc, id, 2 * CHUNK, video.subarray(2 * CHUNK, 3 * CHUNK + 1));
  expect(large.statusCode).toBe(413);
  expect(large.json().error).toBe('The piece is larger than the server accepts.');
  const early = await vault.api.complete(pc, id);
  expect(early.statusCode).toBe(409);
  expect(early.json()).toEqual({ error: 'The upload is not complete yet.', offset: 2 * CHUNK });
  // Nothing of the refused pieces was kept.
  expect((await vault.api.offset(pc, id)).json().offset).toBe(2 * CHUNK);
  await vault.api.send(pc, id, 2 * CHUNK);
  const beyond = await vault.api.put(pc, id, video.length, Buffer.from('x'));
  expect(beyond.statusCode).toBe(400);
  expect(beyond.json().error).toBe('The piece goes beyond the end of the file.');
  expect((await vault.api.complete(pc, id)).statusCode).toBe(201);
  await vault.app.close();
});

it('drops what an interrupted piece left behind', async () => {
  const vault = await withServer();
  const pc = await vault.pairPc('PC-1');
  const { id } = (await vault.api.start(pc)).json();
  await vault.api.send(pc, id, 0, CHUNK);
  // As if a connection broke in the middle of the second piece.
  await writeFile(join(vault.incoming, `${id}.part`), 'half a piece', { flag: 'a' });
  expect((await vault.api.offset(pc, id)).json().offset).toBe(CHUNK);
  await vault.api.send(pc, id, CHUNK);
  const done = await vault.api.complete(pc, id);
  expect(done.statusCode).toBe(201);
  expect(await readFile(vault.db.get(done.json().clip.id)!.originalFile)).toEqual(video);
  await vault.app.close();
});

it('keeps uploads to the PC that started them', async () => {
  const vault = await withServer();
  const first = await vault.pairPc('PC-1');
  const second = await vault.pairPc('PC-2');
  const { id } = (await vault.api.start(first)).json();
  await vault.api.send(first, id, 0, CHUNK);
  expect((await vault.api.offset(second, id)).statusCode).toBe(404);
  expect((await vault.api.put(second, id, CHUNK, video.subarray(CHUNK))).statusCode).toBe(404);
  expect((await vault.api.complete(second, id)).statusCode).toBe(404);
  expect((await vault.api.abort(second, id)).statusCode).toBe(404);
  expect((await vault.api.offset(vault.admin, id)).statusCode).toBe(404);
  expect((await vault.app.inject({ url: `/api/uploads/${id}` })).statusCode).toBe(401);
  expect((await vault.api.offset(first, id)).json().offset).toBe(CHUNK);
  await vault.app.close();
});

it('answers a completed upload of a known recording as a duplicate', async () => {
  const vault = await withServer();
  const pc = await vault.pairPc('PC-1');
  const first = (await vault.api.start(pc)).json().id as string;
  await vault.api.send(pc, first);
  const clip = (await vault.api.complete(pc, first)).json().clip.id as string;
  const second = (await vault.api.start(pc)).json().id as string;
  await vault.api.send(pc, second);
  const again = await vault.api.complete(pc, second);
  expect(again.statusCode).toBe(200);
  expect(again.json()).toMatchObject({ duplicate: true, clip: { id: clip } });
  expect(await readdir(join(vault.config.dataDir, 'clips'))).toEqual([clip]);
  expect(await readdir(vault.incoming)).toEqual([]);
  await vault.app.close();
});

it('continues an upload after a server restart', async () => {
  const vault = await withServer();
  const pc = await vault.pairPc('PC-1');
  const { id } = (await vault.api.start(pc)).json();
  await vault.api.send(pc, id, 0, 2 * CHUNK);
  // Hours later, as after a night: the plain sweep of cut-off uploads leaves this one alone.
  const hoursAgo = new Date(Date.now() - 2 * 3600_000);
  await utimes(join(vault.incoming, `${id}.part`), hoursAgo, hoursAgo);
  await vault.restart();
  const { offset } = (await vault.api.offset(pc, id)).json();
  expect(offset).toBe(2 * CHUNK);
  await vault.api.send(pc, id, offset);
  expect((await vault.api.complete(pc, id)).statusCode).toBe(201);
  await vault.app.close();
});

it('gives up uploads without progress for a day, and cancels on request', async () => {
  const vault = await withServer();
  const pc = await vault.pairPc('PC-1');
  const stale = (await vault.api.start(pc)).json().id as string;
  const cancelled = (await vault.api.start(pc)).json().id as string;
  await vault.api.send(pc, cancelled, 0, CHUNK);
  const cancel = await vault.api.abort(pc, cancelled);
  expect(cancel.statusCode).toBe(200);
  expect((await vault.api.offset(pc, cancelled)).statusCode).toBe(404);
  expect(await readdir(vault.incoming)).toEqual([`${stale}.json`, `${stale}.part`]);
  const path = join(vault.incoming, `${stale}.json`);
  const state = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(
    path,
    JSON.stringify({ ...state, updatedAt: new Date(Date.now() - 25 * 3600_000).toISOString() }),
  );
  await vault.restart();
  expect((await vault.api.offset(pc, stale)).statusCode).toBe(404);
  expect(await readdir(vault.incoming)).toEqual([]);
  await vault.app.close();
});

it('limits unfinished uploads per PC and checks the announced file', async () => {
  const vault = await withServer();
  const pc = await vault.pairPc('PC-1');
  for (let i = 0; i < 4; i++) expect((await vault.api.start(pc)).statusCode).toBe(201);
  const fifth = await vault.api.start(pc);
  expect(fifth.statusCode).toBe(429);
  expect(fifth.json().error).toBe(
    'Too many unfinished uploads from this device. Finish or cancel one first.',
  );
  // Another PC has its own allowance.
  expect((await vault.api.start(await vault.pairPc('PC-2'))).statusCode).toBe(201);
  const huge = await vault.api.start(pc, { size: 2 * 1024 ** 3 + 1 });
  expect(huge.statusCode).toBe(413);
  expect((await vault.api.start(pc, { name: 'notes.txt' })).statusCode).toBe(400);
  await vault.app.close();
});

it('refuses resumable uploads when the disk is almost full', async () => {
  const server = await startServer();
  await server.app.close();
  const config: ServerConfig = server.config;
  const { app } = await buildServer(config, { freeBytes: async () => 1024 ** 3 });
  const refused = await app.inject({
    method: 'POST',
    url: '/api/uploads',
    headers: { authorization: `Bearer ${TEST_KEY}` },
    payload: { size: 10, name: 'capture.mp4' },
  });
  expect(refused.statusCode).toBe(507);
  await app.close();
});
