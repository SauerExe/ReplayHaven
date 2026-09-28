import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import {
  DeferredError,
  FolderUploader,
  gameLabel,
  recordedGames,
  transientFileError,
} from './watcher';
import type { WatchOptions } from './watcher';
let root: string;
let options: WatchOptions;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'replayhaven-watcher-'));
  const folder = join(root, 'clips');
  await mkdir(folder);
  options = {
    folder,
    server: 'http://localhost:8787',
    token: 'test',
    statePath: join(root, 'state', 'queue.json'),
    game: '',
    includeExisting: true,
    stableMs: 10,
    // The content lookup has its own test; the others stand for older servers without it.
    lookup: false,
  };
});
afterEach(async () => {
  vi.unstubAllGlobals();
  if (
    root &&
    resolve(root).startsWith(resolve(tmpdir()) + sep) &&
    root.includes('replayhaven-watcher-')
  )
    await rm(root, { recursive: true, force: true });
});
it('waits for stable files and reuses cached analysis after an interrupted metadata upload', async () => {
  const file = join(options.folder, 'capture.mp4');
  await writeFile(file, 'test-only bytes');
  const analysis = {
    result: {
      title: 'Test',
      description: 'Test',
      game: 'Detected game',
      tags: [],
      confidence: 'low' as const,
      uncertainty: 'Test data',
      highlights: [],
    },
    duration: 2,
    model: 'test-model',
  };
  const analyze = vi.fn().mockResolvedValue(analysis);
  let metadataAttempts = 0;
  const fetcher = vi.fn(async (url: string, request: RequestInit) => {
    if (url.endsWith('/client-analysis'))
      return new Response('{}', { status: ++metadataAttempts === 1 ? 503 : 200 });
    // The folder name beats the AI's guess; only catch-all profiles give way to it.
    expect((request.headers as Record<string, string>)['x-game-name']).toBe(
      encodeURIComponent(basename(options.folder)),
    );
    return Response.json({ clip: { id: 'test-id' } });
  });
  vi.stubGlobal('fetch', fetcher);
  const first = new FolderUploader({ ...options, analyze });
  await first.initialize();
  await first.scan(100);
  expect(analyze).not.toHaveBeenCalled();
  await first.scan(111);
  expect(first.state.uploaded).toBe(0);
  expect(analyze).toHaveBeenCalledTimes(1);
  const restarted = new FolderUploader({ ...options, analyze });
  await restarted.initialize();
  await restarted.scan(200);
  await restarted.scan(211);
  expect(restarted.state.uploaded).toBe(1);
  expect(analyze).toHaveBeenCalledTimes(1);
  expect(await readFile(file, 'utf8')).toBe('test-only bytes');
  await restarted.scan(300);
  expect(fetcher).toHaveBeenCalledTimes(4);
});
it('skips existing recordings by default and leaves new recordings queued while paused', async () => {
  const existing = join(options.folder, 'old.mp4');
  await writeFile(existing, 'old');
  let paused = true;
  const fetcher = vi.fn().mockResolvedValue(Response.json({ clip: { id: 'new' } }));
  vi.stubGlobal('fetch', fetcher);
  const uploader = new FolderUploader({
    ...options,
    includeExisting: false,
    isPaused: () => paused,
  });
  await uploader.initialize();
  await writeFile(join(options.folder, 'new.mp4'), 'new');
  await uploader.scan(100);
  await uploader.scan(200);
  expect(fetcher).not.toHaveBeenCalled();
  paused = false;
  await uploader.scan(300);
  await uploader.scan(311);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const restarted = new FolderUploader({ ...options, includeExisting: false });
  await restarted.initialize();
  await restarted.scan(400);
  await restarted.scan(411);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('takes the game only from the folder or the explicit setting, and tidies spacing', () => {
  // Measured 2026-09-22: every AI guess was wrong ("Sieg", "Steam", "Kein Ereignis"),
  // so it is no longer a source. Double spaces from NVIDIA folders are dropped.
  expect(gameLabel('', join('G:', 'Clips', 'Valorant', 'a.mp4'))).toBe('Valorant');
  expect(gameLabel('', join('G:', 'Clips', 'Call of Duty  Black Ops 7', 'a.mp4'))).toBe(
    'Call of Duty Black Ops 7',
  );
  expect(gameLabel('', join('G:', 'Clips', 'Desktop', 'a.mp4'))).toBe('Desktop');
  expect(gameLabel('  My Game ', join('G:', 'Clips', 'Valorant', 'a.mp4'))).toBe('My Game');
});

it('suggests the games of existing recordings by the folder the analysis sees', async () => {
  await mkdir(join(options.folder, 'Call of Duty  Black Ops 7'));
  await mkdir(join(options.folder, 'Fortnite', 'Subfolder'), { recursive: true });
  await mkdir(join(options.folder, 'Empty'));
  await writeFile(join(options.folder, 'Call of Duty  Black Ops 7', 'a.mp4'), 'x');
  await writeFile(join(options.folder, 'Fortnite', 'b.mp4'), 'x');
  await writeFile(join(options.folder, 'Fortnite', 'c.mkv'), 'x');
  await writeFile(join(options.folder, 'Fortnite', 'Subfolder', 'd.txt'), 'x');
  expect(await recordedGames(options.folder)).toEqual(['Call of Duty Black Ops 7', 'Fortnite']);
});

it('keeps a deferred recording queued without reporting an error', async () => {
  const file = join(options.folder, 'Fortnite 2026.09.24 - 21.10.00.07.DVR.mp4');
  await writeFile(file, 'test-only bytes');
  const analysis = {
    result: {
      title: 'Doppel-Kill im Turm',
      description: 'Test',
      game: 'Fortnite',
      tags: [],
      confidence: 'high' as const,
      uncertainty: '',
      highlights: [],
    },
    duration: 20,
    model: 'test-model',
  };
  const analyze = vi
    .fn()
    .mockRejectedValueOnce(new DeferredError('Waiting for the Fortnite match to end …'))
    .mockResolvedValue(analysis);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.endsWith('/client-analysis') ? new Response('{}') : Response.json({ clip: { id: 'c1' } }),
    ),
  );
  const statuses: string[] = [];
  const agent = new FolderUploader({ ...options, analyze, onStatus: (m) => statuses.push(m) });
  await agent.initialize();
  await agent.scan(100);
  await agent.scan(111);
  expect(agent.error).toBe('');
  expect(agent.state.uploaded).toBe(0);
  expect(statuses.at(-1)).toMatch(/Waiting/);
  // No new attempt before the minute is up, but one after it.
  await agent.scan(30000);
  expect(analyze).toHaveBeenCalledTimes(1);
  await agent.scan(60200);
  expect(analyze).toHaveBeenCalledTimes(2);
  expect(agent.state.uploaded).toBe(1);
});

