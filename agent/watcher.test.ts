import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { DeferredError, FolderUploader, gameLabel, recordedGames } from './watcher';
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
      game: 'Erkanntes Spiel',
      tags: [],
      confidence: 'low' as const,
      uncertainty: 'Testdaten',
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
    // Der Ordnername gewinnt gegen die Schaetzung der KI; nur Auffangprofile weichen ihr.
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
  // Gemessen 2026-09-22: jede KI-Schätzung war falsch ("Sieg", "Steam", "Kein Ereignis"),
  // deshalb ist sie keine Quelle mehr. Doppelte Leerzeichen aus NVIDIA-Ordnern fallen weg.
  expect(gameLabel('', join('G:', 'Clips', 'Valorant', 'a.mp4'))).toBe('Valorant');
  expect(gameLabel('', join('G:', 'Clips', 'Call of Duty  Black Ops 7', 'a.mp4'))).toBe(
    'Call of Duty Black Ops 7',
  );
  expect(gameLabel('', join('G:', 'Clips', 'Desktop', 'a.mp4'))).toBe('Desktop');
  expect(gameLabel('  Mein Spiel ', join('G:', 'Clips', 'Valorant', 'a.mp4'))).toBe('Mein Spiel');
});

it('suggests the games of existing recordings by the folder the analysis sees', async () => {
  await mkdir(join(options.folder, 'Call of Duty  Black Ops 7'));
  await mkdir(join(options.folder, 'Fortnite', 'Unterordner'), { recursive: true });
  await mkdir(join(options.folder, 'Leer'));
  await writeFile(join(options.folder, 'Call of Duty  Black Ops 7', 'a.mp4'), 'x');
  await writeFile(join(options.folder, 'Fortnite', 'b.mp4'), 'x');
  await writeFile(join(options.folder, 'Fortnite', 'c.mkv'), 'x');
  await writeFile(join(options.folder, 'Fortnite', 'Unterordner', 'd.txt'), 'x');
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
    .mockRejectedValueOnce(new DeferredError('Wartet auf das Ende des Fortnite-Matches …'))
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
  expect(statuses.at(-1)).toMatch(/Wartet/);
  // Vor Ablauf der Minute wird nicht erneut gefragt, danach schon.
  await agent.scan(30000);
  expect(analyze).toHaveBeenCalledTimes(1);
  await agent.scan(60200);
  expect(analyze).toHaveBeenCalledTimes(2);
  expect(agent.state.uploaded).toBe(1);
});
