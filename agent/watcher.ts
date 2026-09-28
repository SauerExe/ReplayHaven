import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, openAsBlob } from 'node:fs';
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { hostname } from 'node:os';
import type { AnalysisResult } from '../server/schema';
export interface ClientAnalysis {
  result: AnalysisResult;
  duration: number;
  model: string;
}
/** A recording not yet in the archive, as the client window shows it. */
export interface QueueEntry {
  path: string;
  name: string;
  game: string;
  size: number;
  savedAt: number;
  /** settling: still being written; retry: new attempt after an error; deferred: waits on purpose. */
  state: 'waiting' | 'settling' | 'retry' | 'deferred';
  note?: string;
}
/** The recording currently being worked on. */
export interface ActiveClip extends Omit<QueueEntry, 'state' | 'note'> {
  stage: 'analyzing' | 'uploading';
  since: number;
}
/** A recently archived recording with the title the AI gave it. */
export interface ArchivedClip {
  name: string;
  game: string;
  title?: string;
  tags?: string[];
  clipId: string;
  at: number;
  /** Time spent on analysis and upload. */
  seconds: number;
}
export interface WatchOptions {
  folder: string;
  server: string;
  token: string;
  statePath: string;
  game: string;
  includeExisting: boolean;
  stableMs: number;
  probe?: (path: string) => Promise<unknown>;
  analyze?: (path: string, game: string) => Promise<ClientAnalysis>;
  isPaused?: () => boolean;
  onStatus?: (message: string) => void;
  onQueued?: (count: number) => void;
  /** On every change to the queue or the current recording. */
  onQueue?: (queue: QueueEntry[], active: ActiveClip | undefined) => void;
  /**
   * The game of a clip the NVIDIA App filed without one ("Desktop", "Base Profile"), for example
   * from the window in front when it was saved (agent/gaming.ts). Empty: folder name.
   */
  gameFor?: (path: string, savedAt: number) => string | undefined;
  /** After every confirmed upload, for example to keep the R6 match for the clip. */
  onUploaded?: (path: string, game: string, savedAt: number) => void;
  /** Ask the server by content before analysing (default true); see archived(). */
  lookup?: boolean;
  signal?: AbortSignal;
}
/** Folders where the NVIDIA App files recordings without a detected game. */
const NO_GAME_FOLDERS = /^(?:desktop|base profile)$/i;
/**
 * The recording should be processed later without anything having gone wrong — for example
 * because its Fortnite match is still running and the replay is only final afterwards.
 */
export class DeferredError extends Error {}
type Receipt = { fingerprint: string; clipId?: string };
type AgentState = {
  id: string;
  /** The recording folder of this queue, to carry it over after a change of server address. */
  folder?: string;
  receipts: Record<string, Receipt>;
  uploaded: number;
  /** The latest uploads, newest first, at most 30. */
  recent?: ArchivedClip[];
};
export async function listVideos(folder: string): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) output.push(...(await listVideos(path)));
    else if (entry.isFile() && /\.(mp4|m4v|mov|webm|mkv)$/i.test(entry.name)) output.push(path);
  }
  return output;
}
/**
 * Game name for the library: the configured name, otherwise the folder name. The AI's guess is
 * deliberately no longer a source. In the run over the real collection on 2026-09-22 it was
 * wrong in every single case and returned "Sieg", "Kettenverbunden", "Multiplayer", "Steam",
 * "Runde 3/5 Abstimmungsergebnisse" and even the tag "Kein Ereignis" as game names.
 * Recordings from NVIDIA's catch-all profiles are therefore called "Desktop" — not pretty, but
 * honest and changed with one click in the archive.
 *
 * Repeated spaces are collapsed: NVIDIA creates folders like "Call of Duty  Black Ops 7",
 * which would otherwise show up as a separate game next to the normal spelling.
 */
export function gameLabel(configured: string, path: string) {
  const name = configured.trim() || basename(dirname(path));
  return name.replace(/\s+/g, ' ').trim();
}
/**
 * The games of existing recordings, named the way the analysis sees them: after the clip's
 * folder. The client suggests them for player names so the entry matches the folder.
 */
export async function recordedGames(folder: string): Promise<string[]> {
  const games = new Set((await listVideos(folder)).map((path) => gameLabel('', path)));
  return [...games].filter(Boolean).sort((a, b) => a.localeCompare(b, 'de'));
}
/**
 * Whether reading a recording failed for a passing reason: locked by the recorder or a virus
 * scanner, not accessible right now, or a probe that ran out of time. A broken or unsupported video
 * is not; it is skipped for good.
 */
