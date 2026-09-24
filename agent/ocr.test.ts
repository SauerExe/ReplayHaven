import { existsSync } from 'node:fs';
import sharp from 'sharp';
import { expect, it } from 'vitest';
import {
  boxesFromMap,
  crop,
  ctcDecode,
  detInput,
  developmentModels,
  joinRows,
  missingLibrary,
  recInput,
  resizeRgb,
  TextReader,
} from './ocr';

const solid = (width: number, height: number, rgb: [number, number, number]) => ({
  width,
  height,
  data: new Uint8Array(Array.from({ length: width * height }, () => rgb).flat()),
});

it('resizes and crops raw RGB frames', () => {
  const frame = solid(4, 2, [10, 20, 30]);
  frame.data.set([200, 0, 0], (1 * 4 + 3) * 3);
  const big = resizeRgb(frame, 8, 4);
  expect([...big.data.subarray(0, 3)]).toEqual([10, 20, 30]);
  expect([...big.data.subarray((3 * 8 + 7) * 3, (3 * 8 + 7) * 3 + 3)]).toEqual([200, 0, 0]);
  const corner = crop(frame, { x: 2.4, y: 0.5, w: 9, h: 9 });
  expect([corner.width, corner.height]).toEqual([2, 2]);
  expect([...corner.data.subarray(9, 12)]).toEqual([200, 0, 0]);
});

it('prepares detector input in multiples of 32, blue channel first', () => {
  const input = detInput(solid(1280, 720, [255, 0, 0]));
  expect([input.width, input.height]).toEqual([960, 544]);
  const plane = input.width * input.height;
  // Rot liegt bei OpenCV im dritten Kanal.
  expect(input.data[0]).toBeCloseTo((0 - 0.485) / 0.229, 4);
  expect(input.data[2 * plane]).toBeCloseTo((1 - 0.406) / 0.225, 4);
  const line = recInput(solid(100, 20, [255, 255, 255]));
  expect(line.width).toBe(320);
  expect(line.data[0]).toBeCloseTo(1, 4);
  // Rechts aufgefüllt mit 0, der Mitte des Wertebereichs.
  expect(line.data[319]).toBe(0);
});

it('finds text boxes in a probability map and drops weak areas', () => {
  const width = 64;
  const height = 32;
  const map = new Float32Array(width * height);
  const paint = (x0: number, y0: number, w: number, h: number, p: number) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) map[y * width + x] = p;
  };
  paint(4, 4, 20, 6, 0.9);
  paint(40, 20, 10, 6, 0.45);
  paint(60, 0, 1, 1, 0.99);
  const boxes = boxesFromMap(map, width, height);
  expect(boxes).toHaveLength(1);
  // Aufgeweitet um Fläche · 1,5 / Umfang = 120 · 1,5 / 52 ≈ 3,46 Pixel je Seite.
  expect(boxes[0].x).toBeCloseTo(4 - 3.46, 1);
  expect(boxes[0].w).toBeCloseTo(20 + 6.92, 1);
});

it('decodes CTC output without blanks and repeats', () => {
  const keys = ['a', 'b', 'c', 'd', 'e', ' '];
  const steps = [0, 3, 3, 0, 5, 5, 6, 1];
  const probs = new Float32Array(steps.length * 7);
  steps.forEach((k, t) => (probs[t * 7 + k] = 0.8));
  const read = ctcDecode(probs, steps.length, 7, keys);
  expect(read.text).toBe('ce a');
  expect(read.score).toBeCloseTo(0.8, 5);
});

it('recognises a missing runtime library in English and German Windows messages', () => {
  const dlopen = Object.assign(
    new Error('The specified module could not be found.\r\n\\\\?\\C:\\x\\onnxruntime_binding.node'),
    { code: 'ERR_DLOPEN_FAILED' },
  );
  expect(missingLibrary(dlopen)).toBe(true);
  expect(missingLibrary(new Error('Das angegebene Modul wurde nicht gefunden.'))).toBe(true);
  expect(missingLibrary(new Error('Die angegebene Prozedur wurde nicht gefunden.'))).toBe(true);
  expect(missingLibrary(new Error("Cannot find module './models/det.onnx'"))).toBe(false);
  expect(missingLibrary(undefined)).toBe(false);
});

it('joins words of one line and keeps separate lines apart', () => {
  const at = (text: string, x: number, y: number, w: number) => ({
    text,
    score: 0.9,
    box: { x, y, w, h: 40 },
  });
  expect(
    joinRows([at('WON', 668, 282, 110), at('ROUND', 413, 283, 230), at('OREGON', 58, 55, 140)]).map(
      (r) => r.text,
    ),
  ).toEqual(['OREGON', 'ROUND WON']);
});

const models = developmentModels();
it.skipIf(!existsSync(models.det))(
  'reads rendered HUD text with the PP-OCRv4 models',
  async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
      <rect width="1280" height="720" fill="#1b2330"/>
      <text x="640" y="330" font-family="sans-serif" font-weight="bold" font-size="64" fill="#ffffff" text-anchor="middle">ROUND WON</text>
      <text x="60" y="80" font-family="sans-serif" font-size="28" fill="#e0e0e0">OREGON</text>
    </svg>`;
    const { data, info } = await sharp(Buffer.from(svg))
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const reader = await TextReader.load(models, 2);
    try {
      const rows = joinRows(await reader.read({ width: info.width, height: info.height, data }));
      expect(rows.map((r) => r.text)).toEqual(['OREGON', 'ROUND WON']);
      expect(Math.min(...rows.map((r) => r.score))).toBeGreaterThan(0.8);
    } finally {
      await reader.close();
    }
  },
  30000,
);
