import { Worker } from 'node:worker_threads';
import type { MessagePort } from 'node:worker_threads';
import { collectEvents } from './events';
import type { EventKind, GameEvent } from './events';
import { crop, joinRows, TextReader } from './ocr';
import type { OcrModels, TextLine } from './ocr';
import { sameGame } from './players';
import { feedEvents, isValorant, KILLFEED, sameName } from './valorant';
import type { FeedFrame } from './valorant';
import type { MediaProcessor } from '../server/media';

/**
 * Map name and round result in Rainbow Six Siege, from text recognition (agent/ocr.ts). In a
 * blind test on 26 fresh clips, neither was ever wrong. Kills are deliberately not read here:
 * six blind tests could not reliably settle who caused a killfeed line and whether it belongs
 * to the clip.
 */

/** Maps of Siege X (as of 2026); unknown maps are simply not recognised. */
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

/** Upper case without punctuation; typical text recognition mix-ups become letters. */
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
 * The map in a read line. It must be the whole line or stand at the start, followed by place
 * and country ("OREGON, USA"), so a room name like "Tower Stairs" does not become a map.
 */
export function mapIn(text: string): string | undefined {
  // PP-OCRv5 reads banners without spaces ("NIGHTHAVENLABS", "KAFEDOSTOYEVSKI"), so the
  // comparison ignores them, and long names may differ by one character.
  // On its own, only upper case counts, as on the scoreboard and loading screen: "Tower" is a
  // room in the location display on Skyscraper (2026-09-25, 235 frames "Tower" vs 21 "SKYSCRAPER").
  const line = letters(text).replace(/ /g, '');
  const capitals = !/\p{Ll}/u.test(text);
  const raw = text.trim().toUpperCase();
  return R6_MAPS.find((map) => {
    const name = map.toUpperCase();
    const compact = name.replace(/ /g, '');
    return (
      (capitals && line === compact) ||
      (capitals && compact.length >= 10 && oneApart(line, compact)) ||
      (raw.startsWith(name) && /^[,\-–|:]/.test(raw.slice(name.length).trim()))
    );
  });
}

/** Whether two words differ by at most one character (replaced, missing or extra). */
function oneApart(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return (
    a.slice(i + 1) === b.slice(i + 1) ||
    a.slice(i) === b.slice(i + 1) ||
    a.slice(i + 1) === b.slice(i)
  );
}

/** Words of the R6 banners, used to split lines that were read without spaces. */
const BANNER_WORDS = new Set([
  'YOUR',
  'TEAM',
  'ENEMY',
  'ENEMIES',
  'OPPONENT',
  'OPPONENTS',
  'WE',
  'WON',
  'WIN',
  'WINS',
  'LOST',
  'LOSE',
  'LOSES',
  'ROUND',
  'THE',
  'MATCH',
  'VICTORY',
  'DEFEAT',
  'ELIMINATED',
  'BY',
  'DEFUSER',
  'DEFUSED',
  'PLANTED',
  'DISABLED',
  'FAILED',
  'TO',
  'PROTECT',
  'FOUND',
  'BOMB',
  'BOMBS',
  'HOSTAGE',
  'EXTRACTED',
  'SECURED',
  'AREA',
  'TIME',
  'RAN',
  'OUT',
]);

/**
 * Splits a banner line read without spaces into its words ("WONROUND2" → "WON ROUND 2") so the
 * patterns from agent/events.ts match. Other lines stay as they are.
 */
export function respace(text: string) {
  return text.replace(/\b([A-Z]{5,})(\d*)\b/g, (whole, word: string, digits: string) => {
    // Shortest split from back to front; best[i] = words for word.slice(i).
    const best: (string[] | undefined)[] = [];
    best[word.length] = [];
    for (let i = word.length - 1; i >= 0; i--)
      for (let j = i + 2; j <= word.length; j++) {
        const rest = best[j];
        if (
          rest &&
          BANNER_WORDS.has(word.slice(i, j)) &&
          (!best[i] || rest.length + 1 < best[i]!.length)
        )
          best[i] = [word.slice(i, j), ...rest];
      }
    const words = best[0];
    return words && words.length > 1 ? [...words, ...(digits ? [digits] : [])].join(' ') : whole;
  });
}

/**
 * The round banner of a frame, even when read in pieces and with misreads ("YOURTEAA" |
 * "WONROUND2" | "ENEMIESELIMINATED", R6 clip from 2024-12-07): as a sentence agent/events.ts
 * knows, or empty. The winner stands before "WON ROUND"; if that is missing, the subtitle
 * "ENEMIES ELIMINATED" says your team took the round.
 */
