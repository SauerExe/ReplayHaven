import { extname, join } from 'node:path';
import { rm } from 'node:fs/promises';
import type { VaultDatabase, StoredClip } from './database';
import { isFastStart, planPlayback, playbackProfile } from './media';
import type { MediaProcessor, PlaybackMode } from './media';

/** URL of a clip's playback file; the version changes whenever the file does (cache busting). */
export function videoSource(id: string, file: string) {
  const name =
    file
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.[^.]+$/, '') || 'video';
  return `/api/clips/${id}/video?v=${encodeURIComponent(`${name}.${Date.now().toString(36)}`)}`;
}

/**
 * Creates web renditions in the background, one clip at a time: for clips from before the
 * rendition existed and for heavy uploads that got a quick remux first. It waits while uploads
 * are being processed, runs FFmpeg at a low priority and remembers per clip which profile is
 * done, so a restart continues where it stopped.
 */
export class PlaybackBackfill {
  private running: Promise<void> | null = null;
  private stopped = false;
  private readonly abort = new AbortController();
  private wake?: () => void;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private current: string | null = null;
  private done = 0;
  readonly profile: string;

  constructor(
    private readonly db: VaultDatabase,
    private readonly dataDir: string,
    private readonly media: MediaProcessor,
    private readonly mode: PlaybackMode,
    /** True while uploads or analyses need the CPU; the backfill waits for them. */
    private readonly busy: () => boolean = () => false,
    private readonly pauseMs = 5000,
    /** Wait before trying again after an unexpected failure. */
    private readonly retryMs = 60000,
  ) {
    this.profile = playbackProfile(mode);
  }

  /** Clips that still need a rendition, newest first (those are watched first). */
  pending(clips?: StoredClip[]): StoredClip[] {
    if (this.mode !== 'web') return [];
    return (clips ?? this.db.list()).filter(
      (c) =>
        !c.deleted &&
        c.status === 'ready' &&
        c.playbackProfile !== this.profile &&
        c.playbackFailed !== this.profile,
    );
  }
  /** `clips`: the clip list when the caller already has it. */
  status(clips?: StoredClip[]) {
    return {
      mode: this.mode,
      pending: this.pending(clips).length,
      current: this.current,
      done: this.done,
    };
  }
  kick() {
    this.wake?.();
    if (this.running || this.stopped || this.mode !== 'web') return;
    clearTimeout(this.retryTimer);
    this.running = this.drain()
      // An unhandled rejection (e.g. the database failing on a full disk) would end the whole
      // server; the backfill tries again later instead.
      .catch((error: unknown) => {
        if (this.stopped) return;
        console.error(
          `Playback backfill stopped, retrying in ${this.retryMs / 1000} s: ${error instanceof Error ? error.message : String(error)}`,
        );
        this.retryTimer = setTimeout(() => this.kick(), this.retryMs);
        this.retryTimer.unref?.();
      })
      .finally(() => {
        this.running = null;
      });
  }
  async stop() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    // A running FFmpeg is cancelled; its clip is simply rendered again after a restart.
    this.abort.abort();
    this.wake?.();
    await this.running;
  }
  /** Resolves after `ms` or as soon as kick() or stop() is called. */
  private pause(ms: number) {
    return new Promise<void>((done) => {
      const timer = setTimeout(finish, ms);
      timer.unref?.();
      function finish() {
        clearTimeout(timer);
        done();
      }
      this.wake = finish;
    }).finally(() => {
      this.wake = undefined;
    });
  }
  private async drain() {
    while (!this.stopped) {
      if (this.busy()) {
        await this.pause(this.pauseMs);
        continue;
      }
      const clip = this.pending()[0];
      if (!clip) return;
      this.current = clip.id;
      try {
        await this.render(clip);
      } finally {
        this.current = null;
      }
    }
  }
  private async render(clip: StoredClip) {
    const directory = join(this.dataDir, 'clips', clip.id);
    const extension = extname(clip.originalFile);
    let output: string | undefined;
    try {
      const meta = await this.media.probe(clip.originalFile);
      const plan = planPlayback(meta, extension, this.mode, await isFastStart(clip.originalFile));
      output =
        plan === 'original'
          ? clip.originalFile
          : await this.media.renderPlayback(
              clip.originalFile,
              join(directory, `playback-${this.profile}.mp4`),
              meta,
              plan,
              this.mode,
              { lowPriority: true, signal: this.abort.signal },
            );
      const latest = this.db.get(clip.id);
      if (!latest || latest.deleted || latest.status !== 'ready') {
        if (output !== clip.originalFile) await rm(output, { force: true }).catch(() => {});
        return;
      }
      const previous = latest.playbackFile;
      this.db.patch(clip.id, {
        playbackFile: output,
        playbackProfile: this.profile,
        playbackFailed: undefined,
        videoSource: videoSource(clip.id, output),
      });
      // The old rendition goes; a player that still streams it keeps its open file on Linux.
      if (previous && previous !== output && previous !== latest.originalFile)
        await rm(previous, { force: true }).catch(() => {});
      this.done++;
    } catch {
      if (!this.stopped && this.db.get(clip.id))
        this.db.patch(clip.id, { playbackFailed: this.profile });
    }
  }
}
