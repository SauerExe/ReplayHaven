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
}
export interface StoredGame {
  key: string;
  /** Der Name, wie er in der Bibliothek steht — also der Ordnername der Aufnahmen. */
  label: string;
  checkedAt: string;
  /** Fehlt, wenn es zu diesem Namen keinen exakten Treffer gibt. */
  info?: {
    name: string;
    appId: number;
    description: string;
    genre: string;
    released: string;
    source: string;
    /** Dateiname des heruntergeladenen Covers unterhalb von `covers/`. */
    cover?: string;
  };
}
export class VaultDatabase {
  readonly db: DatabaseSync;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(join(directory, 'vault.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS clips(id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS games(key TEXT PRIMARY KEY, data TEXT NOT NULL);`);
  }
  /**
   * Nachgeschlagene Spielinfos. Ein Eintrag ohne `info` merkt sich, dass für diesen Namen
   * nichts zu finden war — sonst fragt der Server bei jedem Upload erneut nach.
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
export function publicClip(clip: StoredClip): Clip {
  const {
    hash: _hash,
    originalFile: _originalFile,
    playbackFile: _playbackFile,
    userEditedTitle: _edited,
    deleted: _deleted,
    ...publicData
  } = clip;
  void _hash;
  void _originalFile;
  void _playbackFile;
  void _edited;
  void _deleted;
  return publicData;
}
