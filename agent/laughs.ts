import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { availableParallelism, homedir } from 'node:os';
import { join } from 'node:path';
import type { InferenceSession } from 'onnxruntime-node';

/**
 * Stufe 1 aus docs/TON-KONZEPT.md: Lacher und Rufe in einer Tonspur finden, mit YAMNet auf der
 * CPU. Bisher nur für das Messwerkzeug `npm run laughs`; die Analyse nutzt es nicht.
 */

const moduleRequire = createRequire(typeof __filename === 'string' ? __filename : import.meta.url);

export interface ModelFile {
  url: string;
  /** Dateiname in der Ablage; sonst der letzte Teil der Adresse. */
  file?: string;
  bytes: number;
  sha256: string;
}

/**
 * YAMNet als ONNX (Apache-2.0): unveränderte tf2onnx-Umwandlung mit dem Mel-Frontend im Graph,
 * gepinnt auf Revision und Prüfsumme. Es liegt nicht im Installer, sondern wird bei Bedarf geladen.
 */
export const YAMNET: ModelFile = {
  url: 'https://huggingface.co/audiomagic/yamnet-onnx/resolve/f25b741c2f0bdc6d7e6db24b5fddda23347dbafd/yamnet.onnx',
  bytes: 16093355,
  sha256: 'd3835ffbbd4a1bb3e777f0ca217b5007907f5171dd5d17c4236b95b2af8f908e',
};

export const SAMPLE_RATE = 16000;
/** Ein Fenster umfasst 0,96 s, das nächste beginnt 0,48 s später. */
export const WINDOW = 15360;
export const HOP = 7680;
/** Samples, die ein Fenster tatsächlich liest: dazu der Rest des letzten STFT-Rahmens, 0,975 s. */
const PATCH = 15600;
const CLASSES = 521;
/** AudioSet-Klassen in YAMNet: Lachen samt Untertypen, Rufen bis Schreien und Jubel, Sprache. */
const LAUGH = [13, 14, 15, 16, 17, 18];
const SHOUT = [6, 7, 8, 9, 10, 11, 61];
const SPEECH = 0;
/** Fenster je Modelllauf: zwei Minuten, damit lange Aufnahmen den Speicher nicht sprengen. */
const FRAMES_PER_RUN = 250;

export interface WindowScore {
  /** Beginn des Fensters in Sekunden; es reicht 0,96 s weiter. */
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

/** Ablage für geladene Modelle, unter Windows im lokalen App-Ordner. */
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
 * Pfad zum Modell im Ordner `folder`; fehlt es dort oder stimmt es nicht, wird es geladen und
 * gegen Größe und SHA-256 geprüft. Eine Datei mit falscher Prüfsumme wird nie abgelegt.
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
  if (!response.ok) throw new Error(`Modell nicht ladbar (HTTP ${response.status}).`);
  const data = Buffer.from(await response.arrayBuffer());
  const sum = createHash('sha256').update(data).digest('hex');
  if (data.length !== model.bytes || sum !== model.sha256)
    throw new Error('Das geladene Modell hat eine falsche Prüfsumme und wurde verworfen.');
  await mkdir(folder, { recursive: true });
  const partial = `${path}.part`;
  try {
    await writeFile(partial, data);
    await rename(partial, path);
  } finally {
    await rm(partial, { force: true });
  }
  return path;
}

/**
 * Eine Spur für YAMNet. Liegt das Mikrofon nur auf einem Kanal (der andere mindestens 20 dB
 * leiser), zählt nur dieser; sonst der Mittelwert beider Kanäle.
 */
export function monoFrom(channels: readonly Float32Array[]): {
  samples: Float32Array;
  channel: 'mono' | 'links' | 'rechts' | 'beide';
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
  // 20 dB Abstand in der Amplitude sind Faktor 100 in der Leistung.
  if (r < l / 100) return { samples: left, channel: 'links' };
  if (l < r / 100) return { samples: right, channel: 'rechts' };
  const samples = new Float32Array(Math.min(left.length, right.length));
  for (let i = 0; i < samples.length; i++) samples[i] = (left[i] + right[i]) / 2;
  return { samples, channel: 'beide' };
}

/**
 * Wie viele Fenster YAMNet für so viele Samples liefert; was nicht aufgeht, füllt es mit Stille
 * auf. Am Modell nachgezählt; die Formel im README der ONNX-Fassung liegt am Rand um eins daneben.
 */
export function windowCount(samples: number) {
  return samples === 0 ? 0 : 1 + Math.ceil(Math.max(0, samples - PATCH) / HOP);
}

/**
 * Stellen mit Lachen oder Rufen. Ein Fenster zählt ab `threshold`, ein Treffer aber erst, wenn
 * von drei aufeinanderfolgenden Fenstern mindestens zwei darüber liegen. Treffer mit höchstens
 * einem Fenster Abstand gehören zu einem Moment.
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

  /** Lädt YAMNet; `threads` begrenzt die Rechenkerne, Vorgabe ist die Hälfte. */
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
   * Werte je Fenster für eine Spur mit 16 kHz. Lange Spuren laufen in Stücken, die genau an
   * Fenstergrenzen anschließen und alle Samples ihres letzten Fensters enthalten, sodass sich
   * dieselben Werte ergeben wie in einem Lauf.
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
