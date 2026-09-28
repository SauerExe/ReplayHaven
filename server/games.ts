import { createHash } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gameKey, lookupGame } from './metadata';
import type { ContentLanguage, Igdb } from './metadata';
import type { VaultDatabase, StoredClip, StoredGame } from './database';
import type { GameMetadataStatus } from '../src/domain/models';

const HOUR = 3600000;
const DAY = 24 * HOUR;

/** Retry network errors and missing covers sooner than a definite miss. */
export function needsLookup(existing: StoredGame | undefined, now = Date.now()) {
  if (!existing) return true;
  const age = now - Date.parse(existing.checkedAt);
  const retryAfter =
    existing.status === 'error' || (existing.info && !existing.info.cover)
      ? HOUR
      : existing.info && existing.status !== 'not_found'
        ? 30 * DAY
        : 14 * DAY;
  return !Number.isFinite(age) || age < 0 || age >= retryAfter;
}

export class GameLibrary {
  private running = new Set<string>();
  /** Requests run one after another: the service is third-party and must not be flooded. */
  private queue: Promise<void> = Promise.resolve();
  private readonly abort = new AbortController();
  private stopped = false;
  constructor(
    private readonly db: VaultDatabase,
    private readonly coverDir: string,
    private readonly enabled: boolean,
    /** Second source for games without a Steam entry; absent until IGDB is set up. */
    private readonly igdb?: Igdb,
    /** Language of the game descriptions (REPLAYHAVEN_CONTENT_LANGUAGE). */
    private readonly language: ContentLanguage = 'de',
  ) {}

  list(): StoredGame[] {
    return this.db.games();
  }

  /** `clips`: the clip list when the caller already has it. */
  labels(clips: StoredClip[] = this.db.list()) {
    return clips.filter((clip) => !clip.deleted).map((clip) => clip.gameName || '');
  }

  status(clips?: StoredClip[]): GameMetadataStatus {
    const keys = new Set(this.labels(clips).map(gameKey).filter(Boolean));
    const entries = this.list().filter((game) => keys.has(game.key));
    return {
      enabled: this.enabled,
      pending: this.running.size,
      total: keys.size,
      matched: entries.filter((game) => game.info).length,
      missing: entries.filter((game) => !game.info && game.status !== 'error').length,
      failed: entries.filter((game) => game.status === 'error').length,
    };
  }

  /** Returns true when a new job was queued; does not wait for the network. */
  schedule(label: string, force = false) {
    if (!this.enabled || this.stopped) return false;
    const key = gameKey(label);
    if (!key || this.running.has(key)) return false;
    if (!force && !needsLookup(this.db.game(key))) return false;
    this.running.add(key);
    this.queue = this.queue
      .then(() => {
        if (!this.stopped) return this.resolve(key, label);
      })
      .catch(() => {
        // Even a storage error must not block later jobs.
        console.warn('Could not save game info.');
      })
      .finally(() => this.running.delete(key));
    return true;
  }

  /**
   * Fetches game info for everything already in the archive. Without this step only future
   * recordings would get a cover, and an existing archive would stay empty forever.
   */
  backfill(labels = this.labels(), force = false) {
    let queued = 0;
    for (const label of new Set(labels.filter(Boolean))) {
      if (this.schedule(label, force)) queued++;
    }
    return queued;
  }

  async stop() {
    this.stopped = true;
    this.abort.abort();
    await this.queue;
  }

  private async resolve(key: string, label: string) {
    const previous = this.db.game(key);
    const entry: StoredGame = {
      key,
      label,
      checkedAt: new Date().toISOString(),
      info: previous?.info,
      status: 'not_found',
    };
    try {
      const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(30000)]);
      const info = await lookupGame(label, signal, this.igdb, this.language);
      if (info) {
        const cover = await this.cache(key, [info.coverUrl, info.fallbackCoverUrl].filter(Boolean));
        entry.info = {
          name: info.name,
          appId: info.appId,
          description: info.description,
          genre: info.genre,
          released: info.released,
          source: info.source,
          cover: cover || (previous?.info?.appId === info.appId ? previous.info.cover : undefined),
        };
        entry.status = cover ? 'ready' : 'error';
      }
    } catch {
      // Info already stored stays available even after a temporary error.
      entry.status = 'error';
    }
    if (!this.stopped) {
      entry.checkedAt = new Date().toISOString();
      this.db.putGame(entry);
    }
  }

  /** Store the cover locally and atomically; landscape image as fallback for a missing poster. */
  private async cache(key: string, urls: string[]) {
    const file = `${createHash('sha256').update(key).digest('hex')}.jpg`;
    const temporary = join(this.coverDir, `${file}.tmp`);
    for (const url of urls) {
      if (this.stopped) return undefined;
      try {
        const response = await fetch(url, {
          signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(20000)]),
        });
        const limit = 8 * 1024 * 1024;
        if (
          !response.ok ||
          !response.headers.get('content-type')?.startsWith('image/jpeg') ||
          Number(response.headers.get('content-length')) > limit ||
          !response.body
        ) {
          await response.body?.cancel();
          continue;
        }
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > limit) throw new Error('Cover too large.');
            chunks.push(value);
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
        const bytes = Buffer.concat(chunks);
        if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff)
          continue;
        await mkdir(this.coverDir, { recursive: true });
        await writeFile(temporary, bytes);
        await rename(temporary, join(this.coverDir, file));
        return file;
      } catch {
        // The next image URL may be available even if the library cover is missing.
      } finally {
        await rm(temporary, { force: true }).catch(() => {});
      }
    }
    return undefined;
  }
}
