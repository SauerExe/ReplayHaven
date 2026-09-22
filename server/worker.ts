import { extname, join, resolve, sep } from 'node:path';
import { rm } from 'node:fs/promises';
import { aiConfigured } from './config';
import type { ServerConfig } from './config';
import type { VaultDatabase } from './database';
import type { MediaProcessor } from './media';
import type { AnalysisProvider } from './providers';
export class AnalysisWorker {
  private running: Promise<void> | null = null;
  private stopped = false;
  constructor(
    readonly db: VaultDatabase,
    readonly config: ServerConfig,
    readonly media: MediaProcessor,
    readonly provider: AnalysisProvider,
  ) {}
  recover() {
    for (const clip of this.db.list())
      if (!clip.deleted && ['preparing', 'analyzing'].includes(clip.analysis?.status || ''))
        this.db.patch(clip.id, { analysis: { ...clip.analysis!, status: 'queued' } });
    this.kick();
  }
  kick() {
    if (!this.running && !this.stopped) {
      this.running = this.drain().finally(() => {
        this.running = null;
        if (!this.stopped && this.hasWork()) this.kick();
      });
    }
  }
  hasWork() {
    return this.db
      .list()
      .some((c) => !c.deleted && (c.status === 'processing' || c.analysis?.status === 'queued'));
  }
  async stop() {
    this.stopped = true;
    await this.running;
  }
  async drain() {
    while (!this.stopped) {
      const clip = this.db
        .list()
        .reverse()
        .find((c) => !c.deleted && (c.status === 'processing' || c.analysis?.status === 'queued'));
      if (!clip) return;
      const directory = join(this.config.dataDir, 'clips', clip.id);
      if (clip.status === 'processing') {
        try {
          const meta = await this.media.prepare(
            clip.originalFile,
            directory,
            extname(clip.originalFile),
          );
          if (this.db.get(clip.id)?.deleted) continue;
          const latest = this.db.get(clip.id)!;
          this.db.patch(clip.id, {
            duration: meta.duration,
            resolution: `${meta.height}p`,
            codec: meta.codec,
            playbackFile: meta.playbackFile,
            thumbnail: `/api/clips/${clip.id}/thumbnail`,
            videoSource: `/api/clips/${clip.id}/video`,
            status: 'ready',
            analysis: latest.expectsClientAnalysis
              ? latest.analysis?.status === 'ready'
                ? latest.analysis
                : { status: 'awaiting_client' }
              : {
                  status: aiConfigured(this.config)
                    ? this.db.settings().autoAnalyze
                      ? 'queued'
                      : 'idle'
                    : 'not_configured',
                },
          });
        } catch {
          this.db.patch(clip.id, {
            status: 'error',
            analysis: {
              status: 'error',
              error:
                'Das Video konnte nicht gelesen werden. Original bleibt gespeichert. Prüfe FFmpeg oder lade eine andere Aufnahme hoch.',
            },
          });
        }
        continue;
      }
      if (!aiConfigured(this.config)) {
        this.db.patch(clip.id, { analysis: { status: 'not_configured' } });
        continue;
      }
      this.db.patch(clip.id, {
        analysis: {
          ...clip.analysis,
          status: 'analyzing',
          provider: this.config.provider,
          model: this.config.model,
          error: undefined,
        },
      });
      try {
        const settings = this.db.settings();
        const result = await this.provider.analyze({
          original: clip.originalFile,
          directory,
          duration: clip.duration,
          gameHint: clip.gameName || '',
          includeAudio: settings.includeAudio,
        });
        const latest = this.db.get(clip.id);
        if (!latest || latest.deleted) continue;
        this.db.patch(clip.id, {
          ...(settings.autoTitle && !latest.userEditedTitle ? { title: result.title } : {}),
          analysis: {
            status: 'ready',
            result,
            provider: this.config.provider,
            model: this.config.model,
            updatedAt: new Date().toISOString(),
            input:
              this.config.provider === 'local'
                ? 'frames'
                : settings.includeAudio
                  ? 'video_audio'
                  : 'video',
          },
        });
      } catch {
        if (!this.db.get(clip.id)?.deleted)
          this.db.patch(clip.id, {
            analysis: {
              ...clip.analysis,
              status: 'error',
              error:
                'Die KI-Analyse ist fehlgeschlagen. Prüfe Anbieter, Modell, Zugangsdaten und verfügbaren Speicher. Du kannst die Analyse erneut starten.',
            },
          });
      } finally {
        await rm(join(directory, 'analysis.mp4'), { force: true }).catch(() => {});
        const frames = resolve(directory, 'frames');
        const root = resolve(this.config.dataDir, 'clips');
        if (frames.startsWith(root + sep) && /^[0-9a-f-]{36}$/.test(clip.id))
          await rm(frames, { recursive: true, force: true }).catch(() => {});
      }
    }
  }
}