it('names the game of a Desktop recording from the foreground and reports the upload', async () => {
  const desktop = join(options.folder, 'Desktop');
  await mkdir(desktop);
  const file = join(desktop, 'Desktop 2026.09.25 - 21.00.00.02.DVR.mp4');
  await writeFile(file, 'test-only bytes');
  const games: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, request: RequestInit) => {
      games.push(decodeURIComponent((request.headers as Record<string, string>)['x-game-name']));
      return Response.json({ clip: { id: 'test-id' } });
    }),
  );
  const analyze = vi.fn().mockRejectedValue(new Error('only the game name matters'));
  const gameFor = vi.fn(() => "Tom Clancy's Rainbow Six Siege");
  const onUploaded = vi.fn();
  const uploader = new FolderUploader({ ...options, gameFor, onUploaded });
  await uploader.initialize();
  await uploader.scan(100);
  await uploader.scan(111);
  expect(gameFor).toHaveBeenCalledWith(file, expect.any(Number));
  expect(games).toEqual(["Tom Clancy's Rainbow Six Siege"]);
  expect(onUploaded).toHaveBeenCalledWith(
    file,
    "Tom Clancy's Rainbow Six Siege",
    expect.any(Number),
  );
  expect(analyze).not.toHaveBeenCalled();
  // A game folder stays as it is.
  expect(gameFor).toHaveBeenCalledTimes(1);
});

