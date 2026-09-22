import { expect, it, vi, afterEach } from 'vitest';
import { gameKey, pickExact, lookupGame } from './metadata';

afterEach(() => vi.unstubAllGlobals());

it('normalises game names across spelling differences', () => {
  // NVIDIA legt Ordner mit doppelten Leerzeichen an, Steam schreibt Markenzeichen und Apostrophe.
  expect(gameKey("Tom Clancy's Rainbow Six  Siege")).toBe('tom clancy s rainbow six siege');
  expect(gameKey('Tom Clancy’s Rainbow Six Siege')).toBe('tom clancy s rainbow six siege');
  expect(gameKey('Call of Duty®: Black Ops 6')).toBe('call of duty black ops 6');
  expect(gameKey('ARC Raiders')).toBe(gameKey('Arc Raiders'));
  expect(gameKey('   ')).toBe('');
});

it('accepts only exact matches, because a wrong cover is worse than none', () => {
  // Echte Antworten der Steam-Suche vom 2026-09-22.
  const cod = [
    { appid: '311210', name: 'Call of Duty: Black Ops III' },
    { appid: '4384550', name: 'Call of Duty®: Black Ops 6' },
  ];
  expect(pickExact('Call of Duty Black Ops 7', cod)).toBeUndefined();
  expect(pickExact('Call of Duty Black Ops 6', cod)?.appid).toBe('4384550');

  const minecraft = [
    { appid: '1672970', name: 'Minecraft Dungeons' },
    { appid: '1928870', name: 'Minecraft Legends' },
  ];
  expect(pickExact('Minecraft', minecraft)).toBeUndefined();

  const r6 = [{ appid: '359550', name: "Tom Clancy's Rainbow Six Siege" }];
  expect(pickExact("Tom Clancy's Rainbow Six  Siege", r6)?.appid).toBe('359550');
  expect(pickExact('Valorant', [])).toBeUndefined();
});

it('returns nothing for games that are not on Steam and never invents a cover', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json([])),
  );
  expect(await lookupGame('Valorant')).toBeUndefined();
  expect(await lookupGame('   ')).toBeUndefined();
});

it('builds the game info from search hit and details', async () => {
  const fetcher = vi.fn(async (url: string) =>
    url.includes('SearchApps')
      ? Response.json([{ appid: '648800', name: 'Raft' }])
      : Response.json({
          '648800': {
            success: true,
            data: {
              name: 'Raft',
              short_description: 'Überlebe auf einem Floß.',
              genres: [{ description: 'Abenteuer' }, { description: 'Indie' }],
              release_date: { date: '20. Juni 2022' },
            },
          },
        }),
  );
  vi.stubGlobal('fetch', fetcher);
  const info = await lookupGame('Raft');
  expect(info).toMatchObject({
    key: 'raft',
    name: 'Raft',
    appId: 648800,
    description: 'Überlebe auf einem Floß.',
    genre: 'Abenteuer, Indie',
    released: '20. Juni 2022',
  });
  expect(info?.coverUrl).toContain('648800');
  expect(fetcher.mock.calls[1][0]).toContain('l=german');
});

it('gives up quietly when Steam answers with an error', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('', { status: 503 })),
  );
  await expect(lookupGame('Raft')).rejects.toThrow('HTTP 503');
});

it('keeps meaningful symbols and skips NVIDIA fallback profiles', async () => {
  // "Desktop+" ist ein SteamVR-Werkzeug und darf nicht auf den Ordner "Desktop" passen.
  expect(gameKey('Desktop+')).not.toBe(gameKey('Desktop'));
  expect(pickExact('Desktop', [{ appid: '1', name: 'Desktop+' }])).toBeUndefined();
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  for (const profile of ['Desktop', 'Base Profile', 'NVIDIA Share'])
    expect(await lookupGame(profile)).toBeUndefined();
  expect(fetcher).not.toHaveBeenCalled();
});
