import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
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
    pair: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});
if (values.help || (!values.folder && !values.pair)) {
  console.log(
    'Pair this machine once (an admin approves the code under Settings → Recording PCs):\nnpm run agent -- --pair --server http://127.0.0.1:8787\nThen watch an NVIDIA folder with the printed device token in REPLAYHAVEN_DEVICE_TOKEN:\nnpm run agent -- --folder "D:\\Clips" --server http://127.0.0.1:8787\nOptional: --game "VALORANT" --include-existing --state path.json\nBy default only new recordings are uploaded. The access key (REPLAYHAVEN_ACCESS_TOKEN) only works while the server has no account yet.',
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

/** The same request-and-approve pairing as the Windows client (server/auth-routes.ts). */
async function pair() {
  const post = async (path: string, body: object) => {
    const response = await fetch(`${server}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, string>;
    if (!response.ok)
      throw new Error(data.error || `The server responds with HTTP ${response.status}.`);
    return data;
  };
  const request = await post('/api/pair/request', { deviceId: randomUUID(), name: hostname() });
  console.log(
    `Code ${request.code.slice(0, 3)} ${request.code.slice(3)}: approve it under Settings → Recording PCs within ten minutes.`,
  );
  const until = Date.now() + 10 * 60000;
  while (Date.now() < until) {
    await delay(2000);
    const result = await post('/api/pair/status', { id: request.id, secret: request.secret });
    if (result.status === 'approved' && result.token) {
      console.log(
        `Paired. Keep this device token secret and set it as REPLAYHAVEN_DEVICE_TOKEN:\n${result.token}`,
      );
      return;
    }
    if (result.status === 'denied') throw new Error('The pairing was denied.');
    if (result.status === 'expired') break;
  }
  throw new Error('The request has expired. Start pairing again.');
}
if (values.pair) {
  await pair();
  process.exit(0);
}

const config = loadConfig();
const media = new MediaProcessor(config);
const agent = new FolderUploader({
  folder: resolve(values.folder!),
  server,
  token: process.env.REPLAYHAVEN_DEVICE_TOKEN || config.token,
  statePath: values.state ? resolve(values.state) : defaultStatePath(values.folder!, server),
  game: values.game!,
  includeExisting: values['include-existing']!,
  stableMs: 10000,
  probe: (path) => media.probe(path),
});
await agent.initialize();
console.log(
  `NVIDIA recording folder: ${resolve(values.folder!)}\nTarget: ${server}\nOriginal files are neither moved nor deleted.`,
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