it('reports the queue, the clip in work and the archived clips with their titles', async () => {
  const game = join(options.folder, 'Valorant');
  await mkdir(game);
  for (const name of ['a.mp4', 'b.mp4']) await writeFile(join(game, name), `bytes ${name}`);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.endsWith('/client-analysis')
        ? new Response('{}')
        : Response.json({ clip: { id: `id-${url.length}` } }),
    ),
  );
  const seen: { queue: string[]; active?: string; stage?: string }[] = [];
  const analyze = vi.fn(async () => ({
    result: {
      title: 'Doppel-Kill per Kopfschuss',
      description: '',
      game: '',
      tags: ['Kill', 'Multikill'],
      confidence: 'high' as const,
      uncertainty: '',
      highlights: [],
    },
    duration: 2,
    model: 'test-model',
  }));
  const uploader = new FolderUploader({
    ...options,
    analyze,
    onQueue: (queue, active) =>
      seen.push({
        queue: queue.map((e) => `${e.name}:${e.state}`),
        ...(active ? { active: active.name, stage: active.stage } : {}),
      }),
  });
  await uploader.initialize();
  await uploader.scan(100);
  // At first sight both files are still being written.
  expect(seen[0]).toEqual({ queue: ['a.mp4:settling', 'b.mp4:settling'] });
  await uploader.scan(111);
  expect(seen).toContainEqual({ queue: ['b.mp4:waiting'], active: 'a.mp4', stage: 'analyzing' });
  expect(seen).toContainEqual({ queue: ['b.mp4:waiting'], active: 'a.mp4', stage: 'uploading' });
  expect(seen.at(-1)).toEqual({ queue: [] });
  expect(uploader.recent.map((r) => [r.name, r.game, r.title, r.tags])).toEqual([
    ['b.mp4', 'Valorant', 'Doppel-Kill per Kopfschuss', ['Kill', 'Multikill']],
    ['a.mp4', 'Valorant', 'Doppel-Kill per Kopfschuss', ['Kill', 'Multikill']],
  ]);
});

it('notices new recordings during a game and uploads them right after it without waiting again', async () => {
  const file = join(options.folder, 'in-game.mp4');
  await writeFile(file, 'test-only bytes');
  const upload = vi.fn(async () => Response.json({ clip: { id: 'test-id' } }));
  vi.stubGlobal('fetch', upload);
  let gaming = true;
  const seen: string[][] = [];
  const uploader = new FolderUploader({
    ...options,
    stableMs: 10_000,
    isPaused: () => gaming,
    onQueue: (queue) => seen.push(queue.map((e) => `${e.name}:${e.state}`)),
  });
  await uploader.initialize();
  // During the game: queued and watched, but not uploaded.
  await uploader.scan(0);
  await uploader.scan(30_000);
  expect(seen.at(-1)).toEqual(['in-game.mp4:waiting']);
  expect(upload).not.toHaveBeenCalled();
  // After the game the file is long finished: the first look uploads it.
  gaming = false;
  await uploader.scan(31_000);
  expect(upload).toHaveBeenCalledTimes(1);
  expect(uploader.state.uploaded).toBe(1);
});

it('skips analysis and upload for a recording the archive already holds', async () => {
  const file = join(options.folder, 'schon-da.mp4');
  await writeFile(file, 'same bytes as on the server');
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256').update('same bytes as on the server').digest('hex');
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url.replace(options.server, ''));
      return Response.json({ clip: url.endsWith(`/lookup/${hash}`) ? { id: 'known' } : null });
    }),
  );
  const analyze = vi.fn();
  const statuses: string[] = [];
  const uploader = new FolderUploader({
    ...options,
    lookup: true,
    analyze,
    onStatus: (m) => statuses.push(m),
  });
  await uploader.initialize();
  await uploader.scan(100);
  await uploader.scan(111);
  expect(calls).toEqual([`/api/clips/lookup/${hash}`]);
  expect(analyze).not.toHaveBeenCalled();
  expect(uploader.state.receipts[file]).toMatchObject({ clipId: 'known' });
  expect(statuses.at(-1)).toMatch(/Already in the archive/);
  // Afterwards the recording counts as done and is not checked again.
  await uploader.scan(200);
  expect(calls).toHaveLength(1);
});

