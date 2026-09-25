import { execFile, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { setPriority } from 'node:os';
import { mkdir, open, readdir, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { ServerConfig } from './config';
const moduleRequire = createRequire(typeof __filename === 'string' ? __filename : import.meta.url);
/** Length of the final window where the saved moment usually sits. */
export const TAIL_SECONDS = 30;
/** Maximum number of evenly spread frames: a 3 s spacing covers 4 minutes. */
export const MAX_EVEN_FRAMES = 80;
/** Width of analysis frames. 640 and 1280 cost the same context tokens (.docs/06-recherche.md). */
const FRAME_WIDTH = 1280;
export function runFile(
  executable: string,
  args: string[],
  timeout = 120000,
  output: 'stdout' | 'stderr' = 'stdout',
  /** lowPriority: run at a lower CPU priority so a NAS stays responsive; signal: cancel. */
  options: { lowPriority?: boolean; signal?: AbortSignal } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      executable,
      args,
      { timeout, maxBuffer: 4 * 1024 * 1024, windowsHide: true, signal: options.signal },
      (error, stdout, stderr) => {
        if (error)
          reject(
            new Error(
              error.killed
                ? 'Media processing exceeded its time limit.'
                : 'The video file could not be processed. Check the format and the FFmpeg installation.',
            ),
          );
        else resolve(output === 'stderr' ? stderr : stdout);
      },
    );
    if (options.lowPriority && child.pid)
      try {
        setPriority(child.pid, 15);
      } catch {
        // Not allowed everywhere (Windows without rights); the thread limit still applies.
      }
  });
}
/** One audio track of a recording. */
export interface AudioTrack {
  /** Index among the audio tracks, as FFmpeg addresses it with -map 0:a:N. */
  index: number;
  codec: string;
  channels: number;
  sampleRate: number;
  /** Title or handler name from the file, empty when nothing is set. */
  title: string;
}
/** What probe() learns about a video. */
export interface MediaInfo {
  duration: number;
  width: number;
  height: number;
  codec: string;
  hasAudio: boolean;
  audio: AudioTrack[];
  /** Frames per second, 0 when unknown. */
  fps?: number;
  /** Bits per second of the video (or the whole file), 0 when unknown. */
  bitrate?: number;
  pixelFormat?: string;
}
/**
 * Mixes all audio tracks into one. When the NVIDIA App records the microphone as its own track,
 * a browser only plays the first track and your voice is missing. A mono microphone often ends
 * up on one channel of a stereo track (forum reports since 2013); every further track is folded
 * to the centre, otherwise the voice would only be heard on one ear. normalize=0 keeps the levels
 * instead of dividing each track by the number of tracks; the limiter catches peaks when game
 * sound and voice are loud at the same time.
 */
function mixedAudio(tracks: readonly AudioTrack[]) {
  const inputs = tracks.map((t, i) =>
    i > 0 && t.channels >= 2
      ? `[0:a:${t.index}]pan=stereo|c0<c0+c1|c1<c0+c1[a${i}]`
      : `[0:a:${t.index}]aformat=channel_layouts=stereo[a${i}]`,
  );
  const labels = tracks.map((_, i) => `[a${i}]`).join('');
  return [
    '-filter_complex',
    `${inputs.join(';')};${labels}amix=inputs=${tracks.length}:duration=longest:normalize=0,alimiter=limit=0.95:level=0[mixed]`,
    '-map',
    '[mixed]',
  ];
}

/* Playback files for the browser */

/** web: a light rendition for streaming over the internet; original: the original when possible. */
export type PlaybackMode = 'web' | 'original';
/** original: serve the upload; remux: copy the streams into a fast-start MP4; transcode: encode. */
export type PlaybackPlan = 'original' | 'remux' | 'transcode';
/** Above this bitrate a clip gets a web rendition (NVIDIA records 1080p120 at ~50 Mbit/s). */
export const WEB_MAX_BITRATE = 12_000_000;
export const WEB_MAX_WIDTH = 1920;
export const WEB_MAX_FPS = 60;
/** Bump the version when the web rendition changes, so the backfill renders clips again. */
export const playbackProfile = (mode: PlaybackMode) => (mode === 'web' ? 'web-1' : 'original-1');

