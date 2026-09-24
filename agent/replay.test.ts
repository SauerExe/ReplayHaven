import { expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { parseReplay, readElimination, readReplayFile, ReplayError } from './replay';
import { buildReplay, id } from './replay-fixture';

const at = (x: number, y: number, z: number): [number, number, number] => [x, y, z];
// Aufbau wie in einem Replay aus Kapitel 5: Timecode in UTC, Vektoren als double, verschlüsselt.
const recorded = {
  localStart: Date.UTC(2026, 8, 24, 20, 0, 0),
  utcStart: Date.UTC(2026, 8, 24, 18, 0, 0),
  gameVersion: '38.10',
  elims: [
    {
      time: 61000,
      victim: id('b2'),
      killer: id('a1'),
      cause: 6,
      knocked: true,
      victimAt: at(10000, 20000, 3000),
      killerAt: at(10000, 2000, 3000),
    },
    { time: 70000, victim: 'bot', killer: id('a1'), cause: 3, victimAt: at(0, 0, 100) },
    { time: 90000, victim: id('a1'), killer: { name: 'Wache' }, cause: 4 },
  ],
  stats: { time: 90000, eliminations: 1 },
  team: { time: 90000, placement: 7, totalPlayers: 25 },
};

it('reads eliminations, match stats and the UTC start of an encrypted replay', async () => {
  const replay = await parseReplay(buildReplay(recorded));
  expect(replay).toMatchObject({
    live: false,
    encrypted: true,
    engineNetworkVersion: 36,
    gameVersion: '38.10',
    localStart: recorded.localStart,
    utcStart: recorded.utcStart,
    stats: { time: 90000, eliminations: 1 },
    team: { placement: 7, totalPlayers: 25 },
    unreadable: 0,
  });
  expect(replay.eliminations).toEqual([
    {
      time: 61000,
      victim: { kind: 'player', id: id('b2') },
      killer: { kind: 'player', id: id('a1') },
      cause: 6,
      knocked: true,
      victimAt: { x: 10000, y: 20000, z: 3000 },
      killerAt: { x: 10000, y: 2000, z: 3000 },
    },
    // Ein Ort (0, 0, 0) ist unbekannt, nicht die Kartenmitte.
    {
      time: 70000,
      victim: { kind: 'bot', id: '' },
      killer: { kind: 'player', id: id('a1') },
      cause: 3,
      knocked: false,
      victimAt: { x: 0, y: 0, z: 100 },
    },
    {
      time: 90000,
      victim: { kind: 'player', id: id('a1') },
      killer: { kind: 'name', id: 'Wache' },
      cause: 4,
      knocked: false,
    },
  ]);
});

it('reads the float layout of older engine versions and unencrypted files', async () => {
  const replay = await parseReplay(
    buildReplay({ ...recorded, engineNetworkVersion: 16, encrypted: false, utcStart: undefined }),
  );
  expect(replay.encrypted).toBe(false);
  expect(replay.utcStart).toBeUndefined();
  expect(replay.eliminations.map((e) => [e.cause, e.killerAt?.y])).toEqual([
    [6, 2000],
    [3, undefined],
    [4, undefined],
  ]);
});

it('reads eliminations laid out like real replays from 11.31 and 29.01', () => {
  // Bytes aus den Tests von FortniteReplayDecompressor (MIT), Konto-IDs durch Platzhalter ersetzt.
  const floats = Buffer.from(
    [
      '09000000040000000000000080b20ac93c43ec7f3f42b89047c15082c7fd618847000080',
      '3f0000803f0000803f000000000000008011fb7f3fc00e493ca44aa147e19291c793f382',
      '470000803f0000803f0000803f1110b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b21110a1a1a1',
      'a1a1a1a1a1a1a1a1a1a1a1a1a10800000000',
    ].join(''),
    'hex',
  );
  expect(readElimination(floats, 5000, 14)).toEqual({
    time: 5000,
    victim: { kind: 'player', id: id('b2') },
    killer: { kind: 'player', id: id('a1') },
    cause: 8,
    knocked: false,
    victimAt: { x: 74096.515625, y: -66721.5078125, z: 69827.9765625 },
    killerAt: { x: 82581.28125, y: -74533.7578125, z: 67047.1484375 },
  });
  const doubles = Buffer.from(
    [
      '0900000004000000000000000000000000000000000000000000000000000000000000f0',
      '3f2e48c99ae1b4e440537e968efd47f1c08147616626ddb040000000000000f03f000000',
      '000000f03f000000000000f03f0000000000000000000000000000000000000000000000',
      '00000000000000f03f000000000000000000000000000000000000000000000000000000',
      '000000f03f000000000000f03f000000000000f03f1110b2b2b2b2b2b2b2b2b2b2b2b2b2',
      'b2b2b21110a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a10301000000',
    ].join(''),
    'hex',
  );
  const knock = readElimination(doubles, 0, 34);
  expect(knock).toMatchObject({ cause: 3, knocked: true, killer: { id: id('a1') } });
  expect(knock.victimAt?.x).toBeCloseTo(42407.05, 2);
  // Der Ort des Schützen steht hier auf (0, 0, 0), also unbekannt.
  expect(knock.killerAt).toBeUndefined();
});

it('leaves a replay that is still recording unread', async () => {
  const replay = await parseReplay(buildReplay({ ...recorded, live: true }));
  expect(replay.live).toBe(true);
  expect(replay.localStart).toBe(recorded.localStart);
  expect(replay.eliminations).toEqual([]);
});

it('keeps what it can read from a truncated or damaged file', async () => {
  const full = buildReplay(recorded);
  // Abgeschnitten mitten im letzten Chunk: alles davor bleibt lesbar.
  const cut = await parseReplay(full.subarray(0, full.length - 20));
  expect(cut.eliminations).toHaveLength(3);
  expect(cut.team).toBeUndefined();
  // Ein Ereignis mit unbekannter Spielerart zählt als unlesbar, statt alles zu verwerfen.
  const damaged = buildReplay({
    ...recorded,
    encrypted: false,
    elims: [{ time: 5, victim: id('b2'), killer: id('a1'), cause: 3 }],
  });
  const at = damaged.indexOf(Buffer.from([0x11, 16, ...Buffer.from(id('b2'), 'hex')]));
  damaged[at] = 0x42;
  const partly = await parseReplay(damaged);
  expect(partly.eliminations).toEqual([]);
  expect(partly.unreadable).toBe(1);
  await expect(parseReplay(Buffer.from('keine replay-datei'))).rejects.toBeInstanceOf(ReplayError);
});

it('reads a replay file from disk the same way', async () => {
  const root = await mkdtemp(join(tmpdir(), 'replayhaven-replay-'));
  try {
    const data = buildReplay(recorded);
    const file = join(root, 'UnsavedReplay-2026.09.24-20.00.00.replay');
    await writeFile(file, data);
    expect(await readReplayFile(file)).toEqual(await parseReplay(data));
  } finally {
    if (resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('replayhaven-replay-'))
      await rm(root, { recursive: true, force: true });
  }
});