export function bannerResult(rows: readonly TextLine[]) {
  const line = rows.map((r) => letters(r.text).replace(/ /g, '')).join('');
  const at = line.indexOf('WONROUND');
  if (at < 0) return '';
  const before = line.slice(0, at);
  if (oneApart(before.slice(-8), 'YOURTEAM')) return 'YOUR TEAM WON ROUND';
  if (oneApart(before.slice(-9), 'ENEMYTEAM') || before.endsWith('OPPONENTS'))
    return 'ENEMY TEAM WON ROUND';
  return line.includes('ENEMIESELIMINATED') ? 'YOUR TEAM WON ROUND' : '';
}

/** Round and match results; text recognition reads only these events. */
const RESULTS: EventKind[] = ['roundWon', 'roundLost', 'matchWon', 'matchLost'];

export interface FrameText {
  seconds: number;
  rows: TextLine[];
}

export interface TextFindings {
  /** The map, if it was read confidently in at least two frames and is unambiguous. */
  map?: string;
  events: GameEvent[];
}

/** Evaluates the read lines of a clip. */
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
    visibleText: [...f.rows.map((r) => respace(r.text)), bannerResult(f.rows)]
      .filter(Boolean)
      .join(' | '),
  }));
  // No file name: NVIDIA events are not the business of text recognition.
  const events = collectEvents(seen, 'ocr', game)
    .filter((e) => RESULTS.includes(e.kind) && e.source === 'screen')
    .map((e): GameEvent => {
      const read: GameEvent = { ...e, source: 'ocr' };
      // Text recognition is certain on its own; the single-frame mark is for the model's reading.
      delete read.once;
      return read;
    });
  return { ...(map ? { map } : {}), events };
}

export interface TextTrace {
  frames: number;
  /** Computing time of text recognition in seconds. */
  seconds: number;
  map?: string;
  events: number;
  error?: string;
}

export interface TextLookup extends TextFindings {
  /** The killfeed was read; its kills and deaths replace those the model read. */
  feed?: boolean;
  trace: TextTrace;
}

/**
 * The player's names as the Valorant killfeed shows them: without the Riot tag ("Player#EUW"
 * appears as "Player"). Empty names are dropped.
 */
