import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
    // Die Helligkeit steigt gleichmäßig mit der Zeit, jedes Bild verrät so seine Videozeit.
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
    // Vier Bilder im Vorlauf (7,5 s Abstand), acht im Schluss (3,75 s). Ein halber Schritt
    // daneben wären 11 bzw. 6 Helligkeitsstufen; die Beschriftung muss auf dasselbe Bild zeigen.
    for (const frame of frames) {
      const labelled = await brightness(await media.frameAt(video, root, frame.seconds));
      expect(Math.abs((await brightness(frame.base64)) - labelled)).toBeLessThan(2.5);
    }
  } finally {
    if (resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('replayhaven-media-'))
      await rm(root, { recursive: true, force: true });
  }
});

it('lists audio tracks, mixes them for playback and extracts one as 16 kHz mono WAV', async () => {
  const root = await mkdtemp(join(tmpdir(), 'replayhaven-media-'));
  try {
    const media = new MediaProcessor({});
    const video = join(root, 'test-only.mp4');
    // Wie mit „Mikrofon als separate Spur“: Spielton, dann Mikrofon, dazu eine stumme Spur.
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
    // RIFF-Kopf: PCM, ein Kanal, 16 kHz, 16 Bit; zwei Sekunden sind 64 000 Byte Daten.
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(16000);
    expect(Math.abs(wav.length - 44 - 64000)).toBeLessThan(2000);

    // Ein Browser spielt nur die erste Tonspur; die Wiedergabekopie mischt alle, das Bild bleibt.
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
});

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
    // Die Helligkeit steigt mit der Zeit: Die Bilder kommen in der richtigen Reihenfolge.
    expect(frames.every((f, i) => i === 0 || f.mean > frames[i - 1].mean)).toBe(true);
  } finally {
    if (resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('replayhaven-media-'))
      await rm(root, { recursive: true, force: true });
  }
});

it('puts a microphone that sits on one channel in the middle of the playback mix', async () => {
  const root = await mkdtemp(join(tmpdir(), 'replayhaven-media-'));
  try {
    const media = new MediaProcessor({});
    const video = join(root, 'test-only.mp4');
    // Spielton als stille Stereospur, das Mikrofon nur auf dem linken Kanal der zweiten Spur.
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
});
