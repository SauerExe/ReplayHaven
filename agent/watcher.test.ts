import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { FolderUploader, gameLabel } from './watcher';
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
