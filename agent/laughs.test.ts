import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { expect, it } from 'vitest';
import {
  ensureModel,
  findMoments,
  HOP,
  LaughDetector,
  modelFolder,
  monoFrom,
  SAMPLE_RATE,
  WINDOW,
  windowCount,
} from './laughs';
import type { ModelFile, WindowScore } from './laughs';

const windows = (laugh: number[]): WindowScore[] =>
  laugh.map((value, i) => ({
    seconds: (i * HOP) / SAMPLE_RATE,
    laugh: value,
    shout: 0,
    speech: 0,
  }));

it('counts a laugh only where two of three windows agree, and merges close hits', () => {
  // A single window above the threshold (second 3.36) is not enough.
  const moments = findMoments(windows([0.1, 0.5, 0.2, 0.6, 0.1, 0.1, 0.1, 0.9, 0.1]), 'laugh', 0.3);
  expect(moments).toEqual([{ kind: 'laugh', start: 0.48, end: 2.4, peak: 0.6 }]);
  // Two hits with a one-window gap form one moment, a three-window gap makes two.
  const split = findMoments(windows([0.5, 0.5, 0, 0, 0, 0.5, 0.5]), 'laugh', 0.3);
  expect(split.map((m) => [m.start, m.end])).toEqual([
    [0, 1.44],
    [2.4, 3.84],
  ]);
  expect(findMoments(windows([0.5, 0.5]), 'laugh', 0.3)).toEqual([]);
  expect(findMoments(windows([0.29, 0.29, 0.29]), 'laugh', 0.3)).toEqual([]);
});

it('takes the loud channel of a one-sided microphone instead of halving it', () => {
  const tone = Float32Array.from({ length: 1600 }, (_, i) => 0.5 * Math.sin(i / 3));
  const quiet = new Float32Array(1600).fill(0.001);
  expect(monoFrom([tone, quiet])).toMatchObject({ channel: 'left', samples: tone });
  expect(monoFrom([quiet, tone])).toMatchObject({ channel: 'right', samples: tone });
  const both = monoFrom([tone, tone]);
  expect(both.channel).toBe('both');
  expect(both.samples[5]).toBeCloseTo(tone[5]);
  expect(monoFrom([tone])).toMatchObject({ channel: 'mono', samples: tone });
});

it('knows how many windows YAMNet returns', () => {
  expect(windowCount(0)).toBe(0);
  // Shorter than one window: padded to one.
  expect(windowCount(8000)).toBe(1);
  // A window reads 0.975 s: 0.96 s plus the rest of the last STFT frame.
  expect(windowCount(WINDOW + 240)).toBe(1);
  expect(windowCount(WINDOW + 241)).toBe(2);
  expect(windowCount(WINDOW + 240 + HOP + 1)).toBe(3);
  expect(windowCount(60 * SAMPLE_RATE)).toBe(124);
});

it('loads the model once, checks its hash and keeps a broken download away', async () => {
  const root = await mkdtemp(join(tmpdir(), 'replayhaven-laughs-'));
  try {
    const bytes = Buffer.from('not a real model, just bytes for the test');
    const model: ModelFile = {
      url: 'https://example.invalid/model/yamnet.onnx',
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    let calls = 0;
    const serve =
      (body: Buffer): typeof fetch =>
      async () => {
        calls++;
        return new Response(new Uint8Array(body));
      };
    const path = await ensureModel(root, model, serve(bytes));
    expect(path).toBe(join(root, 'yamnet.onnx'));
    expect(await readFile(path)).toEqual(bytes);
    // If it is already in place, nothing is downloaded.
    await ensureModel(root, model, serve(bytes));
    expect(calls).toBe(1);
    // A wrong file never lands in the folder, not even half of one.
    const other = await mkdtemp(join(tmpdir(), 'replayhaven-laughs-'));
    try {
      await expect(ensureModel(other, model, serve(Buffer.from('tampered')))).rejects.toThrow(
        /checksum/,
      );
      expect(await readdir(other)).toEqual([]);
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  } finally {
    if (resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('replayhaven-laughs-'))
      await rm(root, { recursive: true, force: true });
  }
});

it('gives up a download that stalls or is cancelled and leaves no partial file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'replayhaven-laughs-'));
  try {
    const model: ModelFile = {
      url: 'https://example.invalid/model/big.onnx',
      bytes: 1000,
      sha256: '0'.repeat(64),
    };
    // One chunk, then the connection stays open without data.
    const stalling: typeof fetch = async (_url, init) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(10));
          },
        }),
      );
    };
    await expect(ensureModel(root, model, stalling, undefined, { stallMs: 50 })).rejects.toThrow(
      /stalled/,
    );
    expect(await readdir(root)).toEqual([]);
    // Headers that never come count as a stall too.
    const silent: typeof fetch = (_url, init) =>
      new Promise((_, reject) =>
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
      );
    await expect(ensureModel(root, model, silent, undefined, { stallMs: 50 })).rejects.toThrow(
      /stalled/,
    );
    // The caller cancels.
    const control = new AbortController();
    const cancelled = ensureModel(root, model, stalling, undefined, {
      signal: control.signal,
      stallMs: 60000,
    });
    setTimeout(() => control.abort(new Error('cancelled by the test')), 20);
    await expect(cancelled).rejects.toThrow(/cancelled by the test/);
    expect(await readdir(root)).toEqual([]);
  } finally {
    if (resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('replayhaven-laughs-'))
      await rm(root, { recursive: true, force: true });
  }
});

// With the real model only if it is already downloaded; the test downloads nothing.
const yamnet = process.env.REPLAYHAVEN_YAMNET ?? join(modelFolder(), 'yamnet.onnx');
it.skipIf(!existsSync(yamnet))(
  'scores long tracks in pieces exactly like in one run',
  async () => {
    const samples = Float32Array.from(
      { length: 30 * SAMPLE_RATE + 1234 },
      (_, i) => 0.3 * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE) * (i % 16000 < 8000 ? 1 : 0),
    );
    const whole = await LaughDetector.load(yamnet, { threads: 2 });
    const pieces = await LaughDetector.load(yamnet, { threads: 2, framesPerRun: 7 });
    try {
      const a = await whole.scores(samples);
      const b = await pieces.scores(samples);
      expect(a).toHaveLength(windowCount(samples.length));
      expect(b).toHaveLength(a.length);
      for (let i = 0; i < a.length; i++) {
        expect(b[i].seconds).toBe(a[i].seconds);
        expect(b[i].laugh).toBeCloseTo(a[i].laugh, 4);
        expect(b[i].speech).toBeCloseTo(a[i].speech, 4);
      }
      // A tone is not laughter.
      expect(findMoments(a, 'laugh', 0.3)).toEqual([]);
    } finally {
      await whole.close();
      await pieces.close();
    }
  },
  60000,
);
