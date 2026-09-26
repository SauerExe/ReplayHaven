import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import sharp from 'sharp';
import { expect, it } from 'vitest';
import { actionAnchor, clipSecond, clockAnchors, clockIn, clockValue, readClock } from './r6-clock';
import type { ClockSample } from './r6-clock';
import { developmentModels, TextReader } from './ocr';
import { MediaProcessor, runFile } from '../server/media';

it.each([
  ['1:52', 112],
  ['0:05', 5],
  ['3:00', 180],
  ['2.47', 167],
  ['2 1:52 3', 112],
  // Times of day, scores and round numbers are not a round clock.
  ['12:34', undefined],
  ['1:5', undefined],
  ['152', undefined],
  ['ROUND 3', undefined],
])('reads the round clock in "%s"', (text, value) => {
  expect(clockValue(text)).toBe(value);
});

it('takes the confidently read clock closest to the middle of the area', () => {
  const line = (text: string, x: number, score = 0.95) => ({
    text,
    score,
    box: { x, y: 10, w: 40, h: 20 },
  });
  expect(clockIn([line('0:30', 10), line('1:52', 180), line('3', 250)], 400)).toBe(112);
  expect(clockIn([line('1:52', 180, 0.6)], 400)).toBeUndefined();
  expect(clockIn([], 400)).toBeUndefined();
});

it('bundles readings by clip second plus clock and drops misreadings', () => {
  const samples: ClockSample[] = [
    // Preparation until 0:00 at second 4, then action phase from 3:00.
    { seconds: 1, clock: 3 },
    { seconds: 2, clock: 2 },
    { seconds: 3, clock: 1 },
    { seconds: 5, clock: 179 },
    { seconds: 6, clock: 178 },
    { seconds: 6.5, clock: 178 },
    { seconds: 7, clock: 177 },
    // Misread: 1:17 instead of 2:57.
    { seconds: 8, clock: 77 },
  ];
  const anchors = clockAnchors(samples);
  expect(anchors).toEqual([
    { anchor: 184, samples: 4, low: 177, high: 179, action: true },
    { anchor: 4, samples: 3, low: 1, high: 3, action: false },
  ]);
  expect(actionAnchor(anchors)?.anchor).toBe(184);
  // A kill at 2:58 lands on clip second 6.
  expect(clipSecond(actionAnchor(anchors)!, 178)).toBe(6);
  expect(actionAnchor(clockAnchors(samples.slice(0, 3)))).toMatchObject({ action: false });
  expect(actionAnchor([])).toBeUndefined();
});

const models = developmentModels();
it.skipIf(!existsSync(models.det))(
  'reads a rendered round clock at the top of a clip and anchors it',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'replayhaven-clock-'));
    try {
      const media = new MediaProcessor({});
      // Six seconds of round clock counting down from 1:52, with scores beside it as in the HUD.
      const inputs: string[] = [];
      for (let i = 0; i < 6; i++) {
        const value = 112 - i;
        const text = `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#1b2027"/><text x="560" y="52" font-family="sans-serif" font-weight="bold" font-size="30" fill="#ffffff" text-anchor="middle">2</text><text x="640" y="52" font-family="sans-serif" font-weight="bold" font-size="34" fill="#ffffff" text-anchor="middle">${text}</text><text x="720" y="52" font-family="sans-serif" font-weight="bold" font-size="30" fill="#ffffff" text-anchor="middle">3</text><text x="1100" y="120" font-family="sans-serif" font-size="22" fill="#ffffff" text-anchor="middle">PlayerOne 1:30 EnemyOne</text></svg>`;
        const png = join(root, `clock-${i}.png`);
        await sharp(Buffer.from(svg)).png().toFile(png);
        inputs.push('-loop', '1', '-t', '1', '-i', png);
      }
      const video = join(root, 'clock.mp4');
      await runFile(media.ffmpeg, [
        '-nostdin',
        '-v',
        'error',
        '-y',
        ...inputs,
        '-filter_complex',
        '[0:v][1:v][2:v][3:v][4:v][5:v]concat=n=6:v=1[v]',
        '-map',
        '[v]',
        '-r',
        '10',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        video,
      ]);
      const reader = await TextReader.load(models, 2);
      try {
        const samples = await readClock(media, reader, video, { enough: 100 });
        expect(samples.length).toBeGreaterThanOrEqual(11);
        const anchor = actionAnchor(clockAnchors(samples));
        expect(anchor).toMatchObject({ low: 107, high: 112, action: true });
        // Clock 1:52 in second 0 to 1: the anchor lies between 112 and 113.
        expect(anchor!.anchor).toBeGreaterThanOrEqual(111.5);
        expect(anchor!.anchor).toBeLessThanOrEqual(113);
        expect(Math.abs(clipSecond(anchor!, 110) - 2.5)).toBeLessThanOrEqual(0.75);
        // Once four readings agree, it stops reading.
        expect(await readClock(media, reader, video, { enough: 4 })).toHaveLength(4);
      } finally {
        await reader.close();
      }
    } finally {
      if (resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('replayhaven-clock-'))
        await rm(root, { recursive: true, force: true });
    }
  },
  60000,
);
