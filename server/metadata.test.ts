import { expect, it, vi, afterEach } from 'vitest';
import { gameKey, Igdb, pickExact, lookupGame } from './metadata';

afterEach(() => vi.unstubAllGlobals());

it('normalises game names across spelling differences', () => {
  // NVIDIA creates folders with double spaces, Steam writes trademark signs and apostrophes.
  expect(gameKey("Tom Clancy's Rainbow Six  Siege")).toBe('tom clancy s rainbow six siege');
  expect(gameKey('Tom Clancy’s Rainbow Six Siege')).toBe('tom clancy s rainbow six siege');
  expect(gameKey('Call of Duty®: Black Ops 6')).toBe('call of duty black ops 6');
  expect(gameKey('ARC Raiders')).toBe(gameKey('Arc Raiders'));
  expect(gameKey('   ')).toBe('');
});

it('accepts only exact matches, because a wrong cover is worse than none', () => {
  // Real Steam search responses from 2026-09-22.
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
  await lookupGame('Raft', undefined, undefined, 'en');
  expect(fetcher.mock.calls[3][0]).toContain('l=english');
});

it('follows Steam when it answers a renamed game under a new app id', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.includes('SearchApps')
        ? Response.json([{ appid: '359550', name: "Tom Clancy's Rainbow Six Siege" }])
        : Response.json({
            '5290420': {
              success: true,
              data: { type: 'game', name: "Tom Clancy's Rainbow Six Siege", steam_appid: 359550 },
            },
          }),
    ),
  );
  const info = await lookupGame("Tom Clancy's Rainbow Six  Siege");
  expect(info).toMatchObject({ name: "Tom Clancy's Rainbow Six Siege", appId: 359550 });
  expect(info?.coverUrl).toContain('/359550/');
});

it('gives up quietly when Steam answers with an error', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('', { status: 503 })),
  );
  await expect(lookupGame('Raft')).rejects.toThrow('HTTP 503');
});

it('treats unavailable details as retryable and rejects software matches', async () => {
  const fetcher = vi.fn(async (url: string) =>
    url.includes('SearchApps')
      ? Response.json([{ appid: '648800', name: 'Raft' }])
      : Response.json({ '648800': { success: false } }),
  );
  vi.stubGlobal('fetch', fetcher);
  await expect(lookupGame('Raft')).rejects.toThrow('not returning game details');
  fetcher.mockImplementation(async (url: string) =>
    url.includes('SearchApps')
      ? Response.json([{ appid: '648800', name: 'Raft' }])
      : Response.json({ '648800': { success: true, data: { type: 'application' } } }),
  );
  expect(await lookupGame('Raft')).toBeUndefined();
});

it('keeps meaningful symbols and skips NVIDIA fallback profiles', async () => {
  // "Desktop+" is a SteamVR tool and must not match the "Desktop" folder.
  expect(gameKey('Desktop+')).not.toBe(gameKey('Desktop'));
  expect(pickExact('Desktop', [{ appid: '1', name: 'Desktop+' }])).toBeUndefined();
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  for (const profile of ['Desktop', 'Base Profile', 'NVIDIA Share'])
    expect(await lookupGame(profile)).toBeUndefined();
  expect(fetcher).not.toHaveBeenCalled();
});

it('asks IGDB for games Steam does not know and reuses the Twitch token', async () => {
  const steam = vi.fn(async () => Response.json([{ appid: '1', name: 'Valorant Soundtrack' }]));
  vi.stubGlobal('fetch', steam);
  const calls: string[] = [];
  const get = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push(String(url));
    if (String(url).startsWith('https://id.twitch.tv/'))
      return Response.json({ access_token: 'tok', expires_in: 5000000 });
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(String(init?.body)).toMatch(/^search "valorant";/i);
    return Response.json([
      { id: 7, name: 'Valorant Champions', cover: { image_id: 'xyz' } },
      {
        id: 126459,
        name: 'Valorant',
        summary: 'A 5v5 character-based tactical shooter.',
        first_release_date: 1590969600,
        genres: [{ name: 'Shooter' }, { name: 'Tactical' }],
        cover: { image_id: 'co2mvt' },
        url: 'https://www.igdb.com/games/valorant',
      },
    ]);
  });
  const igdb = new Igdb({ clientId: 'id', clientSecret: 'secret' }, get as typeof fetch);
  const info = await lookupGame('VALORANT', undefined, igdb);
  expect(info).toMatchObject({
    name: 'Valorant',
    appId: 126459,
    genre: 'Shooter, Tactical',
    released: '1. Juni 2020',
    source: 'https://www.igdb.com/games/valorant',
  });
  expect(info?.coverUrl).toBe(
    'https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co2mvt.jpg',
  );
  await lookupGame('Valorant', undefined, igdb);
  // One token for both searches.
  expect(calls.filter((c) => c.startsWith('https://id.twitch.tv/'))).toHaveLength(1);
});

it('stays with Steam when it has the game and without IGDB when nothing matches exactly', async () => {
  const get = vi.fn(async (url: string | URL | Request) =>
    String(url).startsWith('https://id.twitch.tv/')
      ? Response.json({ access_token: 'tok', expires_in: 3600 })
      : Response.json([{ id: 1, name: 'Minecraft Dungeons' }]),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json([])),
  );
  const igdb = new Igdb({ clientId: 'id', clientSecret: 'secret' }, get as typeof fetch);
  expect(await lookupGame('Minecraft', undefined, igdb)).toBeUndefined();
  expect(await lookupGame('Desktop', undefined, igdb)).toBeUndefined();
  expect(get).toHaveBeenCalledTimes(2);
});

it('takes the main game over a same-named regional port on IGDB', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json([])),
  );
  // Real response from 2026-09-24, shortened: the Chinese version comes first.
  const get = vi.fn(async (url: string | URL | Request) =>
    String(url).startsWith('https://id.twitch.tv/')
      ? Response.json({ access_token: 'tok', expires_in: 3600 })
      : Response.json([
          {
            id: 231090,
            name: 'Fortnite',
            game_type: 11,
            parent_game: 1905,
            total_rating_count: 33,
            cover: { image_id: 'cn' },
          },
          {
            id: 1905,
            name: 'Fortnite',
            game_type: 0,
            total_rating_count: 1011,
            cover: { image_id: 'main' },
          },
          { id: 324915, name: 'Fortnite OG', game_type: 2, parent_game: 1905 },
        ]),
  );
  const igdb = new Igdb({ clientId: 'id', clientSecret: 'secret' }, get as typeof fetch);
  expect(await lookupGame('Fortnite', undefined, igdb)).toMatchObject({ appId: 1905 });
});
