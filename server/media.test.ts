import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import sharp from 'sharp';
import { expect, it } from 'vitest';
import { MediaProcessor, runFile } from './media';

const brightness = async (base64: string) =>
  (await sharp(Buffer.from(base64, 'base64')).greyscale().stats()).channels[0].mean;

it('labels every sampled frame with the moment it actually shows', async () => {
  const root = await mkdtemp(join(tmpdir(), 'replayhaven-media-'));
  try {
    const media = new MediaProcessor({});
    const video = join(root, 'test-only.mp4');
    // Brightness rises steadily with time, so every frame reveals its video time.
    await runFile(media.ffmpeg, [
      '-nostdin',
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=64x36:r=10:d=60,format=yuv420p,geq=lum=20+3*T:cb=128:cr=128',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      video,
    ]);
    const frames = await media.frames(video, root, 60, 12);
    expect(frames).toHaveLength(12);
    // Four frames in the lead-in (7.5 s apart), eight at the end (3.75 s). Half a step off would
    // be 11 or 6 brightness levels; the label must point to the same frame.
    for (const frame of frames) {
      const labelled = await brightness(await media.frameAt(video, root, frame.seconds));
      expect(Math.abs((await brightness(frame.base64)) - labelled)).toBeLessThan(2.5);
    }
    // Whole clip: one frame every 3 s, evenly spread; a short clip keeps the minimum count.
    const even = await media.frames(video, join(root, 'even'), 60, 12, 3);
    expect(even).toHaveLength(20);
    expect(even[1].seconds - even[0].seconds).toBeCloseTo(3, 1);
    expect(await media.frames(video, join(root, 'short'), 60, 30, 3)).toHaveLength(30);
  } finally {
    if (resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('replayhaven-media-'))
      await rm(root, { recursive: true, force: true });
  }
}, 30000);

it('lists audio tracks, mixes them for playback and extracts one as 16 kHz mono WAV', async () => {
  const root = await mkdtemp(join(tmpdir(), 'replayhaven-media-'));
  try {
    const media = new MediaProcessor({});
    const video = join(root, 'test-only.mp4');
    // As with "microphone as a separate track": game audio, then microphone, plus a silent track.
    await runFile(media.ffmpeg, [
      '-nostdin',
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=64x36:r=10:d=4',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000:duration=4',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=880:sample_rate=48000:duration=4,volume=0.3',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=48000:cl=stereo',
      '-map',
      '0:v',
      '-map',
      '1:a',
      '-map',
      '2:a',
      '-map',
      '3:a',
      '-t',
      '4',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-metadata:s:a:1',
      'handler_name=Mikrofon',
      video,
    ]);
    const meta = await media.probe(video);
    expect(meta.audio.map((t) => [t.index, t.codec, t.channels, t.sampleRate])).toEqual([
      [0, 'aac', 1, 48000],
      [1, 'aac', 1, 48000],
      [2, 'aac', 2, 48000],
    ]);
    expect(meta.audio.map((t) => t.title)).toEqual(['', 'Mikrofon', '']);
    const levels = await Promise.all(meta.audio.map((t) => media.audioLevels(video, t.index)));
    expect(levels[0].max).toBeGreaterThan(-30);
    expect(levels[1].max).toBeLessThan(levels[0].max);
    expect(levels[2].max).toBeLessThan(-70);

    const wav = await readFile(
      await media.extractAudio(video, join(root, 'mic.wav'), 1, { start: 1, duration: 2 }),
    );
    // RIFF header: PCM, one channel, 16 kHz, 16 bit; two seconds are 64,000 bytes of data.
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(16000);
    expect(Math.abs(wav.length - 44 - 64000)).toBeLessThan(2000);

    // A browser plays only the first audio track; the playback copy mixes all of them, the video stays.
    const prepared = await media.prepare(video, root, '.mp4');
    expect(prepared.playbackFile).toBe(join(root, 'playback.mp4'));
    const playback = await media.probe(prepared.playbackFile);
    expect(playback.codec).toBe('h264');
    expect(playback.audio).toHaveLength(1);
    expect((await media.audioLevels(prepared.playbackFile, 0)).max).toBeGreaterThan(-30);
  } finally {
    if (resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('replayhaven-media-'))
      await rm(root, { recursive: true, force: true });
  }
}, 30000);

