import { parseArgs } from 'node:util';
import { mkdir, stat } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { micTrack } from './audio';
import { listVideos } from './watcher';
import { MediaProcessor } from '../server/media';
import { loadConfig } from '../server/config';

/**
 * Audio track checker: lists the tracks of each recording with their levels and the detected
 * microphone track. With --out it writes each track as WAV (mono, 16 kHz) for listening.
 */
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
});
if (values.help || !positionals.length) {
  console.log(
    'Check audio tracks:\nnpm run audio -- "D:\\Clips\\Fortnite\\clip.mp4" ["D:\\Clips\\Valorant"] [--out "D:\\AudioTracks"]\nFolders are searched including subfolders. --out writes each track as WAV for listening.',
  );
  process.exit(values.help ? 0 : 1);
}
const media = new MediaProcessor(loadConfig());
const files: string[] = [];
for (const input of positionals) {
  const path = resolve(input);
  files.push(...((await stat(path)).isDirectory() ? await listVideos(path) : [path]));
}
if (values.out) await mkdir(resolve(values.out), { recursive: true });
let separate = 0;
for (const file of files) {
  try {
    const { audio, duration } = await media.probe(file);
    const levels = new Map<number, { mean: number; max: number }>();
    for (const t of audio) levels.set(t.index, await media.audioLevels(file, t.index));
    const mic = micTrack(audio, levels);
    if (mic.track !== undefined) separate++;
    console.log(`${basename(file)} (${duration.toFixed(1)} s): ${audio.length} audio track(s)`);
    for (const t of audio) {
      const level = levels.get(t.index)!;
      console.log(
        `  Track ${t.index + 1}: ${t.codec}, ${t.channels} channel(s), ${t.sampleRate} Hz${t.title ? `, "${t.title}"` : ''}, level mean ${level.mean} dB, peak ${level.max} dB${t.index === mic.track ? '  ← microphone' : ''}`,
      );
      if (values.out)
        await media.extractAudio(
          file,
          join(
            resolve(values.out),
            `${basename(file, extname(file))}.track${t.index + 1}${t.index === mic.track ? '.mic' : ''}.wav`,
          ),
          t.index,
        );
    }
    console.log(
      `  Microphone: ${mic.track === undefined ? '—' : `track ${mic.track + 1}`} (${mic.basis})`,
    );
  } catch (error) {
    console.log(`${basename(file)}: ${error instanceof Error ? error.message : 'not readable'}`);
  }
}
console.log(`\n${files.length} recordings, ${separate} with a separate microphone track.`);
