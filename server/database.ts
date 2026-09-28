import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Clip } from '../src/domain/models';
import type { AnalysisSettings } from './schema';
export interface StoredClip extends Clip {
  server: true;
  originalName: string;
  hash: string;
  originalFile: string;
  playbackFile?: string;
  codec?: string;
  userEditedTitle?: boolean;
  deleted?: boolean;
  expectsClientAnalysis?: boolean;
  /** Version of the playback rendition (media.ts playbackProfile); unset while one is due. */
  playbackProfile?: string;
  /** Profile for which rendering the playback file failed, so the backfill does not loop. */
  playbackFailed?: string;
  /**
   * Session and account of the paired PC that uploaded the clip; only that PC delivers its AI
   * result. Unset for browser uploads and clips from before 1.1.5.
   */
  uploader?: { session: string; user: string };
}
export interface AgentDevice {
  id: string;
  name: string;
  folder: string;
  lastSeen: string;
  error: string;
  uploaded: number;
  analysisLocation?: string;
  paused?: boolean;
  /** Session of the paired PC that reports under this ID; another PC may not take it over. */
  owner?: string;
}
export interface StoredGame {
  key: string;
  /** The name as it appears in the library — the folder name of the recordings. */
  label: string;
  checkedAt: string;
  status?: 'ready' | 'not_found' | 'error';
  /** Missing when there is no exact match for this name. */
  info?: {
    name: string;
    appId: number;
    description: string;
    genre: string;
    released: string;
    source: string;
    /** File name of the downloaded cover below `covers/`. */
    cover?: string;
  };
}
/**
 * Version of the database layout (PRAGMA user_version). Raise it when a release changes the
 * layout in a way older releases cannot read: they then refuse to start instead of damaging it.
 */
export const SCHEMA_VERSION = 1;
export class VaultDatabase {
  readonly db: DatabaseSync;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(join(directory, 'vault.sqlite'));
    const { user_version: version } = this.db.prepare('PRAGMA user_version').get() as {
      user_version: number;
    };
    if (version > SCHEMA_VERSION) {
      this.db.close();
      throw new Error(
        `The database was written by a newer ReplayHaven (layout ${version}, this release reads up to ${SCHEMA_VERSION}). Restore a backup or use the newer version.`,
      );
    }
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS clips(id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS games(key TEXT PRIMARY KEY, data TEXT NOT NULL);
      PRAGMA user_version=${SCHEMA_VERSION};`);
  }
  /**
   * Looked-up game info. An entry without `info` remembers that nothing was found for this
   * name — otherwise the server would ask again on every upload.
   */
  games(): StoredGame[] {
    return (this.db.prepare('SELECT data FROM games').all() as { data: string }[]).map((r) =>
      JSON.parse(r.data),
    );
  }
  game(key: string): StoredGame | undefined {
    const row = this.db.prepare('SELECT data FROM games WHERE key=?').get(key) as
      { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  putGame(entry: StoredGame) {
    this.db
      .prepare('INSERT INTO games(key, data) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET data=?')
      .run(entry.key, JSON.stringify(entry), JSON.stringify(entry));
  }
  list(): StoredClip[] {
    return (
      this.db.prepare('SELECT data FROM clips ORDER BY rowid DESC').all() as { data: string }[]
    ).map((r) => JSON.parse(r.data));
  }
  get(id: string): StoredClip | undefined {
    const row = this.db.prepare('SELECT data FROM clips WHERE id=?').get(id) as
      { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  findHash(hash: string) {
    const row = this.db.prepare('SELECT data FROM clips WHERE hash=?').get(hash) as
      { data: string } | undefined;
    return row ? (JSON.parse(row.data) as StoredClip) : undefined;
  }
  put(clip: StoredClip) {
    this.db
      .prepare(
        'INSERT INTO clips(id,hash,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
      )
      .run(clip.id, clip.hash, JSON.stringify(clip));
  }
  patch(id: string, patch: Partial<StoredClip>) {
    const clip = this.get(id);
    if (!clip) return undefined;
    const next = { ...clip, ...patch };
    this.put(next);
    return next;
  }
  /** Deletes a clip's row for good (the admin command removes its files first). */
  remove(id: string) {
    this.db.prepare('DELETE FROM clips WHERE id=?').run(id);
  }
  settings(): AnalysisSettings {
    const row = this.db.prepare("SELECT data FROM settings WHERE id='analysis'").get() as
      { data: string } | undefined;
    return row ? JSON.parse(row.data) : { autoAnalyze: true, autoTitle: true, includeAudio: false };
  }
  saveSettings(settings: AnalysisSettings) {
    this.db
      .prepare(
        "INSERT INTO settings(id,data) VALUES('analysis',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(JSON.stringify(settings));
  }
  devices(): AgentDevice[] {
    return (this.db.prepare('SELECT data FROM devices').all() as { data: string }[]).map((r) =>
      JSON.parse(r.data),
    );
  }
  putDevice(device: AgentDevice) {
    this.db
      .prepare(
        'INSERT INTO devices(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
      )
      .run(device.id, JSON.stringify(device));
  }
  close() {
    this.db.close();
  }
}
/**
 * A clip as the web interface sees it. `names` resolves account IDs; the uploader appears by
 * name while its account exists, the PC session never leaves the server.
 */
export function publicClip(
  clip: StoredClip,
  names: (userId: string) => string | undefined = () => undefined,
): Clip {
  const {
    hash: _hash,
    originalFile: _originalFile,
    playbackFile: _playbackFile,
    userEditedTitle: _edited,
    deleted: _deleted,
    playbackProfile: _profile,
    playbackFailed: _failed,
    uploader: _uploader,
    ...publicData
  } = clip;
  void _hash;
  void _originalFile;
  void _playbackFile;
  void _edited;
  void _deleted;
  void _profile;
  void _failed;
  void _uploader;
  const user = clip.uploader?.user;
  const name = user ? names(user) : undefined;
  return user && name ? { ...publicData, uploadedBy: { id: user, name } } : publicData;
}
