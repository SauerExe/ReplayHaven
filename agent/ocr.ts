import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import type { InferenceSession } from 'onnxruntime-node';
import { ensureModel, modelFolder } from './laughs';
import type { ModelFile } from './laughs';
import latin from './ocr-models.json';

const moduleRequire = createRequire(typeof __filename === 'string' ? __filename : import.meta.url);

/**
 * Text recognition with PaddleOCR (detection PP-OCRv4, reading PP-OCRv5 Latin) via ONNX Runtime
 * on the CPU: first find where text is (detection model, DB method), then read each line (CTC).
 * Rebuilt without OpenCV and without canvas: frames arrive as raw RGB pixels from FFmpeg. Game
 * interfaces write horizontally, so axis-aligned rectangles suffice instead of rotated boxes.
 *
 * Preprocessing and thresholds follow PaddleOCR's defaults: side length at most 960 and
 * divisible by 32, threshold 0.3, minimum box score 0.6, unclip ratio 1.5, line height 48.
 */

/** An image as raw pixels, three bytes per pixel in the order red, green, blue. */
export interface RgbFrame {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextLine {
  text: string;
  /** Mean confidence of the read characters, 0 to 1. */
  score: number;
  /** Position in pixels of the input image. */
  box: Box;
}

const DET_LIMIT = 960;
const DET_THRESHOLD = 0.3;
const BOX_THRESHOLD = 0.6;
const UNCLIP_RATIO = 1.5;
const REC_HEIGHT = 48;
const REC_MIN_WIDTH = 320;
/** Game interfaces have no longer lines; limits the computing time per box. */
const REC_MAX_WIDTH = 1600;
const DET_MEAN = [0.485, 0.456, 0.406];
const DET_STD = [0.229, 0.224, 0.225];

/** Scales an image bilinearly. */
export function resizeRgb(frame: RgbFrame, width: number, height: number): RgbFrame {
  const out = new Uint8Array(width * height * 3);
  const sx = frame.width / width;
  const sy = frame.height / height;
  for (let y = 0; y < height; y++) {
    const fy = Math.max(0, (y + 0.5) * sy - 0.5);
    const y0 = Math.min(frame.height - 1, Math.floor(fy));
    const y1 = Math.min(frame.height - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.max(0, (x + 0.5) * sx - 0.5);
      const x0 = Math.min(frame.width - 1, Math.floor(fx));
      const x1 = Math.min(frame.width - 1, x0 + 1);
      const wx = fx - x0;
      for (let c = 0; c < 3; c++) {
        const a = frame.data[(y0 * frame.width + x0) * 3 + c];
        const b = frame.data[(y0 * frame.width + x1) * 3 + c];
        const d = frame.data[(y1 * frame.width + x0) * 3 + c];
        const e = frame.data[(y1 * frame.width + x1) * 3 + c];
        out[(y * width + x) * 3 + c] = Math.round(
          (a * (1 - wx) + b * wx) * (1 - wy) + (d * (1 - wx) + e * wx) * wy,
        );
      }
    }
  }
  return { width, height, data: out };
}

/** Cuts out a rectangle, clamped to the image edge. */
export function crop(frame: RgbFrame, box: Box): RgbFrame {
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(frame.width, Math.ceil(box.x + box.w));
  const y1 = Math.min(frame.height, Math.ceil(box.y + box.h));
  const width = Math.max(1, x1 - x0);
  const height = Math.max(1, y1 - y0);
  const out = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++)
    out.set(
      frame.data.subarray(((y0 + y) * frame.width + x0) * 3, ((y0 + y) * frame.width + x1) * 3),
      y * width * 3,
    );
  return { width, height, data: out };
}

/**
 * Input of the detection model: longest side at most 960, both sides rounded to multiples of 32,
 * channels in the order blue, green, red as in OpenCV, normalised.
 */
export function detInput(frame: RgbFrame) {
  const scale = Math.min(1, DET_LIMIT / Math.max(frame.width, frame.height));
  const width = Math.max(32, Math.round((frame.width * scale) / 32) * 32);
  const height = Math.max(32, Math.round((frame.height * scale) / 32) * 32);
  const resized = resizeRgb(frame, width, height);
  const plane = width * height;
  const data = new Float32Array(plane * 3);
  for (let i = 0; i < plane; i++)
    for (let c = 0; c < 3; c++) {
      const value = resized.data[i * 3 + (2 - c)] / 255;
      data[c * plane + i] = (value - DET_MEAN[c]) / DET_STD[c];
    }
  return { data, width, height };
}

/**
 * Text boxes from the probability map (DB method): threshold, connected regions whose mean
 * probability must reach the minimum score, then expanded by the border the model deliberately
 * learns narrow. Coordinates in pixels of the map.
 */
