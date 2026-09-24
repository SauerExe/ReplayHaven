import { parseArgs } from 'node:util';
import { stat, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { micTrack } from './audio';
import { ensureModel, findMoments, LaughDetector, modelFolder, monoFrom } from './laughs';
import type { Moment, WindowScore } from './laughs';
import { listVideos } from './watcher';
import { MediaProcessor } from '../server/media';
import { loadConfig } from '../server/config';

/**
 * Messwerkzeug für Stufe 1 aus docs/TON-KONZEPT.md: listet je Aufnahme Lacher und Rufe in der
 * Mikrofonspur, mit Zeit und Stärke, und die Rechenzeit. Braucht weder KI noch Upload; die
 * Analyse ändert sich dadurch nicht.
 */
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    json: { type: 'string' },
    scores: { type: 'string' },
    threshold: { type: 'string' },
    track: { type: 'string' },
    models: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
});
if (values.help || !positionals.length) {
  console.log(
    'Lacher und Rufe finden (YAMNet, nur Messung):\nnpm run laughs -- "D:\\Clips" [weitere Clips oder Ordner] [--json lacher.json] [--scores fenster.csv] [--threshold 0.3] [--track 2]\nOhne --track zählt die erkannte Mikrofonspur; Clips ohne eigene Mikrofonspur werden übersprungen. --scores schreibt die Werte jedes Fensters zum Kalibrieren der Schwelle. Das Modell (16 MB) wird beim ersten Lauf geladen und geprüft.',
  );
  process.exit(values.help ? 0 : 1);
}
const threshold = values.threshold ? Number(values.threshold) : 0.3;
if (!(threshold > 0 && threshold < 1)) {
  console.log('--threshold braucht eine Zahl zwischen 0 und 1, etwa 0.3.');
  process.exit(1);
}
const chosen = values.track ? Number(values.track) - 1 : undefined;
if (chosen !== undefined && !(Number.isInteger(chosen) && chosen >= 0)) {
  console.log('--track braucht die Nummer der Spur wie bei npm run audio, beginnend mit 1.');
  process.exit(1);
}

const media = new MediaProcessor(loadConfig());
const model = await ensureModel(values.models ?? modelFolder(), undefined, fetch, () =>
  console.log('YAMNet wird geladen (16 MB) und geprüft …'),
);
const detector = await LaughDetector.load(model);
const files: string[] = [];
for (const input of positionals) {
  const path = resolve(input);
  files.push(...((await stat(path)).isDirectory() ? await listVideos(path) : [path]));
}

const decimal = (value: number, digits: number) => value.toFixed(digits).replace('.', ',');
const seconds = (value: number) => decimal(value, 1);
const label = { laugh: 'Lachen', shout: 'Rufen' } as const;
const results: unknown[] = [];
const rows = ['clip;sekunde;lachen;rufen;sprache'];
let audioSeconds = 0;
let cpuSeconds = 0;
let measured = 0;
let laughing = 0;
for (const file of files) {
  try {
    const { audio, duration } = await media.probe(file);
    let track = chosen;
    let basis = 'mit --track gewählt';
    if (track === undefined) {
      const levels = new Map<number, { mean: number; max: number }>();
      for (const t of audio) levels.set(t.index, await media.audioLevels(file, t.index));
      const mic = micTrack(audio, levels);
      track = mic.track;
      basis = mic.basis;
    }
    const info = audio.find((t) => t.index === track);
    if (track === undefined || !info) {
      console.log(`${basename(file)}: übersprungen, keine eigene Mikrofonspur (${basis})`);
      results.push({ clip: basename(file), skipped: basis });
      continue;
    }
    const { samples, channel } = monoFrom(await media.pcm(file, track, info.channels));
    const cpu = process.cpuUsage();
    const started = performance.now();
    const windows: WindowScore[] = await detector.scores(samples);
    const used = process.cpuUsage(cpu);
    const cpuTime = (used.user + used.system) / 1e6;
    const moments: Moment[] = [
      ...findMoments(windows, 'laugh', threshold),
      ...findMoments(windows, 'shout', threshold),
    ].sort((a, b) => a.start - b.start);
    const speech = windows.length
      ? windows.filter((w) => w.speech >= 0.5).length / windows.length
      : 0;
    const laughs = moments.filter((m) => m.kind === 'laugh').length;
    const peak = Math.max(0, ...windows.map((w) => w.laugh));
    measured++;
    if (laughs) laughing++;
    audioSeconds += samples.length / 16000;
    cpuSeconds += cpuTime;
    console.log(
      `${basename(file)} (${seconds(duration)} s, Spur ${track + 1}, Kanal ${channel}): ${laughs} Lacher, ${moments.length - laughs} Rufe, höchster Lachwert ${decimal(peak, 2)}, Sprache in ${Math.round(speech * 100)} % der Fenster, ${seconds(cpuTime)} s CPU`,
    );
    for (const m of moments)
      console.log(
        `  ${seconds(m.start).padStart(7)}–${seconds(m.end)} s  ${label[m.kind]}  ${decimal(m.peak, 2)}`,
      );
    results.push({
      clip: basename(file),
      track: track + 1,
      trackBasis: basis,
      channel,
      duration,
      cpuSeconds: Number(cpuTime.toFixed(2)),
      wallSeconds: Number(((performance.now() - started) / 1000).toFixed(2)),
      speechShare: Number(speech.toFixed(3)),
      peakLaugh: Number(peak.toFixed(3)),
      moments,
    });
    for (const w of windows)
      rows.push(
        [basename(file), w.seconds, w.laugh, w.shout, w.speech]
          .map((v) => (typeof v === 'number' ? decimal(v, 3) : v))
          .join(';'),
      );
  } catch (error) {
    console.log(`${basename(file)}: Fehler (${error instanceof Error ? error.message : '?'})`);
    results.push({ clip: basename(file), error: error instanceof Error ? error.message : '?' });
  }
}
await detector.close();
console.log(
  `\n${files.length} Aufnahmen, ${measured} mit Mikrofonspur gemessen, ${laughing} mit Lacher (Schwelle ${decimal(threshold, 2)}).`,
);
if (audioSeconds > 0)
  console.log(
    `Rechenzeit: ${seconds((cpuSeconds / audioSeconds) * 60)} s CPU je Minute Mikrofonspur.`,
  );
if (values.json) {
  await writeFile(resolve(values.json), JSON.stringify({ threshold, results }, null, 2));
  console.log(`JSON: ${resolve(values.json)}`);
}
if (values.scores) {
  await writeFile(resolve(values.scores), `${rows.join('\n')}\n`);
  console.log(`Fensterwerte: ${resolve(values.scores)}`);
}