it('delivers a cached AI result when the video already reached the archive in an earlier attempt', async () => {
  const file = join(options.folder, 'halb-fertig.mp4');
  await writeFile(file, 'uploaded bytes');
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256').update('uploaded bytes').digest('hex');
  const analysis = {
    result: {
      title: 'Ace',
      description: 'Test',
      game: '',
      tags: ['Ace'],
      confidence: 'high' as const,
      uncertainty: '',
      highlights: [],
    },
    duration: 2,
    model: 'test-model',
  };
  let uploaded = false;
  let analysisAttempts = 0;
  const delivered: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, request: RequestInit) => {
      if (url.includes('/lookup/'))
        return Response.json({ clip: uploaded && url.endsWith(hash) ? { id: 'clip-1' } : null });
      if (url.endsWith('/client-analysis')) {
        // The first delivery fails after the video is stored, as with a dropped connection.
        if (++analysisAttempts === 1) return new Response('{}', { status: 503 });
        delivered.push(JSON.parse(String(request.body)));
        return Response.json({});
      }
      uploaded = true;
      return Response.json({ clip: { id: 'clip-1' } });
    }),
  );
  const analyze = vi.fn().mockResolvedValue(analysis);
  const uploader = new FolderUploader({ ...options, lookup: true, analyze });
  await uploader.initialize();
  await uploader.scan(100);
  await uploader.scan(111);
  expect(uploader.state.receipts[file]).toBeUndefined();
  // The retry finds the video by its content and still hands over the AI result.
  await uploader.scan(111 + 61000);
  expect(uploader.state.receipts[file]).toMatchObject({ clipId: 'clip-1' });
  expect(delivered).toEqual([analysis]);
  expect(analyze).toHaveBeenCalledTimes(1);
  const { readdir } = await import('node:fs/promises');
  expect(await readdir(join(root, 'state', 'analysis-cache')).catch(() => [])).toEqual([]);
});

it('waits longer after every failed attempt, up to half an hour', async () => {
  const file = join(options.folder, 'offline.mp4');
  await writeFile(file, 'bytes');
  const fetcher = vi.fn(async () => new Response('{}', { status: 502 }));
  vi.stubGlobal('fetch', fetcher);
  const uploader = new FolderUploader(options);
  await uploader.initialize();
  await uploader.scan(0);
  let now = 11;
  await uploader.scan(now);
  const uploads = () => fetcher.mock.calls.length;
  expect(uploads()).toBe(1);
  // 1, 2, 4, 8, 16 minutes, then capped at 30.
  for (const minutes of [1, 2, 4, 8, 16, 30, 30]) {
    await uploader.scan(now + minutes * 60000 - 1000);
    const before = uploads();
    now += minutes * 60000;
    await uploader.scan(now);
    expect(uploads(), `after ${minutes} min`).toBe(before + 1);
  }
});

it('keeps unconfirmed recordings queued after the server address changed', async () => {
  const uploaded = join(options.folder, 'uploaded.mp4');
  const waiting = join(options.folder, 'waiting.mp4');
  await writeFile(uploaded, 'uploaded');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ clip: { id: 'a' } })));
  const first = new FolderUploader({ ...options, includeExisting: true });
  await first.initialize();
  await first.scan(0);
  await first.scan(11);
  expect(first.state.receipts[uploaded]).toBeDefined();
  // A new recording arrives, then the address changes before it was uploaded.
  await writeFile(waiting, 'waiting');
  const fetcher = vi.fn().mockResolvedValue(Response.json({ clip: { id: 'b' } }));
  vi.stubGlobal('fetch', fetcher);
  const moved = new FolderUploader({
    ...options,
    server: 'http://nas:8787',
    statePath: join(root, 'state', 'other-server.json'),
    includeExisting: false,
  });
  await moved.initialize();
  expect(Object.keys(moved.state.receipts)).toEqual([uploaded]);
  await moved.scan(100);
  await moved.scan(111);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(moved.state.receipts[waiting]).toMatchObject({ clipId: 'b' });
});