it('streams raw RGB frames labelled with the middle of their interval', async () => {
  const root = await mkdtemp(join(tmpdir(), 'replayhaven-media-'));
  try {
    const media = new MediaProcessor({});
    const video = join(root, 'test-only.mp4');
    await runFile(media.ffmpeg, [
      '-nostdin',
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=320x180:r=10:d=3,format=yuv420p,geq=lum=20+60*T:cb=128:cr=128',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      video,
    ]);
    const frames: { seconds: number; width: number; height: number; mean: number }[] = [];
    for await (const { seconds, frame } of media.rawFrames(video, { fps: 2, width: 160 })) {
      const mean = frame.data.reduce((sum, v) => sum + v, 0) / frame.data.length;
      frames.push({ seconds, width: frame.width, height: frame.height, mean });
    }
    expect(frames.map((f) => [f.seconds, f.width, f.height])).toEqual([
      [0.25, 160, 90],
      [0.75, 160, 90],
      [1.25, 160, 90],
      [1.75, 160, 90],
      [2.25, 160, 90],
      [2.75, 160, 90],
    ]);
    // Brightness rises with time: the frames arrive in the right order.
    expect(frames.every((f, i) => i === 0 || f.mean > frames[i - 1].mean)).toBe(true);
  } finally {
    if (resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('replayhaven-media-'))
      await rm(root, { recursive: true, force: true });
  }
}, 30000);

it.skipIf(process.platform === 'win32')(
  'reports a missing or failing FFmpeg instead of a clip without frames',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'replayhaven-media-'));
    try {
      const video = join(root, 'test-only.mp4');
      await runFile(new MediaProcessor({}).ffmpeg, [
        '-nostdin',
        '-v',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=c=gray:s=160x90:r=10:d=1',
        '-pix_fmt',
        'yuv420p',
        video,
      ]);
      const count = async (media: MediaProcessor, signal?: AbortSignal) => {
        let frames = 0;
        for await (const read of media.rawFrames(video, { fps: 2, width: 160, signal }))
          frames += read.frame.data.length > 0 ? 1 : 0;
        return frames;
      };
      expect(await count(new MediaProcessor({}))).toBe(2);
      // If FFmpeg is missing, the error reaches the caller instead of being an uncaught exception.
      await expect(count(new MediaProcessor({ ffmpeg: join(root, 'fehlt') }))).rejects.toThrow(
        /ENOENT/,
      );
      // If FFmpeg aborts, that must not look like a clip without text.
      const failing = join(root, 'bricht-ab.sh');
      await writeFile(failing, '#!/bin/sh\necho "Invalid data found" >&2\nexit 3\n', {
        mode: 0o755,
      });
      await expect(count(new MediaProcessor({ ffmpeg: failing }))).rejects.toThrow(
        /stopped while reading frames: Invalid data found/,
      );
      // An already aborted call ends quietly and without frames.
      expect(await count(new MediaProcessor({}), AbortSignal.abort())).toBe(0);
    } finally {
      if (resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('replayhaven-media-'))
        await rm(root, { recursive: true, force: true });
    }
  },
  30000,
);

it('decodes a track as 16 kHz samples, channel by channel', async () => {
  const root = await mkdtemp(join(tmpdir(), 'replayhaven-media-'));
  try {
    const media = new MediaProcessor({});
    const video = join(root, 'test-only.mp4');
    // A tone only on the left channel, like a mono microphone in a stereo track.
    await runFile(media.ffmpeg, [
      '-nostdin',
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=160x90:r=10:d=1',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1:sample_rate=48000',
      '-filter_complex',
      '[1:a]pan=stereo|c0=c0|c1=0*c0[a]',
      '-map',
      '0:v',
      '-map',
      '[a]',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      video,
    ]);
    const rms = (samples: Float32Array) =>
      Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);
    const [left, right] = await media.pcm(video, 0, 2);
    expect(left.length).toBeGreaterThan(15000);
    expect(left.length).toBeLessThan(17500);
    expect(rms(left)).toBeGreaterThan(0.05);
    expect(rms(right)).toBeLessThan(0.001);
    const mono = await media.pcm(video, 0, 1);
    expect(mono).toHaveLength(1);
    await expect(media.pcm(video, 3, 1)).rejects.toThrow(/FFmpeg stopped while reading audio/);
  } finally {
    if (resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('replayhaven-media-'))
      await rm(root, { recursive: true, force: true });
  }
}, 30000);