/** H.264 in 8-bit 4:2:0: every browser decodes it, so the video stream can be copied. */
export function copyableVideo(meta: MediaInfo) {
  return meta.codec === 'h264' && ['', 'yuv420p', 'yuvj420p'].includes(meta.pixelFormat ?? '');
}
/** Container, index position or audio would slow down or break playback of the original. */
export function needsRemux(meta: MediaInfo, extension: string, fastStart: boolean) {
  return (
    extension.toLowerCase() !== '.mp4' ||
    !fastStart ||
    meta.audio.length > 1 ||
    (meta.audio.length === 1 && !['aac', 'mp3'].includes(meta.audio[0].codec))
  );
}
export function tooHeavyForWeb(meta: MediaInfo) {
  return (
    (meta.bitrate ?? 0) > WEB_MAX_BITRATE ||
    (meta.fps ?? 0) > WEB_MAX_FPS + 0.5 ||
    meta.width > WEB_MAX_WIDTH
  );
}
/** How a clip should be turned into its playback file. */
export function planPlayback(
  meta: MediaInfo,
  extension: string,
  mode: PlaybackMode,
  fastStart: boolean,
): PlaybackPlan {
  if (!copyableVideo(meta)) return 'transcode';
  if (mode === 'web') {
    if (tooHeavyForWeb(meta)) return 'transcode';
    return needsRemux(meta, extension, fastStart) ? 'remux' : 'original';
  }
  // original: like before, only what a browser cannot play as it is gets a copy.
  return extension.toLowerCase() !== '.mp4' || meta.audio.length > 1 ? 'remux' : 'original';
}
/** FFmpeg arguments for a playback file; `audio` maps the audio (mixed or the first track). */
export function playbackArgs(
  input: string,
  output: string,
  meta: MediaInfo,
  plan: Exclude<PlaybackPlan, 'original'>,
  mode: PlaybackMode,
  audio: string[],
) {
  const fps = meta.fps && meta.fps > 0 ? meta.fps : 30;
  const reduceFps = fps > WEB_MAX_FPS + 0.5;
  const copyAudio =
    plan === 'remux' && meta.audio.length === 1 && ['aac', 'mp3'].includes(meta.audio[0].codec);
  const video =
    plan === 'remux'
      ? ['-c:v', 'copy']
      : mode === 'web'
        ? [
            '-vf',
            `scale=w='min(${WEB_MAX_WIDTH},iw)':h=-2${reduceFps ? `,fps=${WEB_MAX_FPS}` : ''}`,
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-profile:v',
            'high',
            '-crf',
            '23',
            '-maxrate',
            '8M',
            '-bufsize',
            '16M',
            '-pix_fmt',
            'yuv420p',
            // A keyframe every two seconds keeps seeking over the internet quick.
            '-g',
            String(Math.round(Math.min(fps, WEB_MAX_FPS) * 2)),
          ]
        : ['-c:v', 'libx264', '-preset', 'fast', '-crf', '22', '-pix_fmt', 'yuv420p'];
  return [
    '-nostdin',
    '-v',
    'error',
    '-y',
    '-protocol_whitelist',
    'file,pipe',
    '-i',
    input,
    '-map',
    '0:v:0',
    ...audio,
    ...video,
    ...(copyAudio ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '160k']),
    '-movflags',
    '+faststart',
    '-threads',
    '2',
    output,
  ];
}
/**
 * True when an MP4/MOV file has its index (moov) before the media data, so a browser can start
 * playing after the first request. Reads only the top-level box headers.
 */
export async function isFastStart(path: string) {
  const file = await open(path, 'r').catch(() => undefined);
  if (!file) return false;
  try {
    const { size } = await file.stat();
    const header = Buffer.alloc(16);
    let position = 0;
    for (let i = 0; i < 64 && position + 8 <= size; i++) {
      const { bytesRead } = await file.read(header, 0, 16, position);
      if (bytesRead < 8) return false;
      const type = header.toString('latin1', 4, 8);
      if (type === 'moov') return true;
      if (type === 'mdat') return false;
      let length = header.readUInt32BE(0);
      if (length === 1) {
        if (bytesRead < 16) return false;
        length = Number(header.readBigUInt64BE(8));
      } else if (length === 0) return false;
      if (length < 8) return false;
      position += length;
    }
    return false;
  } finally {
    await file.close();
  }
}

