import { collectEvents } from './events';
import type { EventKind, GameEvent } from './events';
import { joinRows, TextReader } from './ocr';
import type { OcrModels, TextLine } from './ocr';
import { sameGame } from './players';
import type { MediaProcessor } from '../server/media';

/**
 * Kartenname und Rundenausgang in Rainbow Six Siege, aus Texterkennung (agent/ocr.ts). Im
 * Blindtest an 26 frischen Clips waren beide nie falsch. Kills dagegen werden hier bewusst nicht
 * gelesen: Wer eine Killfeed-Zeile verursacht hat und ob sie zum Clip gehört, ließ sich in sechs
 * Blindtests nicht verlässlich klären.
 */

/** Karten von Siege X (Stand 2026); unbekannte Karten werden schlicht nicht erkannt. */
export const R6_MAPS = [
  'Bank',
  'Border',
  'Chalet',
  'Clubhouse',
  'Coastline',
  'Consulate',
  'District',
  'Emerald Plains',
  'Favela',
  'Fortress',
  'Hereford Base',
  'House',
  'Kafe Dostoyevsky',
  'Kanal',
  'Lair',
  'Nighthaven Labs',
  'Oregon',
  'Outback',
  'Presidential Plane',
  'Skyscraper',
  'Stadium Alpha',
  'Stadium Bravo',
  'Theme Park',
  'Tower',
  'Villa',
  'Yacht',
] as const;

export function isR6(game: string) {
  return sameGame('Rainbow Six', game);
}

/** Großbuchstaben ohne Satzzeichen; typische Verwechslungen der Texterkennung werden Buchstaben. */
function letters(text: string) {
  return text
    .toUpperCase()
    .replace(/0/g, 'O')
    .replace(/1/g, 'I')
    .replace(/5/g, 'S')
    .replace(/[^A-ZÄÖÜ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Die Karte einer gelesenen Zeile. Sie muss die ganze Zeile sein oder vorne stehen, gefolgt von
 * Ort und Land ("OREGON, USA") — so wird ein Raumname wie "Tower Stairs" nicht zur Karte.
 */
export function mapIn(text: string): string | undefined {
  const line = letters(text);
  const raw = text.trim().toUpperCase();
  return R6_MAPS.find((map) => {
    const name = map.toUpperCase();
    return (
      line === name || (raw.startsWith(name) && /^[,\-–|:]/.test(raw.slice(name.length).trim()))
    );
  });
}

/** Rundenausgänge und Matchergebnisse; nur diese Ereignisse liest die Texterkennung. */
const RESULTS: EventKind[] = ['roundWon', 'roundLost', 'matchWon', 'matchLost'];

export interface FrameText {
  seconds: number;
  rows: TextLine[];
}

export interface TextFindings {
  /** Die Karte, wenn sie in mindestens zwei Bildern sicher gelesen wurde und eindeutig ist. */
  map?: string;
  events: GameEvent[];
}

/** Wertet die gelesenen Zeilen eines Clips aus. */
export function r6Findings(frames: FrameText[], game: string): TextFindings {
  const maps = new Map<string, number>();
  for (const f of frames)
    for (const map of new Set(f.rows.filter((r) => r.score >= 0.85).map((r) => mapIn(r.text))))
      if (map) maps.set(map, (maps.get(map) ?? 0) + 1);
  const ranked = [...maps.entries()].sort((a, b) => b[1] - a[1]);
  const map =
    ranked[0] && ranked[0][1] >= 2 && (!ranked[1] || ranked[1][1] < ranked[0][1])
      ? ranked[0][0]
      : undefined;
  const seen = frames.map((f) => ({
    seconds: f.seconds,
    kind: 'gameplay' as const,
    visibleText: f.rows.map((r) => r.text).join(' | '),
  }));
  // Ohne Dateinamen: NVIDIA-Ereignisse sind nicht Sache der Texterkennung.
  const events = collectEvents(seen, 'ocr', game)
    .filter((e) => RESULTS.includes(e.kind) && e.source === 'screen')
    .map((e): GameEvent => ({ ...e, source: 'ocr' }));
  return { ...(map ? { map } : {}), events };
}

export interface TextTrace {
  frames: number;
  /** Rechenzeit der Texterkennung in Sekunden. */
  seconds: number;
  map?: string;
  events: number;
  error?: string;
}

export interface TextLookup extends TextFindings {
  trace: TextTrace;
}

/**
 * Liest die Texte eines R6-Clips: zwei Bilder je Sekunde in 1280 Pixeln Breite, wie im
 * Blindtest. Die Modelle werden beim ersten Clip geladen und bleiben geladen.
 */
export class ClipTexts {
  private reader?: Promise<TextReader>;
  constructor(
    readonly options: {
      media: MediaProcessor;
      models: OcrModels;
      /** Ordner mit onnxruntime-node im fertigen Client; sonst aus node_modules. */
      runtime?: string;
      fps?: number;
      width?: number;
      threads?: number;
    },
  ) {}

  async forClip(path: string, game: string, signal?: AbortSignal): Promise<TextLookup | undefined> {
    if (!isR6(game)) return undefined;
    const started = Date.now();
    this.reader ??= TextReader.load(
      this.options.models,
      this.options.threads,
      this.options.runtime,
    );
    const reader = await this.reader;
    const frames: FrameText[] = [];
    for await (const { seconds, frame } of this.options.media.rawFrames(path, {
      fps: this.options.fps ?? 2,
      width: this.options.width ?? 1280,
      signal,
    })) {
      if (signal?.aborted) break;
      frames.push({ seconds, rows: joinRows(await reader.read(frame)) });
    }
    const findings = r6Findings(frames, game);
    return {
      ...findings,
      trace: {
        frames: frames.length,
        seconds: Math.round((Date.now() - started) / 100) / 10,
        ...(findings.map ? { map: findings.map } : {}),
        events: findings.events.length,
      },
    };
  }
}
