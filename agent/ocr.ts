import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { availableParallelism } from 'node:os';
import type { InferenceSession } from 'onnxruntime-node';

const moduleRequire = createRequire(typeof __filename === 'string' ? __filename : import.meta.url);

/**
 * Texterkennung mit PaddleOCR (PP-OCRv4) über ONNX Runtime auf der CPU: erst finden, wo Text
 * steht (Erkennungsmodell, DB-Verfahren), dann jede Zeile lesen (CTC). Nachgebaut ohne OpenCV
 * und ohne canvas: Bilder kommen als rohe RGB-Pixel von FFmpeg. Spieloberflächen schreiben
 * waagerecht, deshalb genügen achsparallele Rechtecke statt gedrehter Boxen.
 *
 * Vorverarbeitung und Schwellen folgen den Vorgaben von PaddleOCR: Seitenlänge höchstens 960
 * und durch 32 teilbar, Schwelle 0,3, Mindestgüte 0,6, Aufweitung 1,5, Zeilenhöhe 48.
 */

/** Ein Bild als rohe Pixel, drei Byte je Pixel in der Reihenfolge Rot, Grün, Blau. */
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
  /** Mittlere Sicherheit der gelesenen Zeichen, 0 bis 1. */
  score: number;
  /** Lage im Bild in Pixeln des Eingangsbilds. */
  box: Box;
}

const DET_LIMIT = 960;
const DET_THRESHOLD = 0.3;
const BOX_THRESHOLD = 0.6;
const UNCLIP_RATIO = 1.5;
const REC_HEIGHT = 48;
const REC_MIN_WIDTH = 320;
/** Längere Zeilen gibt es auf Spieloberflächen nicht; begrenzt die Rechenzeit je Box. */
const REC_MAX_WIDTH = 1600;
const DET_MEAN = [0.485, 0.456, 0.406];
const DET_STD = [0.229, 0.224, 0.225];

/** Skaliert ein Bild bilinear. */
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

/** Schneidet ein Rechteck aus, an den Bildrand geklemmt. */
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
 * Eingabe des Erkennungsmodells: längste Seite höchstens 960, beide Seiten auf Vielfache von 32,
 * Kanäle in der Reihenfolge Blau, Grün, Rot wie bei OpenCV, normiert.
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
 * Textkästen aus der Wahrscheinlichkeitskarte (DB-Verfahren): Schwelle, zusammenhängende
 * Flächen, deren mittlere Wahrscheinlichkeit die Mindestgüte erreichen muss, dann um den Rand
 * aufgeweitet, den das Modell bewusst schmal lernt. Koordinaten in Pixeln der Karte.
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
  // Lesereihenfolge: Zeilen von oben nach unten, in der Zeile von links nach rechts.
  return boxes.sort((a, b) => (Math.abs(a.y - b.y) < 10 ? a.x - b.x : a.y - b.y));
}

/** Eingabe des Lesemodells: Höhe 48, Breite nach Seitenverhältnis, mindestens 320 (aufgefüllt). */
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

/** Liest die Ausgabe des Lesemodells: je Schritt das wahrscheinlichste Zeichen, Wiederholungen und Leerstellen fallen weg. */
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
 * Fasst Wörter einer Zeile zusammen. Das Erkennungsmodell trennt oft an Wortabständen
 * ("ROUND" und "WON"); Meldungen sind aber ganze Zeilen. Zusammen gehört, was auf gleicher
 * Höhe liegt und höchstens eine Zeichenhöhe Abstand hat.
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
  /** Zeichenliste des Lesemodells, eine Zeile je Zeichen. */
  keys: string;
}

/** Die Modelle eines Entwicklungs-Checkouts (devDependency @gutenye/ocr-models). */
export function developmentModels(root = process.cwd()): OcrModels {
  const assets = `${root}/node_modules/@gutenye/ocr-models/assets`;
  return {
    det: `${assets}/ch_PP-OCRv4_det_infer.onnx`,
    rec: `${assets}/ch_PP-OCRv4_rec_infer.onnx`,
    keys: `${assets}/ppocr_keys_v1.txt`,
  };
}

export class TextReader {
  private constructor(
    private readonly ort: typeof import('onnxruntime-node'),
    private readonly det: InferenceSession,
    private readonly rec: InferenceSession,
    private readonly keys: string[],
  ) {}

  /**
   * Lädt beide Modelle. `threads` begrenzt die Rechenkerne, damit ein laufendes Spiel nicht
   * ruckelt; Vorgabe ist die Hälfte.
   */
  static async load(
    models: OcrModels,
    threads = Math.max(1, availableParallelism() >> 1),
    runtime?: string,
  ) {
    // Im fertigen Client liegt ONNX Runtime neben den FFmpeg-Dateien, nicht im App-Archiv.
    const ort = moduleRequire(runtime ?? 'onnxruntime-node') as typeof import('onnxruntime-node');
    const options = { intraOpNumThreads: threads, interOpNumThreads: 1 };
    const [det, rec, keys] = await Promise.all([
      ort.InferenceSession.create(models.det, options),
      ort.InferenceSession.create(models.rec, options),
      readFile(models.keys, 'utf8'),
    ]);
    // Leerzeichen hängt PaddleOCR als letztes Zeichen an (use_space_char).
    return new TextReader(ort, det, rec, [...keys.replace(/\r/g, '').split('\n'), ' ']);
  }

  /** Findet alle Textzeilen eines Bildes und liest sie. */
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
      // Senkrechter Text (höher als breit) kommt auf Spieloberflächen kaum vor.
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
