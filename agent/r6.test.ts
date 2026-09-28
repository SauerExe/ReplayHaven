import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { build } from 'esbuild';
import sharp from 'sharp';
import { expect, it, vi } from 'vitest';
import {
  bannerResult,
  ClipTexts,
  feedNames,
  feedRead,
  isR6,
  mapIn,
  r6Findings,
  respace,
  WorkerTexts,
} from './r6';
import { developmentModels, missingLibrary, TextReader } from './ocr';
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
  // PP-OCRv5 without spaces, with one misread (R6 clips from 2026-09-25).
  ['NIGHTHAVENLABS', 'Nighthaven Labs'],
  ['KAFEDOSTOYEVSKI', 'Kafe Dostoyevsky'],
  ['KAFEDOSTOYEVSK', 'Kafe Dostoyevsky'],
  ['BANKVAULT', undefined],
  // A room in the location display, not a map.
  ['Tower', undefined],
  // Room names and sentences are not maps.
  ['TOWER STAIRS', undefined],
  ['BANK VAULT', undefined],
  ['Welcome to the house', undefined],
])('reads the map in %s', (text, map) => {
  expect(mapIn(text)).toBe(map);
});

it.each([
  ['WONROUND2', 'WON ROUND 2'],
  ['YOURTEAM', 'YOUR TEAM'],
  ['ENEMIESELIMINATED', 'ENEMIES ELIMINATED'],
  ['OPPONENTSFOUNDTHEBOMBS', 'OPPONENTS FOUND THE BOMBS'],
  // Only text made entirely of banner words is split.
  ['PICKUPTHEDEFUSER', 'PICKUPTHEDEFUSER'],
  ['ROUND2', 'ROUND2'],
  ['Holographic', 'Holographic'],
])('splits the banner %s into words', (text, spaced) => {
  expect(respace(text)).toBe(spaced);
});

it.each([
  // As read on 2026-09-25 (R6 clip from 2024-12-07): banner in pieces, "TEAM" misread.
  [['YOURTEAA', 'WONROUND2', 'ENEMIESELIMINATED', 'PU:2.2'], 'YOUR TEAM WON ROUND'],
  [['WONROUND2', 'PU:2.'], ''],
  [['WONROUND2', 'ENEMIESELIMINATED'], 'YOUR TEAM WON ROUND'],
  [['ENEMYTEAM', 'WONROUND3'], 'ENEMY TEAM WON ROUND'],
  [['OPPONENTS WON ROUND 4'], 'ENEMY TEAM WON ROUND'],
  [['ROUND2'], ''],
])('reads the round banner %j as %s', (texts, result) => {
  expect(bannerResult(texts.map((t) => row(t)))).toBe(result);
});

it('reads a round result written without spaces', () => {
  const findings = r6Findings(
    [at(117.8, 'YOURTEAM', 'WONROUND3'), at(118.3, 'YOURTEAM WONROUND3')],
    "Tom Clancy's Rainbow Six Siege",
  );
  expect(findings.events.map((e) => e.kind)).toEqual(['roundWon']);
});

it('recognises the game folder of Rainbow Six', () => {
  expect(isR6("Tom Clancy's Rainbow Six Siege")).toBe(true);
  expect(isR6('R6')).toBe(true);
  expect(isR6('R6siege')).toBe(true);
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
      at(1.25, 'PlayerOne [Weapon] Enemy'),
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
  // With an event, the recognised map belongs in the title; the short form is enough.
  expect(titleProblems('Doppel-Kill', kills, kills, place).join(' ')).toMatch(/auf Oregon/);
  const kafe = { map: 'Kafe Dostoyevsky', maps: R6_MAPS };
  expect(titleProblems('Doppel-Kill auf Kafe', kills, kills, kafe)).toEqual([]);
  expect(titleProblems('Stiller Rundenbeginn', [], [], place)).toEqual([]);
  // Without text recognition, nothing changes.
  expect(titleProblems('Doppel-Kill auf Bank', kills, kills)).toEqual([]);
  expect(fallbackTitle([event('roundWon', 100, 'ocr')], [], [], null, 'Oregon')).toBe(
    'Runde gewonnen auf Oregon',
  );
  // With two events, the map goes with the first.
  expect(
    fallbackTitle(
      [event('roundWon', 118, 'ocr'), { ...event('death', 110, 'screen'), other: 'EnemyOne' }],
      [],
      [],
      null,
      'Kanal',
    ),
  ).toBe('Runde gewonnen auf Kanal – Von EnemyOne ausgeschaltet');
});

