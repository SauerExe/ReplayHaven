import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createRequire } from 'node:module';
import { availableParallelism, homedir } from 'node:os';
import { join } from 'node:path';
import type { InferenceSession } from 'onnxruntime-node';

/**
 * Stage 1 from docs/AUDIO-CONCEPT.md: find laughs and shouts in an audio track, with YAMNet on
 * the CPU. So far only used by the measuring tool `npm run laughs`; the analysis does not use it.
 */

const moduleRequire = createRequire(typeof __filename === 'string' ? __filename : import.meta.url);

export interface ModelFile {
  url: string;
  /** File name in the model folder; otherwise the last part of the URL. */
  file?: string;
  bytes: number;
  sha256: string;
}

/**
 * YAMNet as ONNX (Apache-2.0): unmodified tf2onnx conversion with the mel frontend in the graph,
 * pinned to revision and checksum. It is not in the installer but downloaded when needed.
 */
export const YAMNET: ModelFile = {
  url: 'https://huggingface.co/audiomagic/yamnet-onnx/resolve/f25b741c2f0bdc6d7e6db24b5fddda23347dbafd/yamnet.onnx',
  bytes: 16093355,
  sha256: 'd3835ffbbd4a1bb3e777f0ca217b5007907f5171dd5d17c4236b95b2af8f908e',
};

export const SAMPLE_RATE = 16000;
/** A window spans 0.96 s; the next one starts 0.48 s later. */
export const WINDOW = 15360;
export const HOP = 7680;
/** Samples a window actually reads: plus the rest of the last STFT frame, 0.975 s. */
const PATCH = 15600;
const CLASSES = 521;
/** AudioSet classes in YAMNet: laughter and subtypes, shouting to screaming and cheering, speech. */
const LAUGH = [13, 14, 15, 16, 17, 18];
const SHOUT = [6, 7, 8, 9, 10, 11, 61];
const SPEECH = 0;
/** Windows per model run: two minutes, so long recordings do not blow up memory. */
const FRAMES_PER_RUN = 250;

export interface WindowScore {
  /** Start of the window in seconds; it extends 0.96 s further. */
  seconds: number;
  laugh: number;
  shout: number;
  speech: number;
}

export interface Moment {
  kind: 'laugh' | 'shout';
  start: number;
  end: number;
  peak: number;
}

/** Folder for downloaded models, on Windows in the local app data folder. */
export function modelFolder(env: NodeJS.ProcessEnv = process.env) {
  return env.LOCALAPPDATA
    ? join(env.LOCALAPPDATA, 'ReplayHaven', 'models')
    : join(homedir(), '.cache', 'replayhaven');
}

async function matches(path: string, model: ModelFile) {
  try {
    if ((await stat(path)).size !== model.bytes) return false;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
    return hash.digest('hex') === model.sha256;
  } catch {
    return false;
  }
}

/**
 * Path to the model in `folder`; if it is missing there or does not match, it is downloaded and
 * checked against size and SHA-256. A file with a wrong checksum is never stored.
 */
export async function ensureModel(
  folder: string,
  model: ModelFile = YAMNET,
  get: typeof fetch = fetch,
  onDownload?: () => void,
) {
  const path = join(folder, model.file ?? model.url.split('/').at(-1)!);
  if (await matches(path, model)) return path;
  onDownload?.();
  const response = await get(model.url);
  if (!response.ok || !response.body)
    throw new Error(`Model could not be downloaded (HTTP ${response.status}).`);
  await mkdir(folder, { recursive: true });
  const partial = `${path}.part`;
  // Streamed to disk: the speech model is 650 MB and does not belong in memory.
  const hash = createHash('sha256');
  const wrong = () => new Error('The downloaded model has a wrong checksum and was discarded.');
  let size = 0;
  try {
    await pipeline(
      Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
      new Transform({
        transform(chunk: Buffer, _encoding, done) {
          size += chunk.length;
          if (size > model.bytes) return done(wrong());
          hash.update(chunk);
          done(null, chunk);
        },
      }),
      createWriteStream(partial),
    );
    if (size !== model.bytes || hash.digest('hex') !== model.sha256) throw wrong();
    await rename(partial, path);
  } finally {
    await rm(partial, { force: true });
  }
  return path;
}

/**
 * One track for YAMNet. If the microphone is on only one channel (the other at least 20 dB
 * quieter), only that one counts; otherwise the mean of both channels.
 */
