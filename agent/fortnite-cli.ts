import { parseArgs } from 'node:util';
import { stat, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { defaultDemosFolder, FortniteReplays, isFortnite } from './fortnite';
import type { ReplayLookup } from './fortnite';
import { headline } from './events';
import { label } from './wording';
import { gameLabel, listVideos } from './watcher';
import { MediaProcessor } from '../server/media';
import { loadConfig } from '../server/config';

/**
 * Messwerkzeug für die Fortnite-Replays: zeigt ohne KI und ohne Upload, welches Konto je Replay
 * erkannt wird und welche Ereignisse auf welche Clipsekunde fallen. Die JSON-Ausgabe ist für
 * den Abgleich mit den von Hand geprüften Clips gedacht.
 */
const { values } = parseArgs({
  options: {
    demos: { type: 'string' },
    clips: { type: 'string' },
    account: { type: 'string', multiple: true },
    json: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
});
const demos = values.demos ?? defaultDemosFolder();
if (values.help || !demos) {
  console.log(
    'Fortnite-Replays prüfen:\nnpm run fortnite -- --clips "D:\\Clips" [--demos "…\\FortniteGame\\Saved\\Demos"] [--account EPIC-ID] [--json ergebnis.json]\nOhne --demos gilt %LOCALAPPDATA%\\FortniteGame\\Saved\\Demos.',
  );
  process.exit(values.help ? 0 : 1);
}
const replays = new FortniteReplays({ folder: resolve(demos), accounts: values.account ?? [] });
const survey = await replays.survey();
console.log(`Replays in ${resolve(demos)}: ${survey.length}`);
for (const r of survey)
  console.log(
    r.error
      ? `  ${r.file}: unlesbar (${r.error})`
      : `  ${r.file}: ${r.live ? 'nimmt noch auf' : `v${r.gameVersion ?? '?'}, ${r.start}, ${r.minutes} min, Platz ${r.placement ?? '?'}, ${r.eliminations} Eliminierungen im Match, eigene laut Statistik ${r.statsEliminations ?? '?'}`}${r.owner ? `\n    Konto: ${r.owner.id ?? '—'} (${r.owner.basis.join('; ')})` : ''}`,
  );
const clips: {
  clip: string;
  duration?: number;
  lookup?: ReplayLookup;
  titles?: string[];
  error?: string;
}[] = [];
if (values.clips) {
  const media = new MediaProcessor(loadConfig());
  for (const path of await listVideos(resolve(values.clips))) {
    if (!isFortnite(gameLabel('', path))) continue;
    try {
      const { duration } = await media.probe(path);
      const lookup = await replays.lookup(path, duration, (await stat(path)).mtimeMs);
      // Was als Titel aus den Ereignissen folgen würde, ohne das Modell: der Ersatztitel.
      const heads = headline(lookup.events, Math.max(duration * 0.6, duration - 30));
      clips.push({ clip: basename(path), duration, lookup, titles: heads.map(label) });
    } catch (error) {
      clips.push({ clip: basename(path), error: error instanceof Error ? error.message : '?' });
    }
  }
  console.log(`\nFortnite-Clips in ${resolve(values.clips)}: ${clips.length}`);
  for (const c of clips) {
    if (c.error || !c.lookup) {
      console.log(`  ${c.clip}: Fehler (${c.error})`);
      continue;
    }
    const { status, trace, events } = c.lookup;
    console.log(
      `  ${c.clip} (${c.duration?.toFixed(1)} s): ${status}${trace.reason ? ` — ${trace.reason}` : ''}${trace.file ? `, ${trace.file} ab ${trace.clipStartInReplay} s, Anker ${trace.anchor}` : ''}`,
    );
    for (const e of events)
      console.log(
        `    ${e.seconds?.toFixed(1).padStart(6)} s  ${label(e)}${e.distance !== undefined ? ` (${Math.round(e.distance)} m)` : ''}`,
      );
    if (c.titles?.length) console.log(`    Titel ohne KI: ${c.titles.join(' – ')}`);
  }
}
if (values.json) {
  await writeFile(resolve(values.json), JSON.stringify({ demos, survey, clips }, null, 2));
  console.log(`\nJSON: ${resolve(values.json)}`);
}