const models = developmentModels();
it.skipIf(!existsSync(models.det))(
  'reads map and round result from a rendered R6 clip',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'replayhaven-r6-'));
    try {
      const media = new MediaProcessor({});
      // Two seconds of map name, two seconds of round end, as stills joined into a video.
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
      // The same in the worker thread, with the bundle the client also builds.
      const script = join(root, 'r6-worker.cjs');
      await build({
        entryPoints: [join(__dirname, 'r6-worker.ts')],
        outfile: script,
        bundle: true,
        platform: 'node',
        format: 'cjs',
        external: ['ffmpeg-static', '@ffprobe-installer/ffprobe'],
        logLevel: 'error',
      });
      const worker = new WorkerTexts({
        script,
        data: {
          models,
          runtime: dirname(createRequire(__filename).resolve('onnxruntime-node/package.json')),
          ffmpeg: media.ffmpeg,
          ffprobe: media.ffprobe,
          threads: 2,
        },
      });
      try {
        expect(await worker.problem()).toBeUndefined();
        const inThread = await worker.forClip(video, "Tom Clancy's Rainbow Six Siege");
        expect(inThread?.map).toBe('Oregon');
        expect(inThread?.events.map((e) => [e.kind, e.seconds])).toEqual([['roundWon', 2.25]]);
      } finally {
        await worker.close();
      }
    } finally {
      if (resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('replayhaven-r6-'))
        await rm(root, { recursive: true, force: true });
    }
  },
  60000,
);

it('passes load errors, aborts and crashes of the text worker on', async () => {
  const root = await mkdtemp(join(tmpdir(), 'replayhaven-r6-'));
  try {
    // A fake worker that speaks the serveTexts protocol.
    const script = join(root, 'worker.cjs');
    await writeFile(
      script,
      `const { parentPort } = require('node:worker_threads');
const paths = new Map();
parentPort.on('message', (m) => {
  if (m.type === 'check')
    parentPort.postMessage({ id: m.id, error: { message: 'Das angegebene Modul wurde nicht gefunden.', code: 'ERR_DLOPEN_FAILED' } });
  if (m.type === 'clip') paths.set(m.id, m.path);
  if (m.type === 'clip' && m.path === 'crash.mp4') process.exit(3);
  // Like ONNX Runtime mid-frame: the abort only takes effect afterwards, here not at all.
  if (m.type === 'abort' && paths.get(m.id) !== 'stuck.mp4')
    parentPort.postMessage({ id: m.id, value: { events: [], trace: { frames: 1, seconds: 0, events: 0 } } });
});`,
    );
    const texts = new WorkerTexts({
      script,
      data: { models: developmentModels(), ffmpeg: '', ffprobe: '' },
    });
    try {
      // The load error arrives with its code, so the runtime hint applies.
      const problem = await texts.problem();
      expect(problem?.message).toBe('Das angegebene Modul wurde nicht gefunden.');
      expect(missingLibrary(problem)).toBe(true);
      // An abort applies to the running request; it ends with what was read so far.
      const stop = new AbortController();
      const reading = texts.forClip('slow.mp4', 'R6', stop.signal);
      stop.abort();
      expect((await reading)?.trace.frames).toBe(1);
      // If the worker dies, the request fails; the next one starts a new worker.
      await expect(texts.forClip('crash.mp4', 'R6')).rejects.toThrow(
        /exited unexpectedly \(code 3\)/,
      );
      expect(await texts.problem()).toBeInstanceOf(Error);
      // Other games never reach the worker.
      expect(await texts.forClip('clip.mp4', 'Fortnite')).toBeUndefined();
      // Closing aborts running requests and waits for their answers instead of stopping the
      // worker mid-computation, which would take ONNX Runtime and the process down with it.
      const busy = texts.forClip('slow.mp4', 'R6');
      await texts.close();
      expect((await busy)?.trace.frames).toBe(1);
      // If the worker does not answer, waiting ends after the deadline.
      const stuck = texts.forClip('stuck.mp4', 'R6');
      const closing = texts.close(50);
      await expect(stuck).rejects.toThrow('Text recognition stopped.');
      await closing;
    } finally {
      await texts.close();
    }
  } finally {
    if (resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('replayhaven-r6-'))
      await rm(root, { recursive: true, force: true });
  }
});

