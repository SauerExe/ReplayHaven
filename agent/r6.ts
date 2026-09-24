import { Worker } from 'node:worker_threads';
import type { MessagePort } from 'node:worker_threads';
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

  private load() {
    // Scheitert das Laden (Datei gesperrt, Speicher knapp), versucht es der nächste Clip erneut.
    this.reader ??= TextReader.load(
      this.options.models,
      this.options.threads,
      this.options.runtime,
    ).catch((error) => {
      this.reader = undefined;
      throw error;
    });
    return this.reader;
  }

  /** Lädt die Modelle, falls nötig, und liest ein leeres Probebild. Wirft, wenn das scheitert. */
  async check() {
    const reader = await this.load();
    await reader.read({ width: 64, height: 32, data: new Uint8Array(64 * 32 * 3) });
  }

  /** Gibt die Modelle frei; der nächste Clip lädt sie neu. */
  async close() {
    const reader = this.reader;
    this.reader = undefined;
    await (await reader?.catch(() => undefined))?.close();
  }

  async forClip(path: string, game: string, signal?: AbortSignal): Promise<TextLookup | undefined> {
    if (!isR6(game)) return undefined;
    const started = Date.now();
    const reader = await this.load();
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

/** Was der Worker der Texterkennung zum Start braucht (siehe agent/r6-worker.ts). */
export interface TextsWorkerData {
  models: OcrModels;
  runtime?: string;
  ffmpeg: string;
  ffprobe: string;
  threads?: number;
}

type TextsRequest =
  | { id: number; type: 'clip'; path: string; game: string }
  | { id: number; type: 'check' }
  | { id: number; type: 'abort' };
interface TextsReply {
  id: number;
  value?: unknown;
  error?: { message: string; code?: string };
}

/** Beantwortet im Worker die Anfragen von WorkerTexts; ein Abbruch betrifft nur seine Anfrage. */
export function serveTexts(port: MessagePort, texts: Pick<ClipTexts, 'forClip' | 'check'>) {
  const running = new Map<number, AbortController>();
  port.on('message', (request: TextsRequest) => {
    if (request.type === 'abort') return void running.get(request.id)?.abort();
    const control = new AbortController();
    running.set(request.id, control);
    const work =
      request.type === 'check'
        ? texts.check()
        : texts.forClip(request.path, request.game, control.signal);
    void work
      .then(
        (value) => port.postMessage({ id: request.id, value } satisfies TextsReply),
        (error: unknown) => {
          const code = (error as NodeJS.ErrnoException | undefined)?.code;
          port.postMessage({
            id: request.id,
            error: {
              message: error instanceof Error ? error.message : String(error),
              ...(typeof code === 'string' ? { code } : {}),
            },
          } satisfies TextsReply);
        },
      )
      .finally(() => running.delete(request.id));
  });
}

/**
 * Die Texterkennung in einem eigenen Thread. ONNX Runtime rechnet synchron; im Hauptprozess des
 * Clients hielt jedes Bild Fenster, Tray und Pause-Knopf bis zu 200 ms an, eine Minute lang je
 * R6-Clip. Der Worker lädt die Modelle einmal und behält sie über Starts hinweg.
 */
export class WorkerTexts {
  private worker?: Worker;
  private next = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  constructor(private readonly options: { script: string; data: TextsWorkerData }) {}

  forClip(path: string, game: string, signal?: AbortSignal) {
    if (!isR6(game)) return Promise.resolve(undefined);
    return this.request({ type: 'clip', path, game }, signal) as Promise<TextLookup | undefined>;
  }

  /** Lädt die Texterkennung zur Probe. Nichts heißt bereit, sonst der Fehler beim Laden. */
  async problem() {
    try {
      await this.request({ type: 'check' });
      return undefined;
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  }

  async close() {
    const worker = this.worker;
    this.worker = undefined;
    this.fail(new Error('Texterkennung beendet.'));
    await worker?.terminate();
  }

  private start() {
    if (this.worker) return this.worker;
    const worker = new Worker(this.options.script, { workerData: this.options.data });
    // Der Client beendet sich, ohne auf den Worker zu warten.
    worker.unref();
    worker.on('message', (reply: TextsReply) => {
      const waiting = this.pending.get(reply.id);
      if (!waiting) return;
      this.pending.delete(reply.id);
      if (reply.error)
        waiting.reject(
          Object.assign(
            new Error(reply.error.message),
            reply.error.code ? { code: reply.error.code } : {},
          ),
        );
      else waiting.resolve(reply.value);
    });
    // Stirbt der Worker, scheitern die offenen Anfragen; die nächste startet einen neuen.
    const lost = (error: Error) => {
      if (this.worker !== worker) return;
      this.worker = undefined;
      this.fail(error);
    };
    worker.on('error', lost);
    worker.on('exit', (code) =>
      lost(new Error(`Texterkennung unerwartet beendet (Code ${code}).`)),
    );
    this.worker = worker;
    return worker;
  }

  private fail(error: Error) {
    for (const waiting of this.pending.values()) waiting.reject(error);
    this.pending.clear();
  }

  private request(message: DistributiveOmit<TextsRequest, 'id'>, signal?: AbortSignal) {
    const worker = this.start();
    const id = this.next++;
    const abort = () => worker.postMessage({ id, type: 'abort' } satisfies TextsRequest);
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ ...message, id });
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
    }).finally(() => signal?.removeEventListener('abort', abort));
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