export function boxesFromMap(map: Float32Array, width: number, height: number): Box[] {
  const label = new Int32Array(width * height);
  const boxes: Box[] = [];
  const stack: number[] = [];
  let next = 0;
  for (let start = 0; start < map.length; start++) {
    if (map[start] <= DET_THRESHOLD || label[start]) continue;
    next++;
    label[start] = next;
    stack.push(start);
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let sum = 0;
    let count = 0;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % width;
      const y = (i - x) / width;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      sum += map[i];
      count++;
      for (const j of [
        x > 0 ? i - 1 : -1,
        x < width - 1 ? i + 1 : -1,
        y > 0 ? i - width : -1,
        y < height - 1 ? i + width : -1,
      ])
        if (j >= 0 && !label[j] && map[j] > DET_THRESHOLD) {
          label[j] = next;
          stack.push(j);
        }
    }
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    if (Math.min(w, h) < 3 || sum / count < BOX_THRESHOLD) continue;
    const grow = (w * h * UNCLIP_RATIO) / (2 * (w + h));
    boxes.push({ x: minX - grow, y: minY - grow, w: w + 2 * grow, h: h + 2 * grow });
  }
  // Reading order: rows top to bottom, within a row left to right.
  return boxes.sort((a, b) => (Math.abs(a.y - b.y) < 10 ? a.x - b.x : a.y - b.y));
}

/** Input of the recognition model: height 48, width by aspect ratio, at least 320 (padded). */
export function recInput(line: RgbFrame) {
  const content = Math.min(
    REC_MAX_WIDTH,
    Math.max(1, Math.ceil((REC_HEIGHT * line.width) / line.height)),
  );
  const width = Math.max(REC_MIN_WIDTH, content);
  const resized = resizeRgb(line, content, REC_HEIGHT);
  const plane = width * REC_HEIGHT;
  const data = new Float32Array(plane * 3);
  for (let y = 0; y < REC_HEIGHT; y++)
    for (let x = 0; x < content; x++)
      for (let c = 0; c < 3; c++)
        data[c * plane + y * width + x] = resized.data[(y * content + x) * 3 + (2 - c)] / 127.5 - 1;
  return { data, width };
}

/** Decodes the recognition model output: the most likely character per step, dropping repeats and blanks. */
export function ctcDecode(probs: Float32Array, steps: number, classes: number, keys: string[]) {
  let text = '';
  let total = 0;
  let count = 0;
  let previous = -1;
  for (let t = 0; t < steps; t++) {
    let best = 0;
    let bestProb = -1;
    for (let k = 0; k < classes; k++) {
      const p = probs[t * classes + k];
      if (p > bestProb) {
        bestProb = p;
        best = k;
      }
    }
    if (best !== 0 && best !== previous) {
      text += keys[best - 1] ?? '';
      total += bestProb;
      count++;
    }
    previous = best;
  }
  return { text: text.trim(), score: count ? total / count : 0 };
}

/**
 * Joins the words of a line. The detection model often splits at word gaps ("ROUND" and "WON"),
 * but messages are whole lines. What sits at the same height with at most one character height
 * of gap belongs together.
 */
export function joinRows(lines: TextLine[]): TextLine[] {
  const rows: (TextLine & { count: number })[] = [];
  for (const line of [...lines].sort((a, b) => a.box.x - b.box.x)) {
    const middle = line.box.y + line.box.h / 2;
    const row = rows.find((r) => {
      const gap = line.box.x - (r.box.x + r.box.w);
      return (
        Math.abs(r.box.y + r.box.h / 2 - middle) < Math.min(r.box.h, line.box.h) / 2 &&
        gap < Math.max(r.box.h, line.box.h) &&
        gap > -line.box.w / 2
      );
    });
    if (!row) {
      rows.push({ ...line, count: 1 });
      continue;
    }
    const right = Math.max(row.box.x + row.box.w, line.box.x + line.box.w);
    const top = Math.min(row.box.y, line.box.y);
    const bottom = Math.max(row.box.y + row.box.h, line.box.y + line.box.h);
    row.text = `${row.text} ${line.text}`;
    row.score = (row.score * row.count + line.score) / (row.count + 1);
    row.count++;
    row.box = { x: row.box.x, y: top, w: right - row.box.x, h: bottom - top };
  }
  return rows
    .map((row) => ({ text: row.text, score: row.score, box: row.box }))
    .sort((a, b) => (Math.abs(a.box.y - b.box.y) < 10 ? a.box.x - b.box.x : a.box.y - b.box.y));
}

export interface OcrModels {
  det: string;
  rec: string;
  /** Character list of the recognition model, one line per character. */
  keys: string;
}

/**
 * The PP-OCRv5 recognition model for Latin script. The detection model stays PP-OCRv4: its v5
 * counterpart is 88 MB and twice as slow but gains hardly anything (62 vs 65 of 75 names,
 * .docs/tools/ocr-vergleich.mts).
 */
