import { expect, it } from 'vitest';
import type { NetworkInterfaceInfo } from 'node:os';
import { discoverServers, isReplayHaven, localNetworks } from './discovery';

const nic = (address: string, internal = false) =>
  ({ address, family: 'IPv4', internal }) as NetworkInterfaceInfo;

it('scans only the private networks of this PC', () => {
  expect(
    localNetworks({
      loopback: [nic('127.0.0.1', true)],
      lan: [nic('192.168.1.34')],
      vpn: [nic('10.8.0.2')],
      public: [nic('84.12.3.4')],
    }),
  ).toEqual(['192.168.1', '10.8.0']);
});

it('recognises a ReplayHaven server by its sign-in state', () => {
  expect(
    isReplayHaven({ accounts: true, setupRequired: false, passwordLogin: true, oidc: null }),
  ).toBe(true);
  expect(isReplayHaven({ status: 'ok' })).toBe(false);
  expect(isReplayHaven(null)).toBe(false);
});

it('finds the servers that answer and prefers the network address over localhost', async () => {
  const answering = new Set(['http://192.168.1.20:8787', 'http://localhost:8787']);
  const get = (async (url: string) => {
    const origin = url.replace('/api/auth/state', '');
    if (origin === 'http://192.168.1.30:8787') return Response.json({ hello: 'router' });
    if (!answering.has(origin)) throw new TypeError('fetch failed');
    return Response.json({ accounts: true, setupRequired: false, passwordLogin: true });
  }) as typeof fetch;
  expect(await discoverServers({ networks: ['192.168.1'], get })).toEqual([
    'http://192.168.1.20:8787',
  ]);
  answering.delete('http://192.168.1.20:8787');
  expect(await discoverServers({ networks: ['192.168.1'], get })).toEqual([
    'http://localhost:8787',
  ]);
});