export function monoFrom(channels: readonly Float32Array[]): {
  samples: Float32Array;
  channel: 'mono' | 'left' | 'right' | 'both';
} {
  if (channels.length < 2) return { samples: channels[0] ?? new Float32Array(), channel: 'mono' };
  const [left, right] = channels;
  const power = (samples: Float32Array) => {
    let sum = 0;
    for (const v of samples) sum += v * v;
    return sum / Math.max(1, samples.length);
  };
  const l = power(left);
  const r = power(right);
  // 20 dB difference in amplitude is a factor of 100 in power.
  if (r < l / 100) return { samples: left, channel: 'left' };
  if (l < r / 100) return { samples: right, channel: 'right' };
  const samples = new Float32Array(Math.min(left.length, right.length));
  for (let i = 0; i < samples.length; i++) samples[i] = (left[i] + right[i]) / 2;
  return { samples, channel: 'both' };
}

/**
 * How many windows YAMNet returns for this many samples; a remainder is padded with silence.
 * Counted against the model; the formula in the ONNX version's README is off by one at the edge.
 */
export function windowCount(samples: number) {
  return samples === 0 ? 0 : 1 + Math.ceil(Math.max(0, samples - PATCH) / HOP);
}

/**
 * Spots with laughing or shouting. A window counts from `threshold` on, but a hit only when at
 * least two of three consecutive windows are above it. Hits at most one window apart belong to
 * one moment.
 */
export function findMoments(
  windows: readonly WindowScore[],
  kind: 'laugh' | 'shout',
  threshold: number,
): Moment[] {
  const hit = windows.map((w) => w[kind] >= threshold);
  const confirmed = hit.map(
    (h, i) =>
      h &&
      [i - 2, i - 1, i].some(
        (j) => j >= 0 && j + 2 < hit.length && hit.slice(j, j + 3).filter(Boolean).length >= 2,
      ),
  );
  const moments: Moment[] = [];
  let first = -1;
  let last = -1;
  const close = () => {
    if (first < 0) return;
    const inside = windows.slice(first, last + 1).map((w) => w[kind]);
    moments.push({
      kind,
      start: windows[first].seconds,
      end: windows[last].seconds + WINDOW / SAMPLE_RATE,
      peak: Math.max(...inside),
    });
  };
  confirmed.forEach((ok, i) => {
    if (!ok) return;
    if (first >= 0 && i - last > 2) {
      close();
      first = -1;
    }
    if (first < 0) first = i;
    last = i;
  });
  close();
  return moments;
}

export class LaughDetector {
  private constructor(
    private readonly ort: typeof import('onnxruntime-node'),
    private readonly session: InferenceSession,
    private readonly framesPerRun: number,
  ) {}

  /** Loads YAMNet; `threads` limits the CPU cores, half by default. */
  static async load(
    model: string,
    options: { threads?: number; runtime?: string; framesPerRun?: number } = {},
  ) {
    const ort = moduleRequire(
      options.runtime ?? 'onnxruntime-node',
    ) as typeof import('onnxruntime-node');
    const session = await ort.InferenceSession.create(model, {
      intraOpNumThreads: options.threads ?? Math.max(1, availableParallelism() >> 1),
      interOpNumThreads: 1,
    });
    return new LaughDetector(ort, session, options.framesPerRun ?? FRAMES_PER_RUN);
  }

  /**
   * Scores per window for a 16 kHz track. Long tracks run in pieces that join exactly at window
   * boundaries and contain all samples of their last window, so the scores match a single run.
   */
  async scores(samples: Float32Array): Promise<WindowScore[]> {
    const total = windowCount(samples.length);
    const out: WindowScore[] = [];
    for (let from = 0; from < total; from += this.framesPerRun) {
      const to = Math.min(total, from + this.framesPerRun);
      const part = samples.slice(
        from * HOP,
        to === total ? samples.length : (to - 1) * HOP + PATCH,
      );
      const result = await this.session.run({
        [this.session.inputNames[0]]: new this.ort.Tensor('float32', part, [part.length]),
      });
      const data = result[this.session.outputNames[0]].data as Float32Array;
      const frames = Math.min(to - from, data.length / CLASSES);
      for (let i = 0; i < frames; i++) {
        const row = data.subarray(i * CLASSES, (i + 1) * CLASSES);
        out.push({
          seconds: ((from + i) * HOP) / SAMPLE_RATE,
          laugh: Math.max(...LAUGH.map((c) => row[c])),
          shout: Math.max(...SHOUT.map((c) => row[c])),
          speech: row[SPEECH],
        });
      }
    }
    return out;
  }

  async close() {
    await this.session.release();
  }
}