it('puts a microphone that sits on one channel in the middle of the playback mix', async () => {
  const root = await mkdtemp(join(tmpdir(), 'replayhaven-media-'));
  try {
    const media = new MediaProcessor({});
    const video = join(root, 'test-only.mp4');
    // Game audio as a silent stereo track, the microphone only on the left channel of the second track.
    await runFile(media.ffmpeg, [
      '-nostdin',
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=64x36:r=10:d=3',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=48000:cl=stereo',
      '-f',
      'lavfi',
      '-i',
      'aevalsrc=0.3*sin(2*PI*880*t)|0:s=48000:d=3',
      '-map',
      '0:v',
      '-map',
      '1:a',
      '-map',
      '2:a',
      '-t',
      '3',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      video,
    ]);
    const prepared = await media.prepare(video, root, '.mp4');
    const channel = async (index: number) => {
      const log = await runFile(
        media.ffmpeg,
        [
          '-nostdin',
          '-v',
          'info',
          '-i',
          prepared.playbackFile,
          '-af',
          `pan=mono|c0=c${index},volumedetect`,
          '-f',
          'null',
          '-',
        ],
        60000,
        'stderr',
      );
      return Number(/max_volume:\s*(-?[\d.]+) dB/.exec(log)?.[1] ?? -Infinity);
    };
    const [left, right] = [await channel(0), await channel(1)];
    expect(right).toBeGreaterThan(-30);
    expect(Math.abs(left - right)).toBeLessThan(1);
  } finally {
    if (resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('replayhaven-media-'))
      await rm(root, { recursive: true, force: true });
  }
}, 30000);

it('only reads the accepted containers, whatever the file is called', async () => {
  const root = await mkdtemp(join(tmpdir(), 'replayhaven-media-'));
  try {
    const media = new MediaProcessor({});
    const make = (output: string, codec: string[]) =>
      runFile(media.ffmpeg, [
        '-nostdin',
        '-v',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=c=black:s=64x36:r=10:d=1',
        ...codec,
        output,
      ]);
    const mkv = join(root, 'test-only.mkv');
    const webm = join(root, 'test-only.webm');
    await make(mkv, ['-c:v', 'libx264', '-pix_fmt', 'yuv420p']);
    await make(webm, ['-c:v', 'libvpx-vp9']);
    expect((await media.probe(mkv)).duration).toBeGreaterThan(0);
    expect((await media.probe(webm)).duration).toBeGreaterThan(0);
    // An AVI is a perfectly readable video, but not one of the accepted containers.
    const avi = join(root, 'test-only.avi');
    await make(avi, ['-c:v', 'mpeg4', '-f', 'avi']);
    const disguised = join(root, 'disguised.mp4');
    await writeFile(disguised, await readFile(avi));
    await expect(media.probe(disguised)).rejects.toThrow();
    await expect(media.prepare(disguised, root, '.mp4')).rejects.toThrow();
  } finally {
    if (resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('replayhaven-media-'))
      await rm(root, { recursive: true, force: true });
  }
}, 30000);

it('stops reading audio when asked to', async () => {
  const media = new MediaProcessor({});
  const signal = AbortSignal.abort();
  await expect(media.pcm('test-only.mp4', 0, 1, { signal })).rejects.toThrow();
  await expect(media.probe('test-only.mp4', signal)).rejects.toThrow();
  await expect(media.audioLevels('test-only.mp4', 0, signal)).rejects.toThrow();
});
