import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import sharp from 'sharp';
import { expect, it, vi } from 'vitest';
import { ClipTexts, isR6, mapIn, r6Findings } from './r6';
import { developmentModels, TextReader } from './ocr';
import { MediaProcessor, runFile } from '../server/media';
import type { FrameText } from './r6';
import { withTexts } from './events';
import type { GameEvent } from './events';
import { fallbackTitle, titleProblems } from './wording';
import { R6_MAPS } from './r6';

it.each([
  ['OREGON', 'Oregon'],
  ['Oregon, USA', 'Oregon'],
  ['KAFE DOSTOYEVSKY', 'Kafe Dostoyevsky'],
  ['0REGON', 'Oregon'],
  ['NIGHTHAVEN LABS', 'Nighthaven Labs'],
  // Raumnamen und Sätze sind keine Karte.
  ['TOWER STAIRS', undefined],
  ['BANK VAULT', undefined],
  ['Welcome to the house', undefined],
])('reads the map in %s', (text, map) => {
  expect(mapIn(text)).toBe(map);
});

it('recognises the game folder of Rainbow Six', () => {
  expect(isR6("Tom Clancy's Rainbow Six Siege")).toBe(true);
  expect(isR6('R6')).toBe(true);
  expect(isR6('Fortnite')).toBe(false);
});

const row = (text: string, score = 0.95) => ({ text, score, box: { x: 0, y: 0, w: 10, h: 10 } });
const at = (seconds: number, ...texts: string[]): FrameText => ({
  seconds,
  rows: texts.map((t) => row(t)),
});

it('takes a map seen in two frames and round results, never kills', () => {
  const findings = r6Findings(
    [
      at(0.25, 'OREGON'),
      at(0.75, 'OREGON', '+100 KILL'),
      at(1.25, 'SpielerEins [Waffe] Gegner'),
      at(60.25, 'YOUR TEAM WON ROUND 3'),
      at(60.75, 'YOUR TEAM WON ROUND 3'),
      at(61.25, 'ROUND WON'),
    ],
    "Tom Clancy's Rainbow Six Siege",
  );
  expect(findings.map).toBe('Oregon');
  expect(findings.events.map((e) => [e.kind, e.seconds, e.source])).toEqual([
    ['roundWon', 60.25, 'ocr'],
  ]);
});

it('leaves the map open when it was seen once or two maps tie', () => {
  expect(r6Findings([at(1, 'OREGON')], 'R6').map).toBeUndefined();
  expect(
    r6Findings([at(1, 'OREGON'), at(2, 'OREGON'), at(3, 'BANK'), at(4, 'BANK')], 'R6').map,
  ).toBeUndefined();
  expect(
    r6Findings([{ seconds: 1, rows: [row('VILLA', 0.6)] }, at(2, 'VILLA')], 'R6').map,
  ).toBeUndefined();
});

const event = (kind: GameEvent['kind'], seconds: number, source: GameEvent['source']) => ({
  kind,
  seconds,
  text: '',
  source,
});

it('lets round results from text recognition replace those the model read nearby', () => {
  const merged = withTexts(
    [
      event('kill', 90, 'screen'),
      event('roundWon', 100, 'screen'),
      event('roundLost', 20, 'screen'),
    ],
    [event('roundLost', 102, 'ocr')],
  );
  expect(merged.map((e) => [e.kind, e.seconds, e.source])).toEqual([
    ['roundLost', 20, 'screen'],
    ['kill', 90, 'screen'],
    ['roundLost', 102, 'ocr'],
  ]);
});

it('allows only the recognised map in titles and adds it to the fallback title', () => {
  const kills = [event('kill', 10, 'screen'), event('multikill', 12, 'screen')];
  const place = { map: 'Oregon', maps: R6_MAPS };
  expect(titleProblems('Doppel-Kill auf Oregon', kills, kills, place)).toEqual([]);
  expect(titleProblems('Doppel-Kill auf Bank', kills, kills, place).join(' ')).toMatch(
    /Karte Bank, erkannt wurde Oregon/,
  );
  expect(titleProblems('Doppel-Kill auf Bank', kills, kills, { maps: R6_MAPS }).join(' ')).toMatch(
    /nicht erkannt/,
  );
  // Ohne Texterkennung bleibt es wie bisher.
  expect(titleProblems('Doppel-Kill auf Bank', kills, kills)).toEqual([]);
  expect(fallbackTitle([event('roundWon', 100, 'ocr')], [], [], null, 'Oregon')).toBe(
    'Runde gewonnen auf Oregon',
  );
});

const models = developmentModels();
it.skipIf(!existsSync(models.det))(
  'reads map and round result from a rendered R6 clip',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'replayhaven-r6-'));
    try {
      const media = new MediaProcessor({});
      // Zwei Sekunden Kartenname, zwei Sekunden Rundenende, als Standbilder zu einem Video.
      const card = async (name: string, text: string, size: number) => {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#202830"/><text x="640" y="380" font-family="sans-serif" font-weight="bold" font-size="${size}" fill="#ffffff" text-anchor="middle">${text}</text></svg>`;
        await sharp(Buffer.from(svg)).png().toFile(join(root, name));
      };
      await card('map.png', 'OREGON', 72);
      await card('round.png', 'ROUND WON', 64);
      const video = join(root, "Tom Clancy's Rainbow Six Siege 2026.09.24 - 20.00.00.01.DVR.mp4");
      await runFile(media.ffmpeg, [
        '-nostdin',
        '-v',
        'error',
        '-y',
        '-loop',
        '1',
        '-t',
        '2',
        '-i',
        join(root, 'map.png'),
        '-loop',
        '1',
        '-t',
        '2',
        '-i',
        join(root, 'round.png'),
        '-filter_complex',
        '[0:v][1:v]concat=n=2:v=1[v]',
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
      const texts = new ClipTexts({ media, models, threads: 2 });
      expect(await texts.forClip(video, 'Fortnite', new AbortController().signal)).toBeUndefined();
      const found = await texts.forClip(
        video,
        "Tom Clancy's Rainbow Six Siege",
        new AbortController().signal,
      );
      expect(found?.map).toBe('Oregon');
      expect(found?.events.map((e) => [e.kind, e.seconds])).toEqual([['roundWon', 2.25]]);
      expect(found?.trace).toMatchObject({ frames: 8, map: 'Oregon', events: 1 });
    } finally {
      if (resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('replayhaven-r6-'))
        await rm(root, { recursive: true, force: true });
    }
  },
  60000,
);

it('loads the models again after a failed attempt', async () => {
  const load = vi
    .spyOn(TextReader, 'load')
    .mockRejectedValueOnce(new Error('Datei gesperrt'))
    .mockResolvedValue({ read: async () => [], close: async () => {} } as unknown as TextReader);
  try {
    const media = { rawFrames: async function* () {} } as unknown as MediaProcessor;
    const texts = new ClipTexts({ media, models: developmentModels() });
    const signal = new AbortController().signal;
    await expect(texts.forClip('clip.mp4', 'R6', signal)).rejects.toThrow('Datei gesperrt');
    expect((await texts.forClip('clip.mp4', 'R6', signal))?.trace.frames).toBe(0);
    expect(load).toHaveBeenCalledTimes(2);
  } finally {
    load.mockRestore();
  }
});
