import { networkInterfaces } from 'node:os';

/**
 * Finds ReplayHaven servers in the home network, so setup needs no typed address. It asks every
 * address of the PC's own /24 networks on the default port. mDNS would not get out of a Docker
 * container with port mapping, a plain HTTP probe does. Servers behind a domain or another port
 * are not found; for those the pairing link from the web interface does the job.
 */
export const DEFAULT_PORT = 8787;

/** The /24 networks of the PC's private IPv4 addresses, e.g. "192.168.1". */
export function localNetworks(interfaces = networkInterfaces()) {
  const prefixes = new Set<string>();
  for (const list of Object.values(interfaces))
    for (const address of list ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      const [a, b] = address.address.split('.').map(Number);
      const home = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
      if (home) prefixes.add(address.address.split('.').slice(0, 3).join('.'));
    }
  return [...prefixes].slice(0, 4);
}

/** Whether an answer of GET /api/auth/state comes from ReplayHaven. */
export function isReplayHaven(body: unknown) {
  const state = body as Record<string, unknown> | null;
  return (
    !!state &&
    state.accounts === true &&
    typeof state.setupRequired === 'boolean' &&
    'passwordLogin' in state
  );
}

export async function discoverServers(
  options: {
    networks?: string[];
    port?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
    get?: typeof fetch;
  } = {},
) {
  const {
    networks = localNetworks(),
    port = DEFAULT_PORT,
    timeoutMs = 800,
    signal,
    get = (...args) => fetch(...args),
  } = options;
  const candidates = [
    `http://localhost:${port}`,
    ...networks.flatMap((net) =>
      Array.from({ length: 254 }, (_, i) => `http://${net}.${i + 1}:${port}`),
    ),
  ];
  const found: string[] = [];
  // Enough in parallel that a whole network takes a few seconds, not a minute.
  let next = 0;
  const worker = async () => {
    while (next < candidates.length && !signal?.aborted) {
      const origin = candidates[next++];
      try {
        const response = await get(`${origin}/api/auth/state`, {
          signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]),
        });
        if (response.ok && isReplayHaven(await response.json())) found.push(origin);
      } catch {
        // Nothing there, or something else.
      }
    }
  };
  await Promise.all(Array.from({ length: 64 }, worker));
  // The same PC can answer as localhost and by its network address; the network address is the
  // one that also works after a restart of the server under another name.
  const lan = found.filter((o) => !o.includes('localhost'));
  return (lan.length ? lan : found).sort();
}