it('recognises a queue file from before the folder was stored', async () => {
  const done = join(options.folder, 'done.mp4');
  await writeFile(done, 'done');
  await writeFile(join(options.folder, 'open.mp4'), 'open');
  await mkdir(join(root, 'state'), { recursive: true });
  await writeFile(
    join(root, 'state', 'old.json'),
    JSON.stringify({ id: 'x', uploaded: 1, receipts: { [done]: { fingerprint: '1:1' } } }),
  );
  // The queue of another folder is no source.
  await writeFile(
    join(root, 'state', 'elsewhere.json'),
    JSON.stringify({
      id: 'y',
      uploaded: 0,
      folder: join(root, 'elsewhere'),
      receipts: { [join(root, 'elsewhere', 'z.mp4')]: { fingerprint: '1:1' } },
    }),
  );
  const uploader = new FolderUploader({ ...options, includeExisting: false });
  await uploader.initialize();
  expect(Object.keys(uploader.state.receipts)).toEqual([done]);
  expect(uploader.state.folder).toBe(resolve(options.folder));
});

it('moves a damaged queue file aside and starts a new one', async () => {
  const existing = join(options.folder, 'existing.mp4');
  await writeFile(existing, 'x');
  await mkdir(join(root, 'state'), { recursive: true });
  await writeFile(options.statePath, '{"receipts": {');
  const statuses: string[] = [];
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const uploader = new FolderUploader({
    ...options,
    includeExisting: false,
    onStatus: (m) => statuses.push(m),
  });
  await uploader.initialize();
  error.mockRestore();
  const { readdir } = await import('node:fs/promises');
  const files = await readdir(join(root, 'state'));
  expect(files.filter((f) => f.endsWith('.corrupt'))).toHaveLength(1);
  expect(JSON.parse(await readFile(options.statePath, 'utf8')).receipts).toHaveProperty([existing]);
  expect(statuses).toEqual(['The queue file was damaged and has been replaced.']);
  // The next start reads the new file without trouble.
  await new FolderUploader(options).initialize();
});

it('stops an upload when a game starts and continues after it without counting a failure', async () => {
  FolderUploader.pausePollMs = 10;
  const file = join(options.folder, 'big.mp4');
  await writeFile(file, 'bytes');
  let gaming = false;
  let attempt = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url: string, request: RequestInit) =>
        new Promise<Response>((done, fail) => {
          if (++attempt > 1) return done(Response.json({ clip: { id: 'late' } }));
          // The first upload hangs until it is aborted; meanwhile a game starts.
          gaming = true;
          request.signal!.addEventListener('abort', () => fail(request.signal!.reason));
        }),
    ),
  );
  const statuses: string[] = [];
  const uploader = new FolderUploader({
    ...options,
    isPaused: () => gaming,
    onStatus: (m) => statuses.push(m),
  });
  try {
    await uploader.initialize();
    await uploader.scan(0);
    await uploader.scan(11);
    expect(statuses.at(-1)).toBe('Upload paused: big.mp4');
    expect(uploader.error).toBe('');
    expect(uploader.queue.map((e) => e.state)).toEqual(['waiting']);
    // Right after the game, without a backoff.
    gaming = false;
    await uploader.scan(20);
    expect(uploader.state.receipts[file]).toMatchObject({ clipId: 'late' });
  } finally {
    FolderUploader.pausePollMs = 1000;
  }
});

