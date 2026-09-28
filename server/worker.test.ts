import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { VaultDatabase } from './database';
import type { StoredClip } from './database';
import type { ServerConfig } from './config';
import type { MediaProcessor } from './media';
import type { AnalysisProvider } from './providers';
import { AnalysisWorker } from './worker';
import { PlaybackBackfill } from './playback';

const config: ServerConfig = {
  host: '127.0.0.1',
  port: 8787,
  gameMetadata: false,
  dataDir: join(tmpdir(), 'replayhaven-worker-unused'),
  token: '',
  publicOrigin: 'http://localhost:5173',
  provider: 'none',
  model: '',
  geminiKey: '',
  localUrl: '',
  localKey: '',
};
const provider: AnalysisProvider = {
  analyze: () => Promise.reject(new Error('not used')),
} as unknown as AnalysisProvider;
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    if (resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('replayhaven-worker-'))
      await rm(root, { recursive: true, force: true });
});

it('survives a failing database without an unhandled rejection', async () => {
  const unhandled: unknown[] = [];
  const listener = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', listener);
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const broken = {
      list: () => {
        throw new Error('database or disk is full');
      },
    } as unknown as VaultDatabase;
    const worker = new AnalysisWorker(broken, config, {} as MediaProcessor, provider);
    worker.kick();
    const backfill = new PlaybackBackfill(broken, config.dataDir, {} as MediaProcessor, 'web');
    backfill.kick();
    await new Promise((done) => setTimeout(done, 50));
    expect(unhandled).toEqual([]);
    expect(logged.mock.calls.flat().join('\n')).toMatch(/Analysis queue stopped.*disk is full/s);
    expect(logged.mock.calls.flat().join('\n')).toMatch(/Playback backfill stopped/);
    await worker.stop();
    await backfill.stop();
  } finally {
    process.off('unhandledRejection', listener);
  }
});

it('keeps a result the PC delivered while preparing the video failed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'replayhaven-worker-'));
  roots.push(root);
  const db = new VaultDatabase(root);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const id = randomUUID();
  const delivered = {
    status: 'ready' as const,
    provider: 'client',
    model: 'test-only',
    input: 'frames' as const,
    updatedAt: new Date().toISOString(),
  };
  const media = {
    // The result arrives while FFmpeg is still busy, then FFmpeg fails.
    prepare: async () => {
      db.patch(id, { analysis: delivered as StoredClip['analysis'] });
      throw new Error('broken video');
    },
  } as unknown as MediaProcessor;
  db.put({
    id,
    title: 'Clip',
    gameId: 'recording',
    gameName: '',
    thumbnail: '',
    duration: 0,
    recordedAt: new Date().toISOString(),
    size: 10,
    resolution: '',
    tags: [],
    favorite: false,
    status: 'processing',
    note: '',
    server: true,
    originalName: 'capture.mp4',
    originalFile: join(root, 'capture.mp4'),
    hash: id,
    expectsClientAnalysis: true,
    analysis: { status: 'preparing' },
  });
  const worker = new AnalysisWorker(db, { ...config, dataDir: root }, media, provider);
  await worker.drain();
  expect(db.get(id)).toMatchObject({ status: 'error', analysis: delivered });
  db.close();
});

it('stops without waiting forever for a clip in progress', async () => {
  const hanging = {
    list: () => [{ id: randomUUID(), status: 'processing', originalFile: 'x.mp4' }],
    get: () => undefined,
  } as unknown as VaultDatabase;
  const media = { prepare: () => new Promise(() => {}) } as unknown as MediaProcessor;
  const worker = new AnalysisWorker(hanging, config, media, provider);
  worker.kick();
  const started = Date.now();
  await worker.stop(100);
  expect(Date.now() - started).toBeLessThan(2000);
});
