import { afterAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { VaultDatabase } from './database';
import type { StoredClip } from './database';
import {
  MediaProcessor,
  isFastStart,
  planPlayback,
  playbackArgs,
  runFile,
  type MediaInfo,
} from './media';
import { PlaybackBackfill } from './playback';
import { TEST_KEY, removeRoots, startServer } from './test-support';

const roots: string[] = [];
afterAll(async () => {
  await removeRoots();
  for (const root of roots)
    if (resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('replayhaven-playback-'))
      await rm(root, { recursive: true, force: true }).catch(() => {});
});
async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), 'replayhaven-playback-'));
  roots.push(root);
  return root;
}
/** What ffprobe reports for an NVIDIA App recording: 1080p120 H.264 at ~50 Mbit/s. */
const nvidia: MediaInfo = {
  duration: 60,
  width: 1920,
  height: 1080,
  codec: 'h264',
  hasAudio: true,
  audio: [{ index: 0, codec: 'aac', channels: 2, sampleRate: 48000, title: '' }],
  fps: 120,
  bitrate: 50_000_000,
  pixelFormat: 'yuv420p',
};
const light: MediaInfo = { ...nvidia, fps: 60, bitrate: 8_000_000 };
function clip(originalFile: string, patch: Partial<StoredClip> = {}): StoredClip {
  const id = randomUUID();
  return {
    id,
    title: 'Clip',
    gameId: 'recording',
    gameName: '',
    thumbnail: '',
    duration: 1,
    recordedAt: new Date().toISOString(),
    size: 1,
    resolution: '36p',
    tags: [],
    favorite: false,
    status: 'ready',
    note: '',
    server: true,
    originalName: 'capture.mp4',
    hash: id,
    originalFile,
    playbackFile: originalFile,
    ...patch,
  };
}

it('chooses a web rendition only for heavy or unplayable clips', () => {
  expect(planPlayback(nvidia, '.mp4', 'web', true)).toBe('transcode');
  expect(planPlayback({ ...nvidia, fps: 60 }, '.mp4', 'web', true)).toBe('transcode');
  expect(planPlayback({ ...light, width: 2560 }, '.mp4', 'web', true)).toBe('transcode');
  expect(planPlayback(light, '.mp4', 'web', true)).toBe('original');
  // Index at the end, other container, second audio track: a cheap remux suffices.
  expect(planPlayback(light, '.mp4', 'web', false)).toBe('remux');
  expect(planPlayback(light, '.mkv', 'web', true)).toBe('remux');
  expect(
    planPlayback(
      { ...light, audio: [...light.audio, { ...light.audio[0], index: 1 }] },
      '.mp4',
      'web',
      true,
    ),
  ).toBe('remux');
  // HEVC or 10-bit H.264 cannot be copied for every browser.
  expect(planPlayback({ ...light, codec: 'hevc' }, '.mp4', 'web', true)).toBe('transcode');
  expect(planPlayback({ ...light, pixelFormat: 'yuv420p10le' }, '.mp4', 'web', true)).toBe(
    'transcode',
  );
  // REPLAYHAVEN_PLAYBACK=original keeps playing heavy originals as before.
  expect(planPlayback(nvidia, '.mp4', 'original', false)).toBe('original');
  expect(planPlayback({ ...nvidia, codec: 'hevc' }, '.mp4', 'original', true)).toBe('transcode');
});

it('encodes the web rendition with capped size, frame rate and bitrate', () => {
  const args = playbackArgs('in.mp4', 'out.mp4', nvidia, 'transcode', 'web', ['-map', '0:a:0?']);
  const value = (flag: string) => args[args.indexOf(flag) + 1];
  expect(value('-vf')).toBe("scale=w='min(1920,iw)':h=-2,fps=60");
  expect(value('-c:v')).toBe('libx264');
  expect(value('-preset')).toBe('veryfast');
  expect(value('-profile:v')).toBe('high');
  expect(value('-crf')).toBe('23');
  expect(value('-maxrate')).toBe('8M');
  expect(value('-bufsize')).toBe('16M');
  expect(value('-pix_fmt')).toBe('yuv420p');
  expect(value('-g')).toBe('120');
  expect(value('-c:a')).toBe('aac');
  expect(value('-b:a')).toBe('160k');
  expect(value('-movflags')).toBe('+faststart');
  expect(value('-threads')).toBe('2');
  expect(args.at(-1)).toBe('out.mp4');
  // 30 fps stays 30 fps, only the size is capped.
  const calm = playbackArgs('in.mp4', 'out.mp4', { ...nvidia, fps: 30 }, 'transcode', 'web', []);
  expect(calm[calm.indexOf('-vf') + 1]).toBe("scale=w='min(1920,iw)':h=-2");
  expect(calm[calm.indexOf('-g') + 1]).toBe('60');
  // A remux copies the video and, when possible, the audio.
  const remux = playbackArgs('in.mkv', 'out.mp4', light, 'remux', 'web', ['-map', '0:a:0?']);
  expect(remux.join(' ')).toContain('-c:v copy');
  expect(remux.join(' ')).toContain('-c:a copy');
  expect(remux).not.toContain('-vf');
});