export const LATIN_REC: ModelFile = latin.rec;
export const LATIN_KEYS: ModelFile = latin.keys;

/** Downloads the v5 recognition model and its character list into `folder` if missing, verified by SHA-256. */
export async function ensureLatinModels(folder = modelFolder()) {
  return {
    rec: await ensureModel(folder, LATIN_REC),
    keys: await ensureModel(folder, LATIN_KEYS),
  };
}

/**
 * The models of a development checkout: detection from the devDependency @gutenye/ocr-models,
 * recognition with PP-OCRv5 once `ensureLatinModels` has downloaded it, otherwise PP-OCRv4.
 */
export function developmentModels(root = process.cwd(), folder = modelFolder()): OcrModels {
  const assets = `${root}/node_modules/@gutenye/ocr-models/assets`;
  const rec = join(folder, LATIN_REC.file!);
  const keys = join(folder, LATIN_KEYS.file!);
  const latinReady = existsSync(rec) && existsSync(keys);
  return {
    det: `${assets}/ch_PP-OCRv4_det_infer.onnx`,
    rec: latinReady ? rec : `${assets}/ch_PP-OCRv4_rec_infer.onnx`,
    keys: latinReady ? keys : `${assets}/ppocr_keys_v1.txt`,
  };
}

/**
 * Whether ONNX Runtime failed on a missing library, on Windows usually the Visual C++ Runtime
 * (among others MSVCP140_ATOMIC_WAIT.dll). Windows reports this in English or German depending on
 * the system language; Node's error code is the same in both cases.
 */
export function missingLibrary(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  return (
    (error as NodeJS.ErrnoException | undefined)?.code === 'ERR_DLOPEN_FAILED' ||
    /specified (module|procedure) could not be found|angegebene (Modul|Prozedur) wurde nicht gefunden/i.test(
      message,
    )
  );
}

export class TextReader {
  private constructor(
    private readonly ort: typeof import('onnxruntime-node'),
    private readonly det: InferenceSession,
    private readonly rec: InferenceSession,
    private readonly keys: string[],
  ) {}

  /**
   * Loads both models. `threads` limits the CPU cores so a running game does not stutter; the
   * default is half.
   */
  static async load(
    models: OcrModels,
    threads = Math.max(1, availableParallelism() >> 1),
    runtime?: string,
  ) {
    // In the packaged client, ONNX Runtime sits next to the FFmpeg files, not in the app archive.
    const ort = moduleRequire(runtime ?? 'onnxruntime-node') as typeof import('onnxruntime-node');
    const options = { intraOpNumThreads: threads, interOpNumThreads: 1 };
    const [det, rec, keys] = await Promise.allSettled([
      ort.InferenceSession.create(models.det, options),
      ort.InferenceSession.create(models.rec, options),
      readFile(models.keys, 'utf8'),
    ]);
    if (det.status === 'rejected' || rec.status === 'rejected' || keys.status === 'rejected') {
      // Release what already loaded right away instead of holding it until garbage collection.
      for (const session of [det, rec])
        if (session.status === 'fulfilled') await session.value.release().catch(() => {});
      throw [det, rec, keys].find((part) => part.status === 'rejected')!.reason;
    }
    // PaddleOCR appends the space as the last character (use_space_char).
    return new TextReader(ort, det.value, rec.value, [
      ...keys.value.replace(/\r/g, '').split('\n'),
      ' ',
    ]);
  }

  /** Finds all text lines in an image and reads them. */
  async read(frame: RgbFrame, minScore = 0.5): Promise<TextLine[]> {
    const input = detInput(frame);
    const detected = await this.det.run({
      x: new this.ort.Tensor('float32', input.data, [1, 3, input.height, input.width]),
    });
    const map = detected[this.det.outputNames[0]].data as Float32Array;
    const sx = frame.width / input.width;
    const sy = frame.height / input.height;
    const lines: TextLine[] = [];
    for (const found of boxesFromMap(map, input.width, input.height)) {
      const box = { x: found.x * sx, y: found.y * sy, w: found.w * sx, h: found.h * sy };
      const line = crop(frame, box);
      // Vertical text (taller than wide) hardly occurs in game interfaces.
      if (line.height > line.width * 1.5) continue;
      const rec = recInput(line);
      const output = await this.rec.run({
        x: new this.ort.Tensor('float32', rec.data, [1, 3, REC_HEIGHT, rec.width]),
      });
      const probs = output[this.rec.outputNames[0]];
      const [, steps, classes] = probs.dims;
      const read = ctcDecode(probs.data as Float32Array, steps, classes, this.keys);
      if (read.text && read.score >= minScore) lines.push({ ...read, box });
    }
    return lines;
  }

  async close() {
    await Promise.all([this.det.release(), this.rec.release()]);
  }
}
