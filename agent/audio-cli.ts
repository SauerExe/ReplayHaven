import { parseArgs } from 'node:util';
import { mkdir, stat } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { micTrack } from './audio';
import { listVideos } from './watcher';
import { MediaProcessor } from '../server/media';
import { loadConfig } from '../server/config';

/**
 * Prüfwerkzeug für Tonspuren: listet je Aufnahme die Spuren mit Pegel und die erkannte
 * Mikrofonspur. Mit --out schreibt es jede Spur als WAV (mono, 16 kHz) zum Anhören.
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
    'Tonspuren prüfen:\nnpm run audio -- "D:\\Clips\\Fortnite\\clip.mp4" ["D:\\Clips\\Valorant"] [--out "D:\\Tonspuren"]\nOrdner werden mit Unterordnern durchsucht. --out schreibt jede Spur als WAV zum Anhören.',
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
    console.log(`${basename(file)} (${duration.toFixed(1)} s): ${audio.length} Tonspur(en)`);
    for (const t of audio) {
      const level = levels.get(t.index)!;
      console.log(
        `  Spur ${t.index + 1}: ${t.codec}, ${t.channels} Kanal/Kanäle, ${t.sampleRate} Hz${t.title ? `, "${t.title}"` : ''}, Pegel Mittel ${level.mean} dB, Spitze ${level.max} dB${t.index === mic.track ? '  ← Mikrofon' : ''}`,
      );
      if (values.out)
        await media.extractAudio(
          file,
          join(
            resolve(values.out),
            `${basename(file, extname(file))}.spur${t.index + 1}${t.index === mic.track ? '.mikrofon' : ''}.wav`,
          ),
          t.index,
        );
    }
    console.log(
      `  Mikrofon: ${mic.track === undefined ? '—' : `Spur ${mic.track + 1}`} (${mic.basis})`,
    );
  } catch (error) {
    console.log(`${basename(file)}: ${error instanceof Error ? error.message : 'nicht lesbar'}`);
  }
}
console.log(`\n${files.length} Aufnahmen, ${separate} mit eigener Mikrofonspur.`);