it('trusts the Valorant killfeed only when it was read and shows one of the player names', async () => {
  const line = (text: string, x: number) => ({
    text,
    score: 0.95,
    box: { x, y: 10, w: 60, h: 14 },
  });
  let lines = [line('Player', 10), line('Enemy', 120)];
  const load = vi
    .spyOn(TextReader, 'load')
    .mockResolvedValue({ read: async () => lines, close: async () => {} } as unknown as TextReader);
  try {
    let count = 2;
    const media = {
      rawFrames: async function* () {
        for (let i = 0; i < count; i++)
          yield { seconds: i, frame: { width: 64, height: 36, data: new Uint8Array(64 * 36 * 3) } };
      },
    } as unknown as MediaProcessor;
    const texts = new ClipTexts({ media, models: developmentModels() });
    const signal = new AbortController().signal;
    // The Riot tag does not appear in the killfeed.
    const read = await texts.forClip('clip.mp4', 'Valorant', signal, ['Player#EUW']);
    expect(read?.feed).toBe(true);
    expect(read?.events.map((e) => [e.kind, e.other])).toEqual([['kill', 'Enemy']]);
    // Lines without any of the player's names prove nothing about the player.
    lines = [line('Someone', 10), line('Enemy', 120)];
    expect((await texts.forClip('clip.mp4', 'Valorant', signal, ['Player']))?.feed).toBe(false);
    // Neither does a clip without frames.
    count = 0;
    expect((await texts.forClip('clip.mp4', 'Valorant', signal, ['Player']))?.feed).toBe(false);
    // Aborted reads return nothing, in Valorant as in R6.
    count = 2;
    const stop = new AbortController();
    stop.abort();
    expect(await texts.forClip('clip.mp4', 'Valorant', stop.signal, ['Player'])).toBeUndefined();
    expect(await texts.forClip('clip.mp4', 'R6', stop.signal)).toBeUndefined();
  } finally {
    load.mockRestore();
  }
});

it('drops the Riot tag from the player names for the killfeed', () => {
  expect(feedNames(['Player#EUW', 'Other Name #1234', '#tag', 'Plain'])).toEqual([
    'Player',
    'Other Name',
    'Plain',
  ]);
  expect(feedRead([], ['Player'])).toBe(false);
});

it('loads the models again after a failed attempt', async () => {
  const load = vi
    .spyOn(TextReader, 'load')
    .mockRejectedValueOnce(new Error('File locked'))
    .mockResolvedValue({ read: async () => [], close: async () => {} } as unknown as TextReader);
  try {
    const media = { rawFrames: async function* () {} } as unknown as MediaProcessor;
    const texts = new ClipTexts({ media, models: developmentModels() });
    const signal = new AbortController().signal;
    await expect(texts.forClip('clip.mp4', 'R6', signal)).rejects.toThrow('File locked');
    expect((await texts.forClip('clip.mp4', 'R6', signal))?.trace.frames).toBe(0);
    expect(load).toHaveBeenCalledTimes(2);
  } finally {
    load.mockRestore();
  }
});