export class MediaProcessor {
  readonly ffmpeg: string;
  readonly ffprobe: string;
  constructor(config: Pick<ServerConfig, 'ffmpeg' | 'ffprobe'>) {
    this.ffmpeg = config.ffmpeg || (moduleRequire('ffmpeg-static') as string | null) || 'ffmpeg';
    this.ffprobe =
      config.ffprobe || (moduleRequire('@ffprobe-installer/ffprobe') as { path: string }).path;
  }
  async probe(path: string): Promise<MediaInfo> {
    const data = JSON.parse(
      await runFile(
        this.ffprobe,
        [
          '-v',
          'error',
          '-protocol_whitelist',
          'file,pipe',
          '-show_format',
          '-show_streams',
          '-of',
          'json',
          path,
        ],
        30000,
      ),
    );
    type Stream = {
      codec_type: string;
      codec_name?: string;
      channels?: number;
      sample_rate?: string;
      tags?: Record<string, string>;
    };
    const video = data.streams?.find((s: Stream) => s.codec_type === 'video');
    const audio: AudioTrack[] = (data.streams ?? [])
      .filter((s: Stream) => s.codec_type === 'audio')
      .map((s: Stream, index: number) => ({
        index,
        codec: String(s.codec_name ?? ''),
        channels: Number(s.channels) || 0,
        sampleRate: Number(s.sample_rate) || 0,
        // MP4 stores track names as handler names; the muxers' defaults say nothing.
        title: String(s.tags?.title ?? s.tags?.handler_name ?? '')
          .trim()
          .replace(/^(?:SoundHandler|Core Media Audio|ISO Media file produced by.*)$/i, ''),
      }));
    const duration = Number(data.format?.duration || video?.duration);
    if (
      !video ||
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration > 1800 ||
      !video.width ||
      !video.height ||
      video.width > 8192 ||
      video.height > 8192
    )
      throw new Error('Choose a readable video of at most 30 minutes and at most 8K resolution.');
    const rate = (value: unknown) => {
      const [num, den] = String(value ?? '')
        .split('/')
        .map(Number);
      const fps = den ? num / den : num;
      return Number.isFinite(fps) && fps > 0 && fps < 1000 ? fps : 0;
    };
    return {
      duration,
      width: Number(video.width),
      height: Number(video.height),
      codec: String(video.codec_name),
      hasAudio: audio.length > 0,
      audio,
      fps: rate(video.avg_frame_rate) || rate(video.r_frame_rate),
      bitrate: Number(video.bit_rate) || Number(data.format?.bit_rate) || 0,
      pixelFormat: String(video.pix_fmt ?? ''),
    };
  }
  /**
   * Thumbnail plus a playback file the browser can start right away. In `web` mode a clip that
   * is too heavy for streaming (see planPlayback) first gets a cheap remux; an unset `playbackProfile` tells
   * the caller that the PlaybackBackfill still has to create the web rendition.
   */
  async prepare(
    original: string,
    directory: string,
    extension: string,
    mode: PlaybackMode = 'web',
  ): Promise<MediaInfo & { playbackFile: string; playbackProfile?: string }> {
    const meta = await this.probe(original);
    await runFile(this.ffmpeg, [
      '-nostdin',
      '-v',
      'error',
      '-y',
      '-protocol_whitelist',
      'file,pipe',
      '-ss',
      String(Math.min(2, meta.duration / 3)),
      '-i',
      original,
      '-frames:v',
      '1',
      '-vf',
      'scale=960:-2',
      '-q:v',
      '3',
      join(directory, 'thumbnail.jpg'),
    ]);
    const fastStart = await isFastStart(original);
    const plan = planPlayback(meta, extension, mode, fastStart);
    // Too heavy but already playable: remux now so the clip is ready at once, and let the
    // backfill encode the web rendition in the background.
    const deferred = plan === 'transcode' && mode === 'web' && copyableVideo(meta);
    const now: PlaybackPlan = deferred
      ? needsRemux(meta, extension, fastStart)
        ? 'remux'
        : 'original'
      : plan;
    const playbackFile =
      now === 'original'
        ? original
        : await this.renderPlayback(original, join(directory, 'playback.mp4'), meta, now, mode);
    return {
      ...meta,
      playbackFile,
      /** Set when the playback file is final for `mode`; unset while the backfill has work. */
      playbackProfile: deferred ? undefined : playbackProfile(mode),
    };
  }
  /**
   * Writes a playback file for `plan` to `output` through a temporary file, so a half-written
   * rendition is never served. Several audio tracks are mixed into one; when a track cannot be
   * mixed (empty or unreadable), the first one is used as before.
   */
  async renderPlayback(
    original: string,
    output: string,
    meta: MediaInfo,
    plan: Exclude<PlaybackPlan, 'original'>,
    mode: PlaybackMode,
    options: { lowPriority?: boolean; signal?: AbortSignal } = {},
  ) {
    const temporary = output.replace(/\.mp4$/, '.part.mp4');
    const run = (audio: string[]) =>
      runFile(
        this.ffmpeg,
        playbackArgs(original, temporary, meta, plan, mode, audio),
        60 * 60000,
        'stdout',
        options,
      );
    try {
      if (meta.audio.length > 1)
        await run(mixedAudio(meta.audio)).catch(() => run(['-map', '0:a:0?']));
      else await run(['-map', '0:a:0?']);
      await rename(temporary, output);
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
    return output;
  }
  async analysisVideo(original: string, directory: string, includeAudio: boolean) {
    const output = join(directory, 'analysis.mp4');
    const tracks = includeAudio ? (await this.probe(original)).audio : [];
    const encode = (audio: string[]) =>
      runFile(
        this.ffmpeg,
        [
          '-nostdin',
          '-v',
          'error',
          '-y',
          '-protocol_whitelist',
          'file,pipe',
          '-i',
          original,
          '-map',
          '0:v:0',
          ...audio,
          '-vf',
          "scale=w='min(1280,iw)':h=-2",
          '-r',
          '8',
          '-c:v',
          'libx264',
          '-preset',
          'fast',
          '-crf',
          '30',
          '-maxrate',
          '800k',
          '-bufsize',
          '1600k',
          '-pix_fmt',
          'yuv420p',
          ...(includeAudio ? ['-c:a', 'aac', '-b:a', '48k'] : ['-an']),
          '-threads',
          '2',
          '-movflags',
          '+faststart',
          output,
        ],
        20 * 60000,
      );
    const single = includeAudio ? ['-map', '0:a:0?'] : [];
    // As for the playback copy: if the tracks cannot be mixed, the first one is used.
    if (tracks.length > 1) await encode(mixedAudio(tracks)).catch(() => encode(single));
    else await encode(single);
    return output;
  }
  /**
   * Extracts one audio track as WAV, mono at 16 kHz — the format sound detection (YAMNet)
   * and speech recognition (Whisper) expect. Optionally only a section.
   */
  async extractAudio(
    original: string,
    output: string,
    track: number,
    section: { start?: number; duration?: number } = {},
  ) {
    await runFile(
      this.ffmpeg,
      [
        '-nostdin',
        '-v',
        'error',
        '-y',
        '-protocol_whitelist',
        'file,pipe',
        ...(section.start ? ['-ss', Math.max(0, section.start).toFixed(3)] : []),
        '-i',
        original,
        ...(section.duration ? ['-t', section.duration.toFixed(3)] : []),
        '-map',
        `0:a:${track}`,
        '-ac',
        '1',
        '-ar',
        '16000',
        '-c:a',
        'pcm_s16le',
        output,
      ],
      120000,
    );
    return output;
  }
  /**
   * Levels of an audio track in dBFS: mean and peak. A track peaking below about −70 dB is
   * silent — for example a microphone that was off although the track exists.
   */
  async audioLevels(original: string, track: number) {
    const log = await runFile(
      this.ffmpeg,
      [
        '-nostdin',
        '-v',
        'info',
        '-protocol_whitelist',
        'file,pipe',
        '-i',
        original,
        '-map',
        `0:a:${track}`,
        '-af',
        'volumedetect',
        '-f',
        'null',
        '-',
      ],
      120000,
      'stderr',
    );
    const level = (name: string) => {
      const match = new RegExp(`${name}:\\s*(-?[\\d.]+|-inf) dB`).exec(log);
      return !match || match[1] === '-inf' ? -Infinity : Number(match[1]);
    };
    return { mean: level('mean_volume'), max: level('max_volume') };
  }
  /**
   * One audio track as 16 kHz samples, one array per channel (at most two). A mono microphone
   * often sits on only one channel of a stereo track; with separate channels the loud one can
   * be used instead of averaging both and losing 6 dB.
   */
  async pcm(original: string, track: number, channels: number): Promise<Float32Array[]> {
    const count = Math.min(2, Math.max(1, channels));
    const child = spawn(
      this.ffmpeg,
      [
        '-nostdin',
        '-v',
        'error',
        '-protocol_whitelist',
        'file,pipe',
        '-i',
        original,
        '-map',
        `0:a:${track}`,
        '-ac',
        String(count),
        '-ar',
        '16000',
        '-f',
        'f32le',
        'pipe:1',
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let failure: Error | undefined;
    child.once('error', (error) => (failure = error));
    const closed = new Promise<number | null>((done) => child.once('close', done));
    let log = '';
    child.stderr?.on('data', (text: Buffer) => (log = (log + text.toString()).slice(-2000)));
    const parts: Buffer[] = [];
    for await (const chunk of child.stdout as AsyncIterable<Buffer>) parts.push(chunk);
    const code = await closed;
    if (failure) throw failure;
    if (code !== 0) throw new Error(`FFmpeg stopped while reading audio: ${log.trim() || code}`);
    // Copy into its own memory block: Float32Array needs an offset divisible by four.
    const bytes = new Uint8Array(Buffer.concat(parts));
    const samples = new Float32Array(bytes.buffer, 0, bytes.length >> 2);
    if (count === 1) return [samples];
    const length = samples.length >> 1;
    const left = new Float32Array(length);
    const right = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      left[i] = samples[2 * i];
      right[i] = samples[2 * i + 1];
    }
    return [left, right];
  }
  /**
   * Frames as raw RGB pixels, one after another, for text recognition without an image library.
   * `fps` frames per second at `width` pixels; each is labelled with the middle of its interval
   * in seconds, like the analysis frames. FFmpeg waits while a frame is being processed.
   */
  async *rawFrames(
    original: string,
    options: { fps: number; width: number; start?: number; signal?: AbortSignal },
  ): AsyncGenerator<{ seconds: number; frame: { width: number; height: number; data: Buffer } }> {
    const meta = await this.probe(original);
    const width = Math.min(options.width, meta.width) & ~1;
    const height = Math.max(2, Math.round((meta.height * width) / meta.width / 2) * 2);
    const size = width * height * 3;
    const start = options.start ?? 0;
    if (options.signal?.aborted) return;
    const child = spawn(
      this.ffmpeg,
      [
        '-nostdin',
        '-v',
        'error',
        '-protocol_whitelist',
        'file,pipe',
        ...(start > 0 ? ['-ss', start.toFixed(3)] : []),
        '-i',
        original,
        '-vf',
        `fps=${options.fps}:start_time=0,scale=${width}:${height}`,
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgb24',
        'pipe:1',
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    // Without a listener a failed start (FFmpeg missing or blocked) would hit the whole client
    // as an uncaught error.
    let failure: Error | undefined;
    child.once('error', (error) => (failure = error));
    const closed = new Promise<number | null>((done) => child.once('close', done));
    let log = '';
    child.stderr?.on('data', (text: Buffer) => (log = (log + text.toString()).slice(-2000)));
    const stop = () => child.kill();
    options.signal?.addEventListener('abort', stop);
    // Collect chunks and join them once per frame instead of copying on every 64 KB chunk.
    const parts: Buffer[] = [];
    let buffered = 0;
    let index = 0;
    try {
      for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
        parts.push(chunk);
        buffered += chunk.length;
        while (buffered >= size) {
          const all = parts.length === 1 ? parts[0] : Buffer.concat(parts, buffered);
          const rest = all.subarray(size);
          parts.length = 0;
          if (rest.length) parts.push(rest);
          buffered = rest.length;
          yield {
            seconds: Math.min(meta.duration, start + (index++ + 0.5) / options.fps),
            frame: { width, height, data: all.subarray(0, size) },
          };
        }
      }
      const code = await closed;
      if (options.signal?.aborted) return;
      if (failure) throw failure;
      // If decoding aborts, this would otherwise look like a clip without text.
      if (code !== 0) throw new Error(`FFmpeg stopped while reading frames: ${log.trim() || code}`);
    } finally {
      options.signal?.removeEventListener('abort', stop);
      if (child.exitCode === null) child.kill();
    }
  }
  /** Frames from the section that holds the actual moment of an instant replay. */
  private async sample(
    original: string,
    folder: string,
    prefix: string,
    start: number,
    span: number,
    count: number,
    duration: number,
  ) {
    const interval = Math.max(0.25, span / count);
    await runFile(
      this.ffmpeg,
      [
        '-nostdin',
        '-v',
        'error',
        '-y',
        '-protocol_whitelist',
        'file,pipe',
        ...(start > 0 ? ['-ss', start.toFixed(3)] : []),
        '-i',
        original,
        '-t',
        span.toFixed(3),
        '-vf',
        `fps=1/${interval}:start_time=0,scale=${FRAME_WIDTH}:-2`,
        '-frames:v',
        String(count),
        '-q:v',
        '5',
        join(folder, `${prefix}%03d.jpg`),
      ],
      120000,
    );
    const pattern = new RegExp(`^${prefix}\\d{3}\\.jpg$`);
    const names = (await readdir(folder)).filter((n) => pattern.test(n)).sort();
    return Promise.all(
      names.map(async (name, i) => ({
        // The fps filter rounds to the nearest output frame and delivers, per interval, the frame
        // from its middle. The label used to be the start of the interval — events, timestamps and
        // the focus frame were half a step too early, 5.6 s at the start of a clip
        // (.docs/05-experimente.md, E18, side finding).
        seconds: Math.min(duration, start + (i + 0.5) * interval),
        base64: (await readFile(join(folder, name))).toString('base64'),
      })),
    );
  }
  /**
   * A single full-resolution frame as evidence for the summary. The analysis frames
   * use FRAME_WIDTH; here the readability of killfeed and messages counts (.docs/06-recherche.md:
   * 1280 px cost the same tokens as 640, 1920 px almost twice as many — hence only one frame).
   */
  async frameAt(original: string, directory: string, seconds: number) {
    const file = join(directory, 'focus.jpg');
    await runFile(this.ffmpeg, [
      '-nostdin',
      '-v',
      'error',
      '-y',
      '-protocol_whitelist',
      'file,pipe',
      '-ss',
      Math.max(0, seconds).toFixed(3),
      '-i',
      original,
      '-frames:v',
      '1',
      '-vf',
      "scale=w='min(1920,iw)':h=-2",
      '-q:v',
      '3',
      file,
    ]);
    return (await readFile(file)).toString('base64');
  }
  async frames(
    original: string,
    directory: string,
    duration: number,
    count = 48,
    /** Spacing in seconds: evenly across the whole clip instead of focusing on the end. */
    spacing?: number,
  ) {
    const folder = join(directory, 'frames');
    await mkdir(folder, { recursive: true });
    // Overlays like the R6 killfeed stay for about five seconds; a frame every three seconds
    // catches each of them, even mid-round. Short clips still get at least `count` frames,
    // long ones at most MAX_EVEN_FRAMES.
    if (spacing)
      return this.sample(
        original,
        folder,
        'even',
        0,
        duration,
        Math.min(MAX_EVEN_FRAMES, Math.max(count, Math.ceil(duration / spacing))),
        duration,
      );
    // Recordings from NVIDIA, OBS and Game Bar end with the moment they were saved for. Two
    // thirds of the frames are therefore in the tail, the rest keeps the lead-up as context.
    // Shorter clips are all tail.
    const tailStart = Math.max(0, duration - TAIL_SECONDS);
    const tailCount = tailStart > 0 ? Math.max(1, Math.round((count * 2) / 3)) : count;
    const leadCount = count - tailCount;
    const lead = leadCount
      ? await this.sample(original, folder, 'lead', 0, tailStart, leadCount, duration)
      : [];
    const tail = await this.sample(
      original,
      folder,
      'tail',
      tailStart,
      duration - tailStart,
      tailCount,
      duration,
    );
    return [...lead, ...tail].sort((a, b) => a.seconds - b.seconds);
  }
}
