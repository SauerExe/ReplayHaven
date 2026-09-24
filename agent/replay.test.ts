import { expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { parseReplay, readReplayFile, ReplayError } from './replay';
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
