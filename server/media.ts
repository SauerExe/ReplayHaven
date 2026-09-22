import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ServerConfig } from './config';
const moduleRequire = createRequire(typeof __filename === 'string' ? __filename : import.meta.url);
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
  async frames(original: string, directory: string, duration: number, count = 48) {
    const folder = join(directory, 'frames');
    await mkdir(folder, { recursive: true });
    const interval = Math.max(0.25, duration / count);
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
        '-vf',
        `fps=1/${interval}:start_time=0,scale=640:-2`,
        '-frames:v',
        String(count),
        '-q:v',
        '5',
        join(folder, '%03d.jpg'),
      ],
      120000,
    );
    const names = (await readdir(folder)).filter((n) => /^\d{3}\.jpg$/.test(n)).sort();
    return Promise.all(
      names.map(async (name, i) => ({
        seconds: Math.min(duration, i * interval),
        base64: (await readFile(join(folder, name))).toString('base64'),
      })),
    );
  }
}