it('counts the wait before a retry from the end of a long attempt', async () => {
  await writeFile(join(options.folder, 'slow.mp4'), 'bytes');
  const start = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
  // The analysis takes ten minutes, then the upload fails.
  const analyze = vi.fn(async () => {
    clock.mockReturnValue(start + 10 * 60000);
    return {
      result: {
        title: 'T',
        description: '',
        game: '',
        tags: [],
        confidence: 'low' as const,
        uncertainty: '',
        highlights: [],
      },
      duration: 1,
      model: 'm',
    };
  });
  const fetcher = vi.fn(async () => new Response('{}', { status: 502 }));
  vi.stubGlobal('fetch', fetcher);
  const uploader = new FolderUploader({ ...options, analyze });
  try {
    await uploader.initialize();
    await uploader.scan(0);
    await uploader.scan(11);
    expect(fetcher).toHaveBeenCalledTimes(1);
    // Two minutes after the scan started the attempt had only just ended: no new try yet.
    await uploader.scan(11 + 2 * 60000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await uploader.scan(11 + 11 * 60000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  } finally {
    clock.mockRestore();
  }
});

it('retries a recording that is locked or whose probe timed out, but skips a broken one', async () => {
  const locked = join(options.folder, 'locked.mp4');
  const broken = join(options.folder, 'broken.mp4');
  await writeFile(locked, 'locked');
  await writeFile(broken, 'broken');
  let lockedFails = true;
  const probe = vi.fn(async (path: string) => {
    if (path === broken)
      throw new Error('Choose a readable video of at most 30 minutes and at most 8K resolution.');
    if (lockedFails)
      throw Object.assign(new Error('Media processing exceeded its time limit.'), { detail: '' });
  });
  const fetcher = vi.fn().mockResolvedValue(Response.json({ clip: { id: 'ok' } }));
  vi.stubGlobal('fetch', fetcher);
  const uploader = new FolderUploader({ ...options, probe });
  await uploader.initialize();
  await uploader.scan(0);
  await uploader.scan(11);
  expect(uploader.rejected.has(broken)).toBe(true);
  expect(uploader.rejected.has(locked)).toBe(false);
  expect(uploader.queue.find((e) => e.path === locked)).toMatchObject({ state: 'retry' });
  lockedFails = false;
  await uploader.scan(11 + 61000);
  expect(uploader.state.receipts[locked]).toMatchObject({ clipId: 'ok' });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(transientFileError(Object.assign(new Error('x'), { code: 'EBUSY' }))).toBe(true);
  expect(transientFileError(new Error('The video file could not be processed.'))).toBe(false);
});

it('drops a cached AI result when another PC already uploaded the same file', async () => {
  const file = join(options.folder, 'shared.mp4');
  await writeFile(file, 'shared bytes');
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256').update('shared bytes').digest('hex');
  // An AI result left from an earlier attempt, as the watcher caches it.
  const { size, mtimeMs } = await stat(file);
  const key = createHash('sha256').update(`${file}:${size}:${mtimeMs}`).digest('hex');
  const cachePath = join(root, 'state', 'analysis-cache', `${key}.json`);
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify({ result: {}, duration: 1, model: 'm' }));
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url.replace(options.server, ''));
      if (url.includes('/lookup/'))
        return Response.json({ clip: url.endsWith(hash) ? { id: 'theirs' } : null });
      return Response.json({ error: 'This clip was uploaded by another PC.' }, { status: 403 });
    }),
  );
  const uploader = new FolderUploader({ ...options, lookup: true, analyze: vi.fn() });
  await uploader.initialize();
  await uploader.scan(100);
  await uploader.scan(111);
  expect(calls).toEqual([`/api/clips/lookup/${hash}`, '/api/clips/theirs/client-analysis']);
  expect(uploader.state.receipts[file]).toMatchObject({ clipId: 'theirs' });
  expect(uploader.error).toBe('');
  const { readdir } = await import('node:fs/promises');
  expect(await readdir(dirname(cachePath))).toEqual([]);
});
