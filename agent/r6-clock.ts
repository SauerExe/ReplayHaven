import { crop } from './ocr';
import type { TextLine, TextReader } from './ocr';
import type { MediaProcessor } from '../server/media';

/**
 * Time anchor for the R6 replays (docs/R6-REPLAYS.md): kills in the replay carry the round clock
 * from the HUD, not a wall-clock time. If text recognition reads the same clock in the clip, clip
 * second + clock is constant within a phase, and every kill converts to a clip second. Exactly
 * where the HUD shows the clock has not yet been measured on real clips, so the top-centre region
 * is generous.
 */

/** Top-centre region, as a fraction of the frame's width and height. */
export const CLOCK_AREA = { x: 0.35, y: 0, w: 0.3, h: 0.12 };
/** The preparation phase counts down from 0:45; a higher value surely belongs to the action phase. */
const PREP_SECONDS = 45;

/** The round clock in a read line, "2:47" or "2.47", in seconds. */
export function clockValue(text: string): number | undefined {
  const match = /(?<![\d:.])([0-4])\s?[:.]\s?([0-5]\d)(?![\d:.])/.exec(text);
  return match ? Number(match[1]) * 60 + Number(match[2]) : undefined;
}

/** The clock in a region: the confidently read line closest to the centre. */
export function clockIn(lines: readonly TextLine[], width: number): number | undefined {
  return lines
    .filter((line) => line.score >= 0.8)
    .map((line) => ({
      value: clockValue(line.text),
      distance: Math.abs(line.box.x + line.box.w / 2 - width / 2),
    }))
    .filter((c): c is { value: number; distance: number } => c.value !== undefined)
    .sort((a, b) => a.distance - b.distance)[0]?.value;
}

export interface ClockSample {
  /** Time of the frame in the clip, in seconds. */
  seconds: number;
  clock: number;
}

export interface ClockAnchor {
  /** Clip second + clock, constant within a phase. */
  anchor: number;
  /** Number of matching readings. */
  samples: number;
  /** Lowest and highest clock read in the phase. */
  low: number;
  high: number;
  /** A reading above 0:45: surely the action phase, not preparation. */
  action: boolean;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Groups the readings by clip second + clock. A group needs at least `minimum` readings at most
 * `tolerance` seconds apart, so misreads drop out. Several groups arise at phase changes
 * (preparation, action phase, defuser). The largest group comes first.
 */
export function clockAnchors(
  samples: readonly ClockSample[],
  minimum = 3,
  tolerance = 1.5,
): ClockAnchor[] {
  const sums = samples
    .map((s) => ({ ...s, sum: s.seconds + s.clock }))
    .sort((a, b) => a.sum - b.sum);
  const groups: (typeof sums)[] = [];
  for (const s of sums) {
    const group = groups.at(-1);
    if (group && s.sum - group[0].sum <= tolerance) group.push(s);
    else groups.push([s]);
  }
  return groups
    .filter((g) => g.length >= minimum)
    .map((g) => ({
      anchor: Math.round(median(g.map((s) => s.sum)) * 10) / 10,
      samples: g.length,
      low: Math.min(...g.map((s) => s.clock)),
      high: Math.max(...g.map((s) => s.clock)),
      action: g.some((s) => s.clock > PREP_SECONDS),
    }))
    .sort((a, b) => b.samples - a.samples);
}

/**
 * The anchor for kills in the action phase: the largest group with a reading above 0:45. Without
 * one, only the largest group remains; whether it is preparation or round end stays open.
 */
export function actionAnchor(anchors: readonly ClockAnchor[]) {
  return anchors.find((a) => a.action) ?? anchors[0];
}

/** Clip second of a replay event with the round clock `clock`. */
export function clipSecond(anchor: ClockAnchor, clock: number) {
  return Math.round((anchor.anchor - clock) * 10) / 10;
}

/**
 * Reads the round clock of a clip: two frames per second, only the top-centre region. It stops
 * once `enough` readings agree on the action phase anchor; one region costs a CPU core about
 * 70 ms. rawFrames reports the middle of the sampling interval, while the frame itself comes from
 * the start of the interval.
 */
export async function readClock(
  media: MediaProcessor,
  reader: Pick<TextReader, 'read'>,
  path: string,
  options: { fps?: number; width?: number; enough?: number; signal?: AbortSignal } = {},
): Promise<ClockSample[]> {
  const fps = options.fps ?? 2;
  const enough = options.enough ?? 10;
  const samples: ClockSample[] = [];
  for await (const { seconds, frame } of media.rawFrames(path, {
    fps,
    width: options.width ?? 1280,
    signal: options.signal,
  })) {
    const area = crop(frame, {
      x: frame.width * CLOCK_AREA.x,
      y: frame.height * CLOCK_AREA.y,
      w: frame.width * CLOCK_AREA.w,
      h: frame.height * CLOCK_AREA.h,
    });
    const clock = clockIn(await reader.read(area), area.width);
    if (clock === undefined) continue;
    samples.push({ seconds: Math.max(0, seconds - 0.5 / fps), clock });
    if (clockAnchors(samples).some((a) => a.action && a.samples >= enough)) break;
  }
  return samples;
}
