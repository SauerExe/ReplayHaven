import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { VaultDatabase, type StoredGame } from './database';
import { GameLibrary, needsLookup } from './games';

let directory: string;
let db: VaultDatabase;
let games: GameLibrary;
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]);
const details = {
  name: 'Raft',
  type: 'game',
  short_description: 'Auf einem Floß überleben.',
  genres: [{ description: 'Abenteuer' }],
  release_date: { date: '20. Juni 2022' },
};
function steam(url: string) {
  if (url.includes('SearchApps')) return Response.json([{ appid: '648800', name: 'Raft' }]);
  if (url.includes('appdetails'))
    return Response.json({ '648800': { success: true, data: details } });
  return new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } });
}
async function settled() {
  await expect.poll(() => games.status().pending).toBe(0);
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'replayhaven-games-'));
  db = new VaultDatabase(directory);
  games = new GameLibrary(db, join(directory, 'covers'), true);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => steam(url)),
  );
});
afterEach(async () => {
  await games.stop();
  db.close();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (
    resolve(directory).startsWith(resolve(tmpdir()) + sep) &&
    directory.includes('replayhaven-games-')
  )
    await rm(directory, { recursive: true, force: true });
});

it('deduplicates normalized names, downloads a local cover and skips fresh cache entries', async () => {
  expect(games.schedule('Raft')).toBe(true);
  expect(games.schedule('RAFT™')).toBe(false);
  await settled();
  const entry = db.game('raft')!;
  expect(entry).toMatchObject({ status: 'ready', info: { name: 'Raft', appId: 648800 } });
  expect(await readFile(join(directory, 'covers', entry.info!.cover!))).toEqual(Buffer.from(jpeg));
  expect(games.schedule('Raft')).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('falls back to the Steam header when the portrait cover is missing', async () => {
  const fetcher = vi.fn(async (url: string) =>
    url.includes('library_600x900') ? new Response('', { status: 404 }) : steam(url),
  );
  vi.stubGlobal('fetch', fetcher);
  games.schedule('Raft');
  await settled();
  expect(db.game('raft')?.status).toBe('ready');
  expect(fetcher.mock.calls.at(-1)?.[0]).toContain('/header.jpg');
});

it('keeps useful metadata when images fail and retries the cover later', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.endsWith('.jpg')
        ? new Response('<html>not an image</html>', { headers: { 'content-type': 'image/jpeg' } })
        : steam(url),
    ),
  );
  games.schedule('Raft');
  await settled();
  const entry = db.game('raft')!;
  expect(entry).toMatchObject({ status: 'error', info: { name: 'Raft' } });
  expect(entry.info?.cover).toBeUndefined();
  expect(needsLookup(entry, Date.parse(entry.checkedAt) + 3600000)).toBe(true);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => steam(url)),
  );
  expect(games.schedule('Raft', true)).toBe(true);
  await settled();
  expect(db.game('raft')?.info?.cover).toBeTruthy();
});

it('preserves cached metadata and cover after a failed forced refresh', async () => {
  games.schedule('Raft');
  await settled();
  const previous = db.game('raft')!.info;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('', { status: 503 })),
  );
  games.schedule('Raft', true);
  await settled();
  expect(db.game('raft')).toMatchObject({ status: 'error', info: previous });
  expect(await readFile(join(directory, 'covers', previous!.cover!))).toEqual(Buffer.from(jpeg));
});

it('distinguishes no match from a service failure and expires each at its own interval', async () => {
  games.schedule('Minecraft');
  await settled();
  const missing = db.game('minecraft')!;
  expect(missing.status).toBe('not_found');
  const now = Date.parse(missing.checkedAt);
  expect(needsLookup(missing, now + 3600000)).toBe(false);
  expect(needsLookup(missing, now + 14 * 86400000)).toBe(true);
  const error = { ...missing, status: 'error' } as StoredGame;
  expect(needsLookup(error, now + 3599999)).toBe(false);
  expect(needsLookup(error, now + 3600000)).toBe(true);
  games.schedule('Raft');
  await settled();
  const ready = db.game('raft')!;
  expect(needsLookup(ready, Date.parse(ready.checkedAt) + 29 * 86400000)).toBe(false);
  expect(needsLookup(ready, Date.parse(ready.checkedAt) + 30 * 86400000)).toBe(true);
});

it('does not let one database write failure poison the background queue', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(db, 'putGame').mockImplementationOnce(() => {
    throw new Error('disk busy');
  });
  games.schedule('Unknown');
  games.schedule('Raft');
  await settled();
  expect(db.game('raft')?.status).toBe('ready');
});

it('aborts active requests and skips queued work before closing the database', async () => {
  const fetcher = vi.fn(
    (_url: string, options: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        options.signal!.addEventListener('abort', () => reject(options.signal!.reason), {
          once: true,
        });
      }),
  );
  vi.stubGlobal('fetch', fetcher);
  games.schedule('Raft');
  games.schedule('Another game');
  await expect.poll(() => fetcher.mock.calls.length).toBe(1);
  await games.stop();
  expect(games.status().pending).toBe(0);
  expect(db.games()).toEqual([]);
  expect(games.schedule('Raft')).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('does not make external requests when disabled', async () => {
  await games.stop();
  games = new GameLibrary(db, join(directory, 'covers'), false);
  expect(games.backfill(['Raft'], true)).toBe(0);
  expect(fetch).not.toHaveBeenCalled();
});
