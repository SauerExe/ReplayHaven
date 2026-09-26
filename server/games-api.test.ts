import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { buildServer } from './app';
import type { ServerConfig } from './config';
import type { StoredClip } from './database';
import { MediaProcessor } from './media';
import type { AnalysisResult } from './schema';

let root: string;
let vault: Awaited<ReturnType<typeof buildServer>>;
let config: ServerConfig;
let media: MediaProcessor;
const token = 'metadata-test-token-with-32-characters';
const headers = { authorization: `Bearer ${token}` };
const result: AnalysisResult = {
  title: 'Testaufnahme',
  description: 'Künstliches Testergebnis.',
  game: 'Raft',
  tags: [],
  confidence: 'high',
  uncertainty: '',
  highlights: [],
};
const provider = { analyze: async () => result };
function clip(gameName = '', patch: Partial<StoredClip> = {}): StoredClip {
  const id = randomUUID();
  return {
    id,
    title: 'Testaufnahme',
    gameId: 'recording',
    gameName,
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
    originalFile: join(root, 'capture.mp4'),
    ...patch,
  };
}
async function settled() {
  await expect.poll(() => vault.games.status().pending).toBe(0);
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'replayhaven-games-api-'));
  config = {
    host: '127.0.0.1',
    port: 8787,
    gameMetadata: true,
    dataDir: root,
    token,
    publicOrigin: 'http://localhost:5173',
    provider: 'local',
    model: 'test-only',
    geminiKey: '',
    localUrl: '',
    localKey: '',
  };
  media = new MediaProcessor(config);
  const meta = { duration: 2, width: 320, height: 180, codec: 'h264', hasAudio: false, audio: [] };
  vi.spyOn(media, 'probe').mockResolvedValue(meta);
  vi.spyOn(media, 'prepare').mockImplementation(async (original) => ({
    ...meta,
    playbackFile: original,
  }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('SearchApps')) return Response.json([{ appid: '648800', name: 'Raft' }]);
      if (url.includes('appdetails'))
        return Response.json({ '648800': { success: true, data: { name: 'Raft', type: 'game' } } });
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
        headers: { 'content-type': 'image/jpeg' },
      });
    }),
  );
  vault = await buildServer(config, { media, provider });
});
afterEach(async () => {
  await vault.app.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('replayhaven-games-api-'))
    await rm(root, { recursive: true, force: true });
});

it('loads game metadata after an upload and serves the cached cover through the authenticated API', async () => {
  const response = await vault.app.inject({
    method: 'POST',
    url: '/api/clips',
    headers: {
      ...headers,
      'x-game-name': 'Raft',
      'x-client-analysis': '1',
      'content-type': 'multipart/form-data; boundary=game-test',
    },
    payload:
      '--game-test\r\nContent-Disposition: form-data; name="file"; filename="capture.mp4"\r\nContent-Type: video/mp4\r\n\r\ntest-video\r\n--game-test--\r\n',
  });
  expect(response.statusCode).toBe(201);
  await settled();
  const listing = await vault.app.inject({ url: '/api/games', headers });
  expect(listing.json()[0]).toMatchObject({ label: 'Raft', name: 'Raft' });
  const cover = listing.json()[0].cover;
  expect(cover).toContain('/api/games/raft/cover?v=');
  expect((await vault.app.inject(cover)).statusCode).toBe(401);
  expect((await vault.app.inject({ url: cover, headers })).statusCode).toBe(200);
});

it('loads game info from client analysis and looks up a manually corrected game immediately', async () => {
  const stored = clip();
  vault.db.put(stored);
  const response = await vault.app.inject({
    method: 'POST',
    url: `/api/clips/${stored.id}/client-analysis`,
    headers,
    payload: { result, duration: 2, model: 'test' },
  });
  expect(response.statusCode).toBe(200);
  expect(response.json().gameName).toBe('Raft');
  await settled();
  expect(vault.db.game('raft')?.status).toBe('ready');
  const edited = await vault.app.inject({
    method: 'PATCH',
    url: `/api/clips/${stored.id}`,
    headers,
    payload: { gameName: 'Minecraft' },
  });
  expect(edited.statusCode).toBe(200);
  await settled();
  expect(vault.db.game('minecraft')?.status).toBe('not_found');
});

it('persists the server-AI game and automatically schedules its metadata', async () => {
  const stored = clip('', { analysis: { status: 'queued' } });
  vault.db.put(stored);
  vault.worker.kick();
  await expect.poll(() => vault.db.get(stored.id)?.analysis?.status).toBe('ready');
  await settled();
  expect(vault.db.get(stored.id)?.gameName).toBe('Raft');
  expect(vault.db.game('raft')?.status).toBe('ready');
});

it('refreshes only games in the visible archive, reports counts and enforces access checks', async () => {
  vault.db.put(clip('Raft'));
  vault.db.put(clip('RAFT™'));
  vault.db.put(clip('Minecraft', { deleted: true }));
  expect((await vault.app.inject({ method: 'POST', url: '/api/games/refresh' })).statusCode).toBe(
    401,
  );
  expect(
    (
      await vault.app.inject({
        method: 'POST',
        url: '/api/games/refresh',
        headers: { ...headers, origin: 'https://foreign.invalid' },
      })
    ).statusCode,
  ).toBe(403);
  const response = await vault.app.inject({ method: 'POST', url: '/api/games/refresh', headers });
  expect(response.statusCode).toBe(202);
  expect(response.json()).toEqual({ queued: 1 });
  await settled();
  const status = await vault.app.inject({ url: '/api/status', headers });
  expect(status.json().gameMetadata).toEqual({
    enabled: true,
    total: 1,
    matched: 1,
    missing: 0,
    failed: 0,
    pending: 0,
  });
  expect(vault.db.game('minecraft')).toBeUndefined();
});

it('backfills old clips on startup and retries failed entries on the hourly pass', async () => {
  vault.db.put(clip('Raft'));
  await vault.app.close();
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  vault = await buildServer(config, { media, provider });
  await settled();
  expect(vault.db.game('raft')?.status).toBe('ready');
  vault.db.putGame({
    ...vault.db.game('raft')!,
    status: 'error',
    checkedAt: new Date(Date.now() - 3600000).toISOString(),
  });
  await vi.advanceTimersByTimeAsync(3600000);
  await settled();
  expect(vault.db.game('raft')?.status).toBe('ready');
});

it('keeps cached data but refuses new lookups when disabled', async () => {
  vault.db.put(clip('Raft'));
  await vault.app.close();
  vault = await buildServer({ ...config, gameMetadata: false }, { media, provider });
  const response = await vault.app.inject({ method: 'POST', url: '/api/games/refresh', headers });
  expect(response.statusCode).toBe(409);
  expect(fetch).not.toHaveBeenCalled();
});
