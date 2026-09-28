import { extname, join, resolve, sep } from 'node:path';
import { rm } from 'node:fs/promises';
import { aiConfigured } from './config';
import type { ServerConfig } from './config';
import type { VaultDatabase } from './database';
import type { MediaProcessor } from './media';
import type { AnalysisProvider } from './providers';
import { videoSource } from './playback';
/** Background failures go to the server log with their cause; users see the short message. */
function logFailure(what: string, error: unknown) {
  const detail = (error as { detail?: string } | undefined)?.detail;
  console.error(
    `${what}: ${error instanceof Error ? error.message : String(error)}${detail ? `\n${detail}` : ''}`,
  );
}

/** First wait before the queue tries again after an unexpected failure; doubles up to the cap. */
const RETRY_MS = 5000;
const RETRY_MAX_MS = 5 * 60000;

export class AnalysisWorker {
  private running: Promise<void> | null = null;
  private stopped = false;
  private retryMs = RETRY_MS;
  private retryTimer?: ReturnType<typeof setTimeout>;
  constructor(
    readonly db: VaultDatabase,
    readonly config: ServerConfig,
    readonly media: MediaProcessor,
    readonly provider: AnalysisProvider,
    private readonly onGame?: (name: string) => void,
    /** Called after a clip became ready, e.g. to start the playback backfill. */
    private readonly onPrepared?: () => void,
  ) {}
  recover() {
    for (const clip of this.db.list())
      if (!clip.deleted && ['preparing', 'analyzing'].includes(clip.analysis?.status || ''))
        this.db.patch(clip.id, { analysis: { ...clip.analysis!, status: 'queued' } });
    this.kick();
  }
  kick() {
    if (this.running || this.stopped) return;
    clearTimeout(this.retryTimer);
    this.running = this.drain()
      .then(() => {
        this.retryMs = RETRY_MS;
        return this.hasWork();
      })
      .then(
        (more) => {
          this.running = null;
          if (more) this.kick();
        },
        // Something beyond a single clip failed, e.g. the database (disk full). Unhandled, the
        // rejection would end the whole server; the queue tries again later instead.
        (error: unknown) => {
          this.running = null;
          // After stop() the database may already be closed; that is no failure.
          if (this.stopped) return;
          logFailure(`Analysis queue stopped, retrying in ${this.retryMs / 1000} s`, error);
          this.retryTimer = setTimeout(() => this.kick(), this.retryMs);
          this.retryTimer.unref?.();
          this.retryMs = Math.min(this.retryMs * 2, RETRY_MAX_MS);
        },
      );
  }
  hasWork() {
    return this.db
      .list()
      .some((c) => !c.deleted && (c.status === 'processing' || c.analysis?.status === 'queued'));
  }
  /**
   * Waits for the clip in progress, but at most `waitMs`: an AI request can take minutes.
   * Nothing is lost by not waiting, recover() queues an interrupted clip again on the next start.
   */
  async stop(waitMs = 8000) {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      this.running,
      new Promise<void>((done) => {
        timer = setTimeout(done, waitMs);
        timer.unref?.();
      }),
    ]);
    clearTimeout(timer);
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
            this.config.playback ?? 'web',
          );
          if (this.db.get(clip.id)?.deleted) continue;
          const latest = this.db.get(clip.id)!;
          this.db.patch(clip.id, {
            duration: meta.duration,
            resolution: `${meta.height}p`,
            codec: meta.codec,
            playbackFile: meta.playbackFile,
            playbackProfile: meta.playbackProfile,
            playbackFailed: undefined,
            thumbnail: `/api/clips/${clip.id}/thumbnail`,
            videoSource: videoSource(clip.id, meta.playbackFile),
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
          // A rendition from an earlier run (retry, backfill) is replaced by the new one.
          if (
            latest.playbackFile &&
            latest.playbackFile !== meta.playbackFile &&
            latest.playbackFile !== clip.originalFile
          )
            await rm(latest.playbackFile, { force: true }).catch(() => {});
          this.onPrepared?.();
        } catch (error) {
          logFailure(`Clip ${clip.id}: preparing the video failed`, error);
          const latest = this.db.get(clip.id);
          if (!latest || latest.deleted) continue;
          // A result the PC delivered while the video was being prepared stays; retrying the
          // media keeps it too (app.ts retry-media).
          const delivered =
            latest.analysis?.provider === 'client' && latest.analysis.status === 'ready';
          this.db.patch(clip.id, {
            status: 'error',
            analysis: delivered
              ? latest.analysis
              : {
                  status: 'error',
                  error:
                    'The video could not be read. The original stays stored. Check FFmpeg or upload another recording.',
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
          gameName: latest.gameName || result.game,
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
        this.onGame?.(latest.gameName || result.game);
      } catch (error) {
        logFailure(`Clip ${clip.id}: server analysis failed`, error);
        const latest = this.db.get(clip.id);
        // Only the analysis this run started turns into an error: a result delivered or a new
        // request made in the meantime stays.
        if (latest && !latest.deleted && latest.analysis?.status === 'analyzing')
          this.db.patch(clip.id, {
            analysis: {
              ...latest.analysis,
              status: 'error',
              error:
                'The AI analysis failed. Check provider, model, credentials and available memory. You can start the analysis again.',
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
