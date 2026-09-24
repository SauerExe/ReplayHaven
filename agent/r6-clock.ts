import { crop } from './ocr';
import type { TextLine, TextReader } from './ocr';
import type { MediaProcessor } from '../server/media';

/**
 * Zeitanker für die R6-Replays (docs/R6-REPLAYS.md): Kills im Replay tragen die Rundenuhr aus
 * dem HUD, keine Uhrzeit. Liest die Texterkennung dieselbe Uhr im Clip, gilt innerhalb einer
 * Phase Clipsekunde + Uhr = fest, und jeder Kill lässt sich auf eine Clipsekunde umrechnen.
 * Wo das HUD die Uhr genau zeigt, ist an echten Clips noch nicht vermessen; der Ausschnitt oben
 * in der Mitte ist deshalb großzügig.
 */

/** Ausschnitt oben in der Mitte, als Anteil von Breite und Höhe des Bildes. */
export const CLOCK_AREA = { x: 0.35, y: 0, w: 0.3, h: 0.12 };
/** Die Vorbereitung zählt von 0:45 herunter; ein höherer Wert gehört sicher zur Aktionsphase. */
const PREP_SECONDS = 45;

/** Die Rundenuhr in einer gelesenen Zeile, "2:47" oder "2.47", in Sekunden. */
export function clockValue(text: string): number | undefined {
  const match = /(?<![\d:.])([0-4])\s?[:.]\s?([0-5]\d)(?![\d:.])/.exec(text);
  return match ? Number(match[1]) * 60 + Number(match[2]) : undefined;
}

/** Die Uhr in einem Ausschnitt: die sicher gelesene Zeile, die der Mitte am nächsten liegt. */
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
  /** Zeitpunkt des Bildes im Clip, in Sekunden. */
  seconds: number;
  clock: number;
}

export interface ClockAnchor {
  /** Clipsekunde + Uhr, fest innerhalb einer Phase. */
  anchor: number;
  /** Zahl der übereinstimmenden Lesungen. */
  samples: number;
  /** Kleinste und größte gelesene Uhr der Phase. */
  low: number;
  high: number;
  /** Eine Lesung über 0:45: sicher die Aktionsphase, nicht die Vorbereitung. */
  action: boolean;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Bündelt die Lesungen nach Clipsekunde + Uhr. Ein Bündel braucht mindestens `minimum`
 * Lesungen, die höchstens `tolerance` Sekunden auseinanderliegen; Fehllesungen fallen so
 * heraus. Mehrere Bündel entstehen an Phasenwechseln (Vorbereitung, Aktionsphase, Entschärfer).
 * Das größte Bündel steht vorn.
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
 * Der Anker für die Kills der Aktionsphase: das größte Bündel mit einer Lesung über 0:45. Ohne
 * ein solches bleibt nur das größte Bündel; ob es Vorbereitung oder Rundenende ist, ist offen.
 */
export function actionAnchor(anchors: readonly ClockAnchor[]) {
  return anchors.find((a) => a.action) ?? anchors[0];
}

/** Clipsekunde eines Replay-Ereignisses mit der Rundenuhr `clock`. */
export function clipSecond(anchor: ClockAnchor, clock: number) {
  return Math.round((anchor.anchor - clock) * 10) / 10;
}

/**
 * Liest die Rundenuhr eines Clips: zwei Bilder je Sekunde, nur der Ausschnitt oben in der Mitte.
 * Sobald `enough` Lesungen die Aktionsphase übereinstimmend verankern, hört es auf; ein
 * Ausschnitt kostet einen CPU-Kern etwa 70 ms. rawFrames nennt die Mitte des Abtastintervalls,
 * das Bild selbst stammt vom Intervallbeginn.
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
