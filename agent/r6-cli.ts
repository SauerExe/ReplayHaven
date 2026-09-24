import { parseArgs } from 'node:util';
import { stat, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { ClipTexts, isR6 } from './r6';
import { developmentModels, joinRows, TextReader } from './ocr';
import { gameLabel, listVideos } from './watcher';
import { MediaProcessor } from '../server/media';
import { loadConfig } from '../server/config';

/**
 * Messwerkzeug für die R6-Texterkennung: liest je Clip Karte und Rundenausgang, ohne KI und
 * ohne Upload. Mit --rows schreibt es alle gelesenen Zeilen je Bild in die JSON-Ausgabe, um
 * Fehlgriffe nachzuvollziehen.
 */
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    json: { type: 'string' },
    rows: { type: 'boolean', default: false },
    fps: { type: 'string', default: '2' },
    help: { type: 'boolean', default: false },
  },
});
if (values.help || !positionals.length) {
  console.log(
    'R6-Texterkennung prüfen:\nnpm run r6 -- "D:\\Clips\\Tom Clancy\'s Rainbow Six Siege" [weitere Clips oder Ordner] [--json ergebnis.json] [--rows] [--fps 2]',
  );
  process.exit(values.help ? 0 : 1);
}
const media = new MediaProcessor(loadConfig());
const models = developmentModels();
const fps = Number(values.fps) || 2;
const texts = new ClipTexts({ media, models, fps });
const files: string[] = [];
for (const input of positionals) {
  const path = resolve(input);
  files.push(...((await stat(path)).isDirectory() ? await listVideos(path) : [path]));
}
const results: unknown[] = [];
const reader = values.rows ? await TextReader.load(models) : undefined;
for (const path of files) {
  // Wie im Client: das Spiel kommt aus dem Ordner. Einzeln übergebene Clips gelten als R6.
  const game = isR6(gameLabel('', path)) ? gameLabel('', path) : 'Rainbow Six';
  try {
    const found = await texts.forClip(path, game, new AbortController().signal);
    if (!found) continue;
    console.log(
      `${basename(path)}: Karte ${found.map ?? '—'}, ${found.events.length} Ergebnis(se), ${found.trace.frames} Bilder in ${found.trace.seconds} s`,
    );
    for (const e of found.events)
      console.log(`  ${e.seconds?.toFixed(1).padStart(6)} s  ${e.kind}  "${e.text}"`);
    const rows: { seconds: number; rows: string[] }[] = [];
    if (reader)
      for await (const { seconds, frame } of media.rawFrames(path, { fps, width: 1280 }))
        rows.push({
          seconds,
          rows: joinRows(await reader.read(frame)).map((r) => `${r.text} (${r.score.toFixed(2)})`),
        });
    results.push({ clip: basename(path), ...found, ...(reader ? { rows } : {}) });
  } catch (error) {
    console.log(`${basename(path)}: Fehler (${error instanceof Error ? error.message : '?'})`);
    results.push({ clip: basename(path), error: error instanceof Error ? error.message : '?' });
  }
}
await Promise.all([reader?.close(), texts.close()]);
if (values.json) {
  await writeFile(resolve(values.json), JSON.stringify(results, null, 2));
  console.log(`\nJSON: ${resolve(values.json)}`);
}
