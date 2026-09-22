import { createHash, randomUUID } from 'node:crypto';
import { openAsBlob } from 'node:fs';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { hostname } from 'node:os';
import type { AnalysisResult } from '../server/schema';
export interface ClientAnalysis {
  result: AnalysisResult;
  duration: number;
  model: string;
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
  signal?: AbortSignal;
}
type Receipt = { fingerprint: string; clipId?: string };
type AgentState = { id: string; receipts: Record<string, Receipt>; uploaded: number };
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
export class FolderUploader {
  state: AgentState = { id: randomUUID(), receipts: {}, uploaded: 0 };
  private observed = new Map<string, { fingerprint: string; since: number }>();
  private retryAt = new Map<string, number>();
  error = '';
  constructor(readonly options: WatchOptions) {}
  async initialize() {
    const folderStat = await stat(this.options.folder);
    if (!folderStat.isDirectory()) throw new Error('Aufnahmeordner nicht gefunden.');
    let existing = false;
    try {
      this.state = JSON.parse(await readFile(this.options.statePath, 'utf8'));
      existing = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error(
          'Der Agent-Zustand ist beschädigt. Bewahre die Datei auf und verwende einen neuen Zustandspfad.',
        );
    }
    if (!existing && !this.options.includeExisting) {
      for (const path of await listVideos(this.options.folder)) {
        const s = await stat(path);
        this.state.receipts[path] = { fingerprint: `${s.size}:${s.mtimeMs}` };
      }
      await this.persist();
    }
  }
  async persist() {
    await mkdir(dirname(this.options.statePath), { recursive: true });
    const temp = `${this.options.statePath}.tmp`;
    await writeFile(temp, JSON.stringify(this.state, null, 2));
    await rename(temp, this.options.statePath);
  }
  headers() {
    return this.options.token
      ? { Authorization: `Bearer ${this.options.token}` }
      : { Authorization: '' };
  }
  async scan(now = Date.now()) {
    const files = await listVideos(this.options.folder);
    let queued = 0;
    for (const path of files) {
      const before = await stat(path);
      const fingerprint = `${before.size}:${before.mtimeMs}`;
      if (this.state.receipts[path]?.fingerprint === fingerprint || before.size === 0) continue;
      queued++;
      this.options.onQueued?.(queued);
      if (this.options.isPaused?.() || this.options.signal?.aborted) continue;
      const observed = this.observed.get(path);
      if (!observed || observed.fingerprint !== fingerprint) {
        this.observed.set(path, { fingerprint, since: now });
        continue;
      }
      if (now - observed.since < this.options.stableMs || (this.retryAt.get(path) || 0) > now)
        continue;
      try {
        if (before.size > 2 * 1024 ** 3) throw new Error('Eine Aufnahme ist größer als 2 GB.');
        await this.options.probe?.(path);
        const game = this.options.game || basename(dirname(path));
        let analysis: ClientAnalysis | undefined;
        const cachePath = join(
          dirname(this.options.statePath),
          'analysis-cache',
          `${createHash('sha256').update(`${path}:${fingerprint}`).digest('hex')}.json`,
        );
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
          throw new Error('Die Datei wurde verändert und wird erneut geprüft.');
        this.options.onStatus?.(`Upload: ${basename(path)}`);
        const form = new FormData();
        form.append(
          'file',
          await openAsBlob(path, { type: extname(path) === '.webm' ? 'video/webm' : 'video/mp4' }),
          basename(path),
        );
        const response = await fetch(`${this.options.server}/api/clips`, {
          method: 'POST',
          headers: {
            ...this.headers(),
            'x-device-name': encodeURIComponent(hostname()),
            'x-game-name': encodeURIComponent(analysis?.result.game || game),
            'x-client-analysis': analysis ? '1' : '0',
            'x-recorded-at': new Date(before.mtimeMs).toISOString(),
          },
          body: form,
          signal: AbortSignal.any([
            AbortSignal.timeout(30 * 60000),
            ...(this.options.signal ? [this.options.signal] : []),
          ]),
        });
        if (!response.ok) throw new Error(`Upload fehlgeschlagen (HTTP ${response.status}).`);
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
            throw new Error(
              'Video gespeichert, KI-Ergebnis noch nicht bestätigt. Übertragung wird erneut versucht.',
            );
          await rmCache(cachePath);
        }
        const after = await stat(path);
        if (`${after.size}:${after.mtimeMs}` !== fingerprint)
          throw new Error(
            'Die Aufnahme wurde während des Uploads verändert. Sie wird erneut geprüft.',
          );
        this.state.receipts[path] = { fingerprint, clipId: result.clip.id };
        this.state.uploaded++;
        await this.persist();
        this.observed.delete(path);
        this.retryAt.delete(path);
        this.error = '';
        console.log(`Archiviert: ${basename(path)}`);
        queued--;
        this.options.onQueued?.(queued);
        this.options.onStatus?.(`Archiviert: ${basename(path)}`);
      } catch (error) {
        this.error = error instanceof Error ? error.message : 'Upload nicht möglich.';
        this.retryAt.set(path, now + 60000);
        this.options.onStatus?.(this.error);
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
      if (!r.ok) throw new Error('Server-Verbindung fehlgeschlagen.');
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
async function rmCache(path: string) {
  const { unlink } = await import('node:fs/promises');
  await unlink(path).catch(() => {});
}