it('finds the MP4 index before or after the media data', async () => {
  const root = await tempRoot();
  const box = (type: string, size = 16) => {
    const buffer = Buffer.alloc(size);
    buffer.writeUInt32BE(size, 0);
    buffer.write(type, 4, 'latin1');
    return buffer;
  };
  const file = async (name: string, ...boxes: Buffer[]) => {
    const path = join(root, name);
    await writeFile(path, Buffer.concat(boxes));
    return path;
  };
  expect(await isFastStart(await file('fast.mp4', box('ftyp'), box('moov'), box('mdat')))).toBe(
    true,
  );
  expect(await isFastStart(await file('slow.mp4', box('ftyp'), box('mdat', 64), box('moov')))).toBe(
    false,
  );
  expect(await isFastStart(await file('junk.mp4', Buffer.from('not a video at all')))).toBe(false);
  expect(await isFastStart(join(root, 'missing.mp4'))).toBe(false);
});

it('remuxes a heavy upload at once and renders the web rendition in the background', async () => {
  const root = await tempRoot();
  const media = new MediaProcessor({});
  const original = join(root, 'clips', 'x', 'original.mp4');
  await mkdir(join(root, 'clips', 'x'), { recursive: true });
  // 120 fps like an NVIDIA recording, written without fast start.
  await runFile(media.ffmpeg, [
    '-nostdin',
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=64x36:rate=120:duration=1',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=48000:duration=1',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    original,
  ]);
  const prepared = await media.prepare(original, join(root, 'clips', 'x'), '.mp4', 'web');
  expect(prepared.fps).toBeCloseTo(120, 0);
  expect(prepared.playbackFile).toBe(join(root, 'clips', 'x', 'playback.mp4'));
  expect(prepared.playbackProfile).toBeUndefined();
  expect(await isFastStart(prepared.playbackFile)).toBe(true);

  const db = new VaultDatabase(root);
  const entry = clip(original, { id: 'x', playbackFile: prepared.playbackFile });
  const removed = clip(original, { deleted: true });
  db.put(entry);
  db.put(removed);
  let busy = true;
  const backfill = new PlaybackBackfill(db, root, media, 'web', () => busy, 20);
  expect(backfill.status()).toMatchObject({ mode: 'web', pending: 1 });
  backfill.kick();
  // Nothing happens while uploads are processed.
  await new Promise((done) => setTimeout(done, 100));
  expect(db.get('x')?.playbackProfile).toBeUndefined();
  busy = false;
  await expect.poll(() => db.get('x')?.playbackProfile, { timeout: 20000 }).toBe('web-1');
  const done = db.get('x')!;
  expect(done.playbackFile).toBe(join(root, 'clips', 'x', 'playback-web-1.mp4'));
  expect(done.videoSource).toMatch(/^\/api\/clips\/x\/video\?v=playback-web-1\./);
  const rendition = await media.probe(done.playbackFile!);
  expect(rendition.fps).toBeCloseTo(60, 0);
  expect(rendition.audio).toHaveLength(1);
  expect(backfill.status()).toMatchObject({ pending: 0, done: 1 });
  expect(db.get(removed.id)?.playbackProfile).toBeUndefined();
  await backfill.stop();
  db.close();
}, 60000);

it('remembers a failed rendition instead of retrying it forever', async () => {
  const root = await tempRoot();
  const db = new VaultDatabase(root);
  const media = new MediaProcessor({});
  const probe = vi.spyOn(media, 'probe').mockRejectedValue(new Error('broken'));
  db.put(clip(join(root, 'broken.mp4'), { id: 'broken' }));
  const backfill = new PlaybackBackfill(db, root, media, 'web');
  backfill.kick();
  await expect.poll(() => db.get('broken')?.playbackFailed).toBe('web-1');
  expect(backfill.status().pending).toBe(0);
  expect(probe).toHaveBeenCalledTimes(1);
  // In original mode there is nothing to backfill.
  expect(new PlaybackBackfill(db, root, media, 'original').pending()).toEqual([]);
  await backfill.stop();
  db.close();
});

it('serves video with range requests and a private cache policy', async () => {
  const { app, db, config } = await startServer({ playback: 'original' });
  const entry = clip('', { status: 'ready' });
  const directory = join(config.dataDir, 'clips', entry.id);
  await mkdir(directory, { recursive: true });
  const original = join(directory, 'original.mp4');
  await writeFile(original, Buffer.alloc(4096, 1));
  await writeFile(join(directory, 'thumbnail.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  db.put({ ...entry, originalFile: original, playbackFile: original, playbackProfile: 'web-1' });
  const headers = { authorization: `Bearer ${TEST_KEY}` };
  const video = await app.inject({
    url: `/api/clips/${entry.id}/video?v=original.1`,
    headers: { ...headers, range: 'bytes=0-99' },
  });
  expect(video.statusCode).toBe(206);
  expect(video.headers['content-range']).toBe('bytes 0-99/4096');
  expect(video.headers['cache-control']).toBe('private, max-age=86400');
  const thumbnail = await app.inject({ url: `/api/clips/${entry.id}/thumbnail`, headers });
  expect(thumbnail.headers['cache-control']).toBe('private, max-age=3600');
  const download = await app.inject({ url: `/api/clips/${entry.id}/download`, headers });
  expect(download.headers['cache-control']).toBe('no-store');
  const status = (await app.inject({ url: '/api/status', headers })).json();
  expect(status.playback).toMatchObject({ mode: 'original', pending: 0 });
  await app.close();
});
