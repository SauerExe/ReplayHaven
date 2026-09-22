import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ServerConfig } from './config';
const moduleRequire = createRequire(typeof __filename === 'string' ? __filename : import.meta.url);
/** Länge des Schlussfensters, in dem der gespeicherte Moment erfahrungsgemäß liegt. */
export const TAIL_SECONDS = 30;
/** Bildbreite der Analysebilder. 640 und 1280 kosten dieselben Kontext-Token (.docs/06-recherche.md). */
const FRAME_WIDTH = 1280;
export function runFile(executable: string, args: string[], timeout = 120000): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(
      executable,
      args,
      { timeout, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        if (error)
          reject(
            new Error(
              error.killed
                ? 'Medienverarbeitung hat das Zeitlimit überschritten.'
                : 'Die Videodatei konnte nicht verarbeitet werden. Prüfe Format und FFmpeg-Installation.',
            ),
          );
        else resolve(stdout);
      },
    ),
  );
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
    const video = data.streams?.find((s: { codec_type: string }) => s.codec_type === 'video');
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
      hasAudio: data.streams.some((s: { codec_type: string }) => s.codec_type === 'audio'),
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
    if (extension !== '.mp4' || meta.codec !== 'h264') {
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
          '-map',
          '0:a:0?',
          '-c:v',
          'libx264',
          '-preset',
          'fast',
          '-crf',
          '22',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-b:a',
          '128k',
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
        ...(includeAudio ? ['-map', '0:a:0?'] : []),
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
        seconds: Math.min(duration, start + i * interval),
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
