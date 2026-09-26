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
    'Watch an NVIDIA folder:\nnpm run agent -- --folder "D:\\Clips" --server http://127.0.0.1:8787\nOptional: --game "VALORANT" --include-existing --state path.json\nSet the access token via REPLAYHAVEN_ACCESS_TOKEN. By default only new recordings are uploaded.',
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
  throw new Error('Use an HTTP(S) server address without embedded credentials.');
if (
  url.protocol === 'http:' &&
  !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
  !values['allow-http']
)
  throw new Error(
    'Use HTTPS for remote servers; on your own LAN, --allow-http is explicitly allowed.',
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
  `NVIDIA recording folder: ${resolve(values.folder)}\nTarget: ${server}\nOriginal files are neither moved nor deleted.`,
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
    console.error('Folder or server not reachable. Retrying automatically.');
  }
  if (!stopped) await delay(3000);
}
