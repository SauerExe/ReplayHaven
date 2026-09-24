import { mkdtemp, rm } from 'node:fs/promises';
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
