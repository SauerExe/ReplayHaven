import { execFile, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ServerConfig } from './config';
const moduleRequire = createRequire(typeof __filename === 'string' ? __filename : import.meta.url);
/** Länge des Schlussfensters, in dem der gespeicherte Moment erfahrungsgemäß liegt. */
export const TAIL_SECONDS = 30;
/** Bildbreite der Analysebilder. 640 und 1280 kosten dieselben Kontext-Token (.docs/06-recherche.md). */
const FRAME_WIDTH = 1280;
export function runFile(
  executable: string,
  args: string[],
  timeout = 120000,
  output: 'stdout' | 'stderr' = 'stdout',
): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(
      executable,
      args,
      { timeout, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (error)
          reject(
            new Error(
              error.killed
                ? 'Medienverarbeitung hat das Zeitlimit überschritten.'
                : 'Die Videodatei konnte nicht verarbeitet werden. Prüfe Format und FFmpeg-Installation.',
            ),
          );
        else resolve(output === 'stderr' ? stderr : stdout);
      },
    ),
  );
}
/** Eine Tonspur der Aufnahme. */
export interface AudioTrack {
  /** Nummer unter den Tonspuren, wie FFmpeg sie mit -map 0:a:N anspricht. */
  index: number;
  codec: string;
  channels: number;
  sampleRate: number;
  /** Titel oder Handler-Name aus der Datei, leer, wenn nichts gesetzt ist. */
  title: string;
}
/**
 * Mischt alle Tonspuren zu einer. Nimmt die NVIDIA App das Mikrofon als eigene Spur auf, spielt
 * ein Browser sonst nur die erste Spur ab und deine Stimme fehlt. normalize=0 hält die Pegel,
 * statt jede Spur durch die Zahl der Spuren zu teilen; der Begrenzer fängt Spitzen ab, wenn
 * Spielton und Stimme zugleich laut sind.
 */
function mixedAudio(tracks: number) {
  const inputs = Array.from({ length: tracks }, (_, i) => `[0:a:${i}]`).join('');
  return [
    '-filter_complex',
    `${inputs}amix=inputs=${tracks}:duration=longest:normalize=0,alimiter=limit=0.95:level=0[mixed]`,
    '-map',
    '[mixed]',
  ];
}
export class MediaProcessor {
  readonly ffmpeg: string;
  readonly ffprobe: string;
  constructor(config: Pick<ServerConfig, 'ffmpeg' | 'ffprobe'>) {
    this.ffmpeg = config.ffmpeg || (moduleRequire('ffmpeg-static') as string | null) || 'ffmpeg';
    this.ffprobe =
      config.ffprobe || (moduleRequire('@ffprobe-installer/ffprobe') as { path: string }).path;
  }
  async probe(path: string) {
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
        // MP4 speichert Spurnamen als Handler-Namen; die Vorgaben der Muxer sagen nichts.
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
      throw new Error(
        'Wähle ein lesbares Video mit maximal 30 Minuten Länge und höchstens 8K Auflösung.',
      );
    return {
      duration,
      width: Number(video.width),
      height: Number(video.height),
      codec: String(video.codec_name),
      hasAudio: audio.length > 0,
      audio,
    };
  }
  async prepare(original: string, directory: string, extension: string) {
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
    let playbackFile = original;
    const playable = extension === '.mp4' && meta.codec === 'h264';
    // Mehrere Tonspuren: Das Bild bleibt, wenn es abspielbar ist; nur der Ton wird gemischt.
    if (!playable || meta.audio.length > 1) {
      playbackFile = join(directory, 'playback.mp4');
      await runFile(
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
          ...(meta.audio.length > 1 ? mixedAudio(meta.audio.length) : ['-map', '0:a:0?']),
          ...(playable
            ? ['-c:v', 'copy']
            : ['-c:v', 'libx264', '-preset', 'fast', '-crf', '22', '-pix_fmt', 'yuv420p']),
          '-c:a',
          'aac',
          '-b:a',
          meta.audio.length > 1 ? '160k' : '128k',
          '-movflags',
          '+faststart',
          '-threads',
          '2',
          playbackFile,
        ],
        30 * 60000,
      );
    }
    return { ...meta, playbackFile };
  }
  async analysisVideo(original: string, directory: string, includeAudio: boolean) {
    const output = join(directory, 'analysis.mp4');
    const tracks = includeAudio ? (await this.probe(original)).audio.length : 0;
    await runFile(
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
        ...(tracks > 1 ? mixedAudio(tracks) : includeAudio ? ['-map', '0:a:0?'] : []),
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
    return output;
  }
  /**
   * Löst eine Tonspur als WAV heraus, mono mit 16 kHz — das Format, das Klangerkennung (YAMNet)
   * und Spracherkennung (Whisper) erwarten. Optional nur ein Abschnitt.
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
   * Pegel einer Tonspur in dBFS: Mittel und Spitze. Eine Spur mit Spitze unter etwa −70 dB ist
   * stumm — etwa ein Mikrofon, das aus war, obwohl die Spur existiert.
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
   * Bilder als rohe RGB-Pixel, eins nach dem anderen, für Texterkennung ohne Bildbibliothek.
   * `fps` Bilder je Sekunde in `width` Pixeln Breite; jedes trägt die Mitte seines Abschnitts
   * als Sekunde, wie die Analysebilder. FFmpeg wartet, solange ein Bild verarbeitet wird.
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
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const stop = () => child.kill();
    options.signal?.addEventListener('abort', stop);
    let pending: Buffer = Buffer.alloc(0);
    let index = 0;
    try {
      for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
        pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
        while (pending.length >= size) {
          const data = Buffer.from(pending.subarray(0, size));
          pending = pending.subarray(size);
          yield {
            seconds: Math.min(meta.duration, start + (index++ + 0.5) / options.fps),
            frame: { width, height, data },
          };
        }
      }
    } finally {
      options.signal?.removeEventListener('abort', stop);
      if (child.exitCode === null) child.kill();
    }
  }
  /** Bildausschnitt, der bei Instant-Replay den eigentlichen Moment enthält. */
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
        // Der fps-Filter rundet auf das nächste Ausgabebild und liefert je Abschnitt das Bild aus
        // dessen Mitte. Beschriftet war der Abschnittsanfang — Ereignisse, Zeitmarken und das
        // Fokusbild lagen dadurch einen halben Schritt zu früh, am Clipanfang 5,6 s
        // (.docs/05-experimente.md, E18, Nebenbefund).
        seconds: Math.min(duration, start + (i + 0.5) * interval),
        base64: (await readFile(join(folder, name))).toString('base64'),
      })),
    );
  }
  /**
   * Ein einzelnes Bild in voller Auflösung als Beleg für die Zusammenfassung. Die Analysebilder
   * laufen mit FRAME_WIDTH, hier zählt Lesbarkeit von Killfeed und Meldungen (.docs/06-recherche.md:
   * 1280 px kosten dieselben Token wie 640, 1920 px knapp das Doppelte — deshalb nur ein Bild).
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
  async frames(original: string, directory: string, duration: number, count = 48) {
    const folder = join(directory, 'frames');
    await mkdir(folder, { recursive: true });
    // Aufnahmen aus NVIDIA, OBS und Game Bar enden mit dem Moment, für den sie gespeichert
    // wurden. Zwei Drittel der Bilder liegen deshalb im Schluss, der Rest hält den Vorlauf
    // als Kontext fest. Kürzere Clips sind komplett Schluss.
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
