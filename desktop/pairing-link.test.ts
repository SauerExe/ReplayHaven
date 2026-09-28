import { expect, it } from 'vitest';
import { linkIn, parsePairingLink } from './pairing-link';
import { pairingLink } from '../src/pages/settings/pairing-link';

const ticket = 'rht_abcdefghijklmnopqrstuvwxyz0123456789_-';

it('reads the link the web interface builds', () => {
  const link = pairingLink('http://192.168.1.20:8787', ticket);
  expect(parsePairingLink(link)).toEqual({ server: 'http://192.168.1.20:8787', ticket });
  expect(parsePairingLink(pairingLink('https://clips.example.com', ticket)).server).toBe(
    'https://clips.example.com',
  );
});

it('rejects anything that is not a pairing link', () => {
  for (const link of [
    'https://clips.example.com',
    `replayhaven://other?server=http%3A%2F%2Fhost&ticket=${ticket}`,
    'replayhaven://pair?server=http%3A%2F%2Fhost&ticket=short',
    `replayhaven://pair?server=file%3A%2F%2F%2Fc%3A&ticket=${ticket}`,
    `replayhaven://pair?server=http%3A%2F%2Fuser%3Apw%40host&ticket=${ticket}`,
    `replayhaven://pair?ticket=${ticket}`,
  ])
    expect(() => parsePairingLink(link), link).toThrow();
});

it('finds the link among the start arguments Windows passes', () => {
  const link = pairingLink('http://pc:8787', ticket);
  expect(linkIn(['ReplayHaven.exe', '--allow-file-access-from-files', link])).toBe(link);
  expect(linkIn(['ReplayHaven.exe', '--hidden'])).toBeUndefined();
});
