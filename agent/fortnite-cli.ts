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
 * Measurement tool for the Fortnite replays: shows, without AI and without upload, which account
 * is detected per replay and which events land on which clip second. The JSON output is meant for
 * comparison with hand-checked clips.
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
    'Check Fortnite replays:\nnpm run fortnite -- --clips "D:\\Clips" [--demos "…\\FortniteGame\\Saved\\Demos"] [--account EPIC-ID] [--json result.json]\nWithout --demos, %LOCALAPPDATA%\\FortniteGame\\Saved\\Demos is used.',
  );
  process.exit(values.help ? 0 : 1);
}
const replays = new FortniteReplays({ folder: resolve(demos), accounts: values.account ?? [] });
const survey = await replays.survey();
console.log(`Replays in ${resolve(demos)}: ${survey.length}`);
for (const r of survey)
  console.log(
    r.error
      ? `  ${r.file}: unreadable (${r.error})`
      : `  ${r.file}: ${r.live ? 'still recording' : `v${r.gameVersion ?? '?'}, ${r.start}, ${r.minutes} min, place ${r.placement ?? '?'}, ${r.eliminations} eliminations in the match, own per stats ${r.statsEliminations ?? '?'}`}${r.owner ? `\n    Account: ${r.owner.id ?? '—'} (${r.owner.basis.join('; ')})` : ''}`,
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
      // What the events would give as a title without the model: the fallback title.
      const heads = headline(lookup.events, Math.max(duration * 0.6, duration - 30));
      clips.push({ clip: basename(path), duration, lookup, titles: heads.map(label) });
    } catch (error) {
      clips.push({ clip: basename(path), error: error instanceof Error ? error.message : '?' });
    }
  }
  console.log(`\nFortnite clips in ${resolve(values.clips)}: ${clips.length}`);
  for (const c of clips) {
    if (c.error || !c.lookup) {
      console.log(`  ${c.clip}: error (${c.error})`);
      continue;
    }
    const { status, trace, events } = c.lookup;
    console.log(
      `  ${c.clip} (${c.duration?.toFixed(1)} s): ${status}${trace.reason ? ` — ${trace.reason}` : ''}${trace.file ? `, ${trace.file} from ${trace.clipStartInReplay} s, anchor ${trace.anchor}` : ''}`,
    );
    for (const e of events)
      console.log(
        `    ${e.seconds?.toFixed(1).padStart(6)} s  ${label(e)}${e.distance !== undefined ? ` (${Math.round(e.distance)} m)` : ''}`,
      );
    if (c.titles?.length) console.log(`    Title without AI: ${c.titles.join(' – ')}`);
  }
}
if (values.json) {
  await writeFile(resolve(values.json), JSON.stringify({ demos, survey, clips }, null, 2));
  console.log(`\nJSON: ${resolve(values.json)}`);
}
