import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { defaultStatePath, FolderUploader } from './watcher';
import { MediaProcessor } from '../server/media';
import { loadConfig } from '../server/config';
const { values } = parseArgs({
  options: {
    folder: { type: 'string' },
    server: { type: 'string', default: 'http://127.0.0.1:8787' },
    game: { type: 'string', default: '' },
    state: { type: 'string' },
    'include-existing': { type: 'boolean', default: false },
    'allow-http': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});
if (values.help || !values.folder) {
  console.log(
    'NVIDIA-Ordner überwachen:\nnpm run agent -- --folder "D:\\Clips" --server http://127.0.0.1:8787\nOptional: --game "VALORANT" --include-existing --state pfad.json\nZugangsschlüssel über REPLAYHAVEN_ACCESS_TOKEN setzen. Standardmäßig werden nur neue Aufnahmen übertragen.',
  );
  process.exit(values.help ? 0 : 1);
}
const url = new URL(values.server!);
if (
  !['http:', 'https:'].includes(url.protocol) ||
  url.username ||
  url.password ||
  url.search ||
  url.hash
)
  throw new Error('Verwende eine HTTP(S)-Serveradresse ohne eingebettete Zugangsdaten.');
if (
  url.protocol === 'http:' &&
  !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
  !values['allow-http']
)
  throw new Error(
    'Für entfernte Server HTTPS verwenden; im eigenen LAN ist --allow-http ausdrücklich möglich.',
  );
const server = values.server!.replace(/\/$/, '');
const config = loadConfig();
const media = new MediaProcessor(config);
const agent = new FolderUploader({
  folder: resolve(values.folder),
  server,
  token: config.token,
  statePath: values.state ? resolve(values.state) : defaultStatePath(values.folder, server),
  game: values.game!,
  includeExisting: values['include-existing']!,
  stableMs: 10000,
  probe: (path) => media.probe(path),
});
await agent.initialize();
console.log(
  `NVIDIA-Aufnahmeordner: ${resolve(values.folder)}\nZiel: ${server}\nOriginaldateien werden weder verschoben noch gelöscht.`,
);
let stopped = false;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    stopped = true;
  });
while (!stopped) {
  try {
    await agent.scan();
    await agent.heartbeat();
  } catch {
    console.error('Ordner oder Server nicht erreichbar. Nächster Versuch folgt automatisch.');
  }
  if (!stopped) await delay(3000);
}
