import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gameKey, lookupGame } from './metadata';
import type { VaultDatabase, StoredGame } from './database';

/**
 * Spielinfos einmal je Spielname besorgen und im Archiv behalten. Der Aufruf blockiert keinen
 * Upload: er läuft im Hintergrund und scheitert still, wenn Steam nicht erreichbar ist.
 *
 * Auch ein erfolgloses Nachschlagen wird vermerkt, damit nicht bei jedem Upload erneut
 * angefragt wird. Nach `RETRY_AFTER_DAYS` darf ein Name erneut versucht werden — Spiele
 * erscheinen später auf Steam, und Tippfehler werden im Archiv korrigiert.
 */
const RETRY_AFTER_DAYS = 14;

export function needsLookup(existing: StoredGame | undefined, now = Date.now()) {
  if (!existing) return true;
  if (existing.info) return false;
  const age = now - Date.parse(existing.checkedAt);
  return !Number.isFinite(age) || age > RETRY_AFTER_DAYS * 86400000;
}

export class GameLibrary {
  private running = new Set<string>();
  /** Anfragen laufen nacheinander: der Dienst ist fremd und soll nicht geflutet werden. */
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly db: VaultDatabase,
    private readonly coverDir: string,
    private readonly enabled: boolean,
  ) {}

  list(): StoredGame[] {
    return this.db.games();
  }

  /** Stößt das Nachschlagen an, ohne auf das Ergebnis zu warten. */
  schedule(label: string) {
    if (!this.enabled) return;
    const key = gameKey(label);
    if (!key || this.running.has(key)) return;
    if (!needsLookup(this.db.game(key))) return;
    this.running.add(key);
    this.queue = this.queue
      .then(() => this.resolve(key, label))
      .finally(() => this.running.delete(key));
  }

  /**
   * Holt Spielinfos für alles nach, was schon im Archiv liegt. Ohne diesen Schritt bekämen nur
   * künftige Aufnahmen ein Cover, und ein gewachsenes Archiv bliebe für immer leer.
   */
  backfill(labels: string[]) {
    for (const label of new Set(labels.filter(Boolean))) this.schedule(label);
  }

  private async resolve(key: string, label: string) {
    const entry: StoredGame = { key, label, checkedAt: new Date().toISOString() };
    try {
      const info = await lookupGame(label);
      if (info) {
        entry.info = {
          name: info.name,
          appId: info.appId,
          description: info.description,
          genre: info.genre,
          released: info.released,
          source: info.source,
          cover: await this.cache(key, info.coverUrl),
        };
      }
    } catch {
      // Kein Netz, kein Steam, kein Drama: der Eintrag wird als erfolglos vermerkt und
      // später erneut versucht. Aufnahmen funktionieren ohne Spielinfos vollständig.
    }
    this.db.putGame(entry);
  }

  /** Lädt das Cover einmal herunter, damit die Bibliothek ohne Netz funktioniert. */
  private async cache(key: string, url: string) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) return undefined;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) return undefined;
      await mkdir(this.coverDir, { recursive: true });
      const file = `${key.replace(/[^a-z0-9]+/g, '-')}.jpg`;
      await writeFile(join(this.coverDir, file), bytes);
      return file;
    } catch {
      return undefined;
    }
  }
}