export function feedNames(names: readonly string[]) {
  return names.map((n) => n.replace(/\s*#.*$/, '').trim()).filter(Boolean);
}

/**
 * Whether the killfeed was really read: at least one frame, and one of the player's names in
 * some line. Otherwise the feed proves nothing, and the kills and deaths the model read stay.
 */
export function feedRead(frames: readonly FeedFrame[], names: readonly string[]) {
  return frames.some((f) => f.lines.some((l) => names.some((n) => sameName(l.text, n))));
}

/**
 * Reads the texts of an R6 clip: two frames per second at 1280 pixels wide, as in the blind
 * test. The models load with the first clip and stay loaded.
 */
export class ClipTexts {
  private reader?: Promise<TextReader>;
  constructor(
    readonly options: {
      media: MediaProcessor;
      models: OcrModels;
      /** Folder with onnxruntime-node in the packaged client; otherwise from node_modules. */
      runtime?: string;
      fps?: number;
      width?: number;
      threads?: number;
    },
  ) {}

  private load() {
    // If loading fails (file locked, low memory), the next clip tries again.
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

  /** Loads the models if needed and reads a blank test image. Throws if that fails. */
  async check() {
    const reader = await this.load();
    await reader.read({ width: 64, height: 32, data: new Uint8Array(64 * 32 * 3) });
  }

  /** Releases the models; the next clip loads them again. */
  async close() {
    const reader = this.reader;
    this.reader = undefined;
    await (await reader?.catch(() => undefined))?.close();
  }

  async forClip(
    path: string,
    game: string,
    signal?: AbortSignal,
    names: readonly string[] = [],
  ): Promise<TextLookup | undefined> {
    if (isValorant(game)) return this.valorant(path, signal, names);
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
    // As with Valorant: an aborted read proves nothing.
    if (signal?.aborted) return undefined;
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

  /**
   * Valorant: only the killfeed region, two frames per second. Without the player's own names
   * no line can be attributed; then the messages the model reads stay as they are.
   */
  private async valorant(
    path: string,
    signal: AbortSignal | undefined,
    riotIds: readonly string[],
  ): Promise<TextLookup | undefined> {
    const names = feedNames(riotIds);
    if (!names.length) return undefined;
    const started = Date.now();
    const reader = await this.load();
    const frames: FeedFrame[] = [];
    for await (const { seconds, frame } of this.options.media.rawFrames(path, {
      fps: this.options.fps ?? 2,
      width: this.options.width ?? 1280,
      signal,
    })) {
      if (signal?.aborted) break;
      const region = {
        x: frame.width * KILLFEED.x,
        y: frame.height * KILLFEED.y,
        w: frame.width * KILLFEED.w,
        h: frame.height * KILLFEED.h,
      };
      frames.push({ seconds, lines: await reader.read(crop(frame, region)) });
    }
    // An aborted read proves nothing; half a killfeed must not replace the messages.
    if (signal?.aborted) return undefined;
    const events = feedEvents(frames, names);
    return {
      events,
      feed: feedRead(frames, names),
      trace: {
        frames: frames.length,
        seconds: Math.round((Date.now() - started) / 100) / 10,
        events: events.length,
      },
    };
  }
}

/** What the text recognition worker needs to start (see agent/r6-worker.ts). */
export interface TextsWorkerData {
  models: OcrModels;
  runtime?: string;
  ffmpeg: string;
  ffprobe: string;
  threads?: number;
}

type TextsRequest =
  | { id: number; type: 'clip'; path: string; game: string; names?: string[] }
  | { id: number; type: 'check' }
  | { id: number; type: 'abort' };
interface TextsReply {
  id: number;
  value?: unknown;
  error?: { message: string; code?: string };
}

/** Answers WorkerTexts requests inside the worker; an abort affects only its own request. */
export function serveTexts(port: MessagePort, texts: Pick<ClipTexts, 'forClip' | 'check'>) {
  const running = new Map<number, AbortController>();
  port.on('message', (request: TextsRequest) => {
    if (request.type === 'abort') return void running.get(request.id)?.abort();
    const control = new AbortController();
    running.set(request.id, control);
    const work =
      request.type === 'check'
        ? texts.check()
        : texts.forClip(request.path, request.game, control.signal, request.names);
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
 * Text recognition in its own thread. ONNX Runtime computes synchronously; in the client's main
 * process each frame froze the window, tray and pause button for up to 200 ms, for a minute per
 * R6 clip. The worker loads the models once and keeps them across runs.
 */
export class WorkerTexts {
  private worker?: Worker;
  private next = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private readonly inflight = new Set<Promise<unknown>>();
  constructor(private readonly options: { script: string; data: TextsWorkerData }) {}

  forClip(path: string, game: string, signal?: AbortSignal, names: readonly string[] = []) {
    if (!isR6(game) && !(isValorant(game) && names.length)) return Promise.resolve(undefined);
    return this.request({ type: 'clip', path, game, names: [...names] }, signal) as Promise<
      TextLookup | undefined
    >;
  }

  /** Test-loads text recognition. Nothing means ready; otherwise the loading error. */
  async problem() {
    try {
      await this.request({ type: 'check' });
      return undefined;
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  }

  /**
   * Stops the worker. Terminated mid-computation, ONNX Runtime takes the whole process down
   * (SIGABRT). So close() first aborts all requests and waits for their answers: one frame or
   * the model load, at most `wait` milliseconds.
   */
  async close(wait = 10000) {
    const worker = this.worker;
    this.worker = undefined;
    if (!worker) return;
    for (const id of this.pending.keys())
      worker.postMessage({ id, type: 'abort' } satisfies TextsRequest);
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.allSettled([...this.inflight]),
      new Promise((done) => (timer = setTimeout(done, wait))),
    ]);
    clearTimeout(timer);
    this.fail(new Error('Text recognition stopped.'));
    await worker.terminate();
  }

  private start() {
    if (this.worker) return this.worker;
    const worker = new Worker(this.options.script, { workerData: this.options.data });
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
    // If the worker dies, open requests fail; the next one starts a new worker.
    const lost = (error: Error) => {
      if (this.worker !== worker) return;
      this.worker = undefined;
      this.fail(error);
    };
    worker.on('error', lost);
    worker.on('exit', (code) =>
      lost(new Error(`Text recognition exited unexpectedly (code ${code}).`)),
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
    const answer = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ ...message, id });
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
    });
    this.inflight.add(answer);
    return answer.finally(() => {
      this.inflight.delete(answer);
      signal?.removeEventListener('abort', abort);
    });
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