export function transientFileError(error: unknown) {
  const codes = ['EBUSY', 'EPERM', 'EACCES', 'EAGAIN', 'EMFILE', 'ENFILE', 'ETIMEDOUT'];
  const { code, detail } = (error ?? {}) as { code?: unknown; detail?: unknown };
  if (typeof code === 'string' && codes.includes(code)) return true;
  const text = `${error instanceof Error ? error.message : String(error)}\n${String(detail ?? '')}`;
  return /time limit|timed? ?out|permission denied|resource busy|being used by another process|EBUSY|EPERM|EACCES/i.test(
    text,
  );
}
function errorReason(error: unknown) {
  const code = (error as { code?: unknown } | undefined)?.code;
  if (typeof code === 'string') return code;
  return error instanceof Error ? error.message.replace(/\.$/, '') : String(error);
}
export class FolderUploader {
  /** How often an upload checks whether a game has started. */
  static pausePollMs = 1000;
  state: AgentState = { id: randomUUID(), receipts: {}, uploaded: 0 };
  private observed = new Map<string, { fingerprint: string; since: number }>();
  private retryAt = new Map<string, number>();
  /** Failed attempts per recording; the wait before the next one doubles, up to 30 minutes. */
  private attempts = new Map<string, number>();
  /** Content hashes per path and fingerprint, so a retry does not read 2 GB again. */
  private hashes = new Map<string, string>();
  /** Permanently rejected recordings with reason — per fingerprint, so a replacement counts again. */
  readonly rejected = new Map<string, { fingerprint: string; reason: string }>();
  error = '';
  queue: QueueEntry[] = [];
  active: ActiveClip | undefined;
  private notes = new Map<string, { state: 'retry' | 'deferred'; note: string }>();
  constructor(readonly options: WatchOptions) {}
  get recent() {
    return this.state.recent ?? [];
  }
  private emitQueue() {
    this.options.onQueue?.(
      this.queue.filter((e) => e.path !== this.active?.path),
      this.active,
    );
  }
  private entry(path: string, before: Stats, now: number): QueueEntry {
    const fingerprint = `${before.size}:${before.mtimeMs}`;
    const observed = this.observed.get(path);
    const note = (this.retryAt.get(path) || 0) > now ? this.notes.get(path) : undefined;
    const settling =
      !observed ||
      observed.fingerprint !== fingerprint ||
      now - observed.since < this.options.stableMs;
    return {
      path,
      name: basename(path),
      game: gameLabel(this.options.game, path),
      size: before.size,
      savedAt: before.mtimeMs,
      state: note?.state ?? (settling ? 'settling' : 'waiting'),
      ...(note ? { note: note.note } : {}),
    };
  }
  async initialize() {
    const folderStat = await stat(this.options.folder);
    if (!folderStat.isDirectory()) throw new Error('Recording folder not found.');
    let existing = false;
    try {
      const saved = JSON.parse(await readFile(this.options.statePath, 'utf8')) as AgentState;
      if (!saved || typeof saved !== 'object' || typeof saved.receipts !== 'object')
        throw new SyntaxError('No queue');
      this.state = saved;
      existing = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        if (!(error instanceof SyntaxError)) throw error;
        // A broken file would stop every start; it is kept next to the new one for a look.
        const aside = `${this.options.statePath}.${Date.now()}.corrupt`;
        await rename(this.options.statePath, aside);
        console.error(`Queue file corrupted, moved to ${aside}; starting a new one.`);
        this.options.onStatus?.('The queue file was damaged and has been replaced.');
      }
    }
    if (!existing) {
      this.state.folder = resolve(this.options.folder);
      if (!this.options.includeExisting) {
        // The queue is kept per folder and server address. After a change of address the queue
        // of the same folder decides what counts as done, so recordings still waiting there are
        // not marked as uploaded; only without one does everything present count as done.
        const previous = await this.previousReceipts();
        if (previous) this.state.receipts = previous;
        else
          for (const path of await listVideos(this.options.folder)) {
            const s = await stat(path);
            this.state.receipts[path] = { fingerprint: `${s.size}:${s.mtimeMs}` };
          }
      }
      await this.persist();
    } else if (!this.state.folder) {
      this.state.folder = resolve(this.options.folder);
    }
  }
  /**
   * The receipts of the newest other queue file for this folder, or undefined. Files from before
   * the folder was stored are recognised by their recordings lying in it.
   */
  private async previousReceipts() {
    const directory = dirname(this.options.statePath);
    const own = resolve(this.options.statePath);
    const folder = resolve(this.options.folder);
    const key = (path: string) => (process.platform === 'win32' ? path.toLowerCase() : path);
    const inside = (path: string) => key(resolve(path)).startsWith(key(folder + sep));
    let best: { at: number; receipts: Record<string, Receipt> } | undefined;
    const names = await readdir(directory).catch(() => [] as string[]);
    for (const name of names) {
      const path = join(directory, name);
      if (!name.endsWith('.json') || resolve(path) === own) continue;
      try {
        const saved = JSON.parse(await readFile(path, 'utf8')) as Partial<AgentState>;
        const receipts = saved.receipts;
        if (!receipts || typeof receipts !== 'object') continue;
        const same = saved.folder
          ? key(resolve(saved.folder)) === key(folder)
          : Object.keys(receipts).some(inside);
        if (!same) continue;
        const at = (await stat(path)).mtimeMs;
        if (!best || at > best.at) best = { at, receipts };
      } catch {
        // Unreadable or damaged: not a source.
      }
    }
    return best && { ...best.receipts };
  }
  async persist() {
    await mkdir(dirname(this.options.statePath), { recursive: true });
    const temp = `${this.options.statePath}.tmp`;
    await writeFile(temp, JSON.stringify(this.state, null, 2));
    await rename(temp, this.options.statePath);
  }
  /**
   * The id of the archive's clip with the same content as this recording (SHA-256 of the whole
   * file, as the server computes it on upload), or undefined. Older servers without the lookup
   * answer 404; then the recording is analysed and uploaded as before.
   */
  private async archived(path: string, fingerprint: string) {
    const key = `${path}:${fingerprint}`;
    let digest = this.hashes.get(key);
    if (!digest) {
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(path, { signal: this.options.signal }))
        hash.update(chunk as Buffer);
      digest = hash.digest('hex');
      this.hashes.set(key, digest);
    }
    const response = await fetch(`${this.options.server}/api/clips/lookup/${digest}`, {
      headers: this.headers(),
      signal: AbortSignal.any([
        AbortSignal.timeout(15000),
        ...(this.options.signal ? [this.options.signal] : []),
      ]),
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { clip?: { id: string } | null };
    return body.clip?.id;
  }
  headers() {
    return this.options.token
      ? { Authorization: `Bearer ${this.options.token}` }
      : { Authorization: '' };
  }
  async scan(now = Date.now()) {
    // `now` is the time of the scan's start; analysis and upload take minutes, so waits set
    // afterwards count from the time that has passed since, in whole seconds (tests pass their
    // own `now`).
    const clock = Date.now();
    const timeNow = () => now + Math.floor((Date.now() - clock) / 1000) * 1000;
    const files = await listVideos(this.options.folder);
    // Collect all pending recordings first, then work: this way the window shows the whole queue.
    const pending: { path: string; before: Stats }[] = [];
    for (const path of files) {
      const before = await stat(path);
      const fingerprint = `${before.size}:${before.mtimeMs}`;
      if (this.state.receipts[path]?.fingerprint === fingerprint || before.size === 0) continue;
      if (this.rejected.get(path)?.fingerprint === fingerprint) continue;
      pending.push({ path, before });
    }
    this.queue = pending.map(({ path, before }) => this.entry(path, before, now));
    this.emitQueue();
    let queued = pending.length;
    this.options.onQueued?.(queued);
    for (const { path, before } of pending) {
      const fingerprint = `${before.size}:${before.mtimeMs}`;
      // Even while paused (for example while gaming) we watch whether the file is fully written,
      // so work starts right away afterwards.
      const observed = this.observed.get(path);
      if (!observed || observed.fingerprint !== fingerprint) {
        this.observed.set(path, { fingerprint, since: now });
        continue;
      }
      if (this.options.isPaused?.() || this.options.signal?.aborted) continue;
      if (now - observed.since < this.options.stableMs || (this.retryAt.get(path) || 0) > timeNow())
        continue;
      const started = Date.now();
      // Aborts the upload when a game starts; the clip then simply waits, it did not fail.
      const pausedUpload = new AbortController();
      try {
        // Size, length and readability are properties of the file, not a temporary glitch.
        // Handling them separately here prevents an endless once-a-minute loop whose message
        // overwrites every real error. A file that is locked, not readable right now or a probe
        // that ran out of time is a glitch, though: that is retried with the usual backoff.
        try {
          if (before.size > 2 * 1024 ** 3) throw new Error('The recording is larger than 2 GB.');
          await (await open(path, 'r')).close();
          await this.options.probe?.(path);
        } catch (error) {
          if (transientFileError(error))
            throw new Error(
              `The recording cannot be read right now (${errorReason(error)}). Retrying later.`,
            );
          const reason = error instanceof Error ? error.message : 'Recording not usable.';
          this.rejected.set(path, { fingerprint, reason });
          this.observed.delete(path);
          this.queue = this.queue.filter((e) => e.path !== path);
          queued--;
          this.options.onStatus?.(`Skipped: ${basename(path)} — ${reason}`);
          continue;
        }
        const folder = this.options.game || basename(dirname(path));
        const game =
          (!this.options.game &&
            NO_GAME_FOLDERS.test(folder.trim()) &&
            this.options.gameFor?.(path, before.mtimeMs)) ||
          folder;
        const shown = game === folder ? gameLabel(this.options.game, path) : game;
        this.active = {
          path,
          name: basename(path),
          game: shown,
          size: before.size,
          savedAt: before.mtimeMs,
          stage: 'analyzing',
          since: started,
        };
        this.emitQueue();
        // Already in the archive with the same content, e.g. uploaded before under another
        // server address (the queue is kept per folder and address)? Then neither the AI nor the
        // upload runs again.
        const cachePath = join(
          dirname(this.options.statePath),
          'analysis-cache',
          `${createHash('sha256').update(`${path}:${fingerprint}`).digest('hex')}.json`,
        );
        const archived =
          this.options.lookup === false
            ? undefined
            : await this.archived(path, fingerprint).catch(() => undefined);
        if (archived) {
          // A previous attempt uploaded the video but not its AI result: deliver it now, or the
          // clip would wait for it forever. The server ignores a result it already has.
          const cached = this.options.analyze
            ? await readFile(cachePath, 'utf8').catch(() => undefined)
            : undefined;
          if (cached) {
            const saved = await fetch(
              `${this.options.server}/api/clips/${archived}/client-analysis`,
              {
                method: 'POST',
                headers: { ...this.headers(), 'Content-Type': 'application/json' },
                body: cached,
                signal: AbortSignal.timeout(15000),
              },
            );
            // 404: the clip was removed from the library in the meantime; 403: another PC
            // uploaded the same file and keeps its own result. Either way nothing to deliver.
            if (!saved.ok && saved.status !== 404 && saved.status !== 403)
              throw new Error('Video saved, AI result not confirmed yet. Retrying the transfer.');
            await rm(cachePath, { force: true });
          }
          this.state.receipts[path] = { fingerprint, clipId: archived };
          this.attempts.delete(path);
          await this.persist();
          this.observed.delete(path);
          this.retryAt.delete(path);
          this.notes.delete(path);
          this.queue = this.queue.filter((e) => e.path !== path);
          queued--;
          this.options.onQueued?.(queued);
          this.options.onStatus?.(`Already in the archive: ${basename(path)}`);
          continue;
        }
        let analysis: ClientAnalysis | undefined;
        if (this.options.analyze) {
          try {
            analysis = JSON.parse(await readFile(cachePath, 'utf8'));
          } catch {
            analysis = await this.options.analyze(path, game);
            await mkdir(dirname(cachePath), { recursive: true });
            await writeFile(cachePath, JSON.stringify(analysis));
          }
        }
        if (this.options.isPaused?.() || this.options.signal?.aborted) continue;
        const checked = await stat(path);
        if (`${checked.size}:${checked.mtimeMs}` !== fingerprint)
          throw new Error('The file changed and will be checked again.');
        this.options.onStatus?.(`Upload: ${basename(path)}`);
        this.active = { ...this.active, stage: 'uploading' };
        this.emitQueue();
        const form = new FormData();
        form.append(
          'file',
          await openAsBlob(path, { type: extname(path) === '.webm' ? 'video/webm' : 'video/mp4' }),
          basename(path),
        );
        const watchPause = setInterval(() => {
          if (this.options.isPaused?.()) pausedUpload.abort();
        }, FolderUploader.pausePollMs);
        let response: Response;
        try {
          response = await fetch(`${this.options.server}/api/clips`, {
            method: 'POST',
            headers: {
              ...this.headers(),
              'x-device-name': encodeURIComponent(hostname()),
              'x-game-name': encodeURIComponent(shown),
              'x-client-analysis': analysis ? '1' : '0',
              'x-recorded-at': new Date(before.mtimeMs).toISOString(),
            },
            body: form,
            signal: AbortSignal.any([
              AbortSignal.timeout(30 * 60000),
              pausedUpload.signal,
              ...(this.options.signal ? [this.options.signal] : []),
            ]),
          });
        } finally {
          clearInterval(watchPause);
        }
        if (!response.ok) throw new Error(`Upload failed (HTTP ${response.status}).`);
        const result = (await response.json()) as { clip: { id: string } };
        if (analysis) {
          const saved = await fetch(
            `${this.options.server}/api/clips/${result.clip.id}/client-analysis`,
            {
              method: 'POST',
              headers: { ...this.headers(), 'Content-Type': 'application/json' },
              body: JSON.stringify(analysis),
              signal: AbortSignal.timeout(15000),
            },
          );
          if (!saved.ok)
            throw new Error('Video saved, AI result not confirmed yet. Retrying the transfer.');
        }
        const after = await stat(path);
        if (`${after.size}:${after.mtimeMs}` !== fingerprint)
          throw new Error('The recording changed during the upload. It will be checked again.');
        this.state.receipts[path] = { fingerprint, clipId: result.clip.id };
        // Delivered: the cached analysis is no longer needed.
        await rm(cachePath, { force: true });
        this.attempts.delete(path);
        this.hashes.delete(`${path}:${fingerprint}`);
        this.state.uploaded++;
        this.state.recent = [
          {
            name: basename(path),
            game: shown,
            ...(analysis?.result.title ? { title: analysis.result.title } : {}),
            ...(analysis?.result.tags.length ? { tags: analysis.result.tags } : {}),
            clipId: result.clip.id,
            at: Date.now(),
            seconds: Math.round((Date.now() - started) / 1000),
          },
          ...(this.state.recent ?? []),
        ].slice(0, 30);
        this.queue = this.queue.filter((e) => e.path !== path);
        this.notes.delete(path);
        await this.persist();
        this.observed.delete(path);
        this.retryAt.delete(path);
        this.error = '';
        console.log(`Archived: ${basename(path)}`);
        queued--;
        this.options.onQueued?.(queued);
        this.options.onStatus?.(`Archived: ${basename(path)}`);
        this.options.onUploaded?.(path, game, before.mtimeMs);
      } catch (error) {
        // Stopped because a game started or the client was paused: the clip stays in the queue
        // as it was and continues afterwards, without counting as a failed attempt.
        if (pausedUpload.signal.aborted || this.options.signal?.aborted) {
          this.options.onStatus?.(`Upload paused: ${basename(path)}`);
          continue;
        }
        const deferred = error instanceof DeferredError;
        const message = error instanceof Error ? error.message : 'Upload not possible.';
        const state = deferred ? ('deferred' as const) : ('retry' as const);
        // Waiting for a match to end keeps its steady minute; failures back off, so a server
        // that is down or refuses a file is not asked every minute for hours.
        const failures = deferred ? 0 : (this.attempts.get(path) ?? 0) + 1;
        if (!deferred) this.attempts.set(path, failures);
        this.retryAt.set(
          path,
          timeNow() + Math.min(60000 * 2 ** Math.max(0, failures - 1), 30 * 60000),
        );
        this.notes.set(path, { state, note: message });
        this.queue = this.queue.map((e) => (e.path === path ? { ...e, state, note: message } : e));
        if (deferred) {
          this.options.onStatus?.(`${basename(path)}: ${message}`);
          continue;
        }
        this.error = message;
        this.options.onStatus?.(this.error);
      } finally {
        if (this.active?.path === path) this.active = undefined;
        this.emitQueue();
      }
    }
    const current = new Set(files);
    for (const path of this.observed.keys()) if (!current.has(path)) this.observed.delete(path);
    this.options.onQueued?.(queued);
  }
  async heartbeat() {
    await fetch(`${this.options.server}/api/devices/heartbeat`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: this.state.id,
        name: hostname(),
        folder: this.options.folder,
        uploaded: this.state.uploaded,
        error: this.error,
        analysisLocation: this.options.analyze ? 'client' : 'server',
        paused: !!this.options.isPaused?.(),
      }),
      signal: AbortSignal.timeout(10000),
    }).then((r) => {
      if (!r.ok) throw new Error('Server connection failed.');
    });
  }
}
export function defaultStatePath(folder: string, server: string) {
  return resolve(
    'agent-state',
    `${createHash('sha256')
      .update(`${resolve(folder)}:${server}`)
      .digest('hex')
      .slice(0, 16)}.json`,
  );
}
