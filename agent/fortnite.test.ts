import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import {
  clipEvents,
  clipWindow,
  FortniteReplays,
  MAX_WAIT_MS,
  nvidiaLocalTime,
  replayStart,
  resolveOwner,
} from './fortnite';
import type { Elimination, Replay } from './replay';
import { buildReplay, id } from './replay-fixture';
import type { FixtureElim } from './replay-fixture';

// Ortszeit zwei Stunden vor UTC, wie im Sommer in Deutschland.
const toUtc = (naive: number) => naive - 2 * 3600000;
const OWNER = id('a1');
const MATE = id('c3');

it('reads the local time from NVIDIA file names', () => {
  expect(nvidiaLocalTime('Fortnite 2025.02.14 - 16.55.58.18.Eliminierung.DVR.mp4')).toBe(
    Date.UTC(2025, 1, 14, 16, 55, 58),
  );
  expect(nvidiaLocalTime('D:/Clips/Fortnite/Fortnite 2026.09.24 - 20.10.05.03.DVR.mp4')).toBe(
    Date.UTC(2026, 8, 24, 20, 10, 5),
  );
  expect(nvidiaLocalTime('clip.mp4')).toBeUndefined();
  expect(nvidiaLocalTime('Fortnite 2025.13.14 - 16.55.58.18.DVR.mp4')).toBeUndefined();
  expect(nvidiaLocalTime('Fortnite 2025.02.30 - 16.55.58.18.DVR.mp4')).toBeUndefined();
});

it('tells from the modification time whether the name marks the end or the start', () => {
  const name = 'Fortnite 2026.09.24 - 20.10.05.03.DVR.mp4';
  const named = Date.UTC(2026, 8, 24, 18, 10, 5);
  // Gespeichert um 20:10:05 Ortszeit, drei Sekunden später fertig geschrieben.
  expect(clipWindow(name, 60, named + 3000, toUtc)).toEqual({
    start: named - 60000,
    end: named,
    anchor: 'name-end',
  });
  // Aufnahme ab 20:10:05, eine Minute lang, dann geschrieben.
  expect(clipWindow(name, 60, named + 62000, toUtc)).toEqual({
    start: named,
    end: named + 60000,
    anchor: 'name-start',
  });
  // Kopiert oder bearbeitet: keine Deutung passt. Sehr kurz: beide passen.
  expect(clipWindow(name, 60, named + 86400000, toUtc)).toBeUndefined();
  expect(clipWindow(name, 8, named + 9000, toUtc)).toBeUndefined();
  expect(clipWindow('clip.mp4', 60, named, toUtc)).toBeUndefined();
});

const replayOf = (partial: Partial<Replay>): Replay => ({
  fileVersion: 7,
  lengthMs: 1200000,
  live: false,
  encrypted: true,
  eliminations: [],
  unreadable: 0,
  ...partial,
});
const player = (who: string) => ({ kind: 'player' as const, id: who });
const elim = (
  time: number,
  victim: string,
  killer: string,
  cause = 3,
  extra: Partial<Elimination> = {},
): Elimination => ({
  time,
  victim: player(victim),
  killer: player(killer),
  cause,
  knocked: false,
  victimAt: { x: 0, y: 0, z: 100 },
  killerAt: { x: 500, y: 0, z: 100 },
  ...extra,
});

it('prefers the UTC timecode over the local header time', () => {
  expect(replayStart(replayOf({ utcStart: 5, localStart: 10 }), toUtc)).toBe(5);
  expect(replayStart(replayOf({ localStart: 7200000 }), toUtc)).toBe(0);
  expect(replayStart(replayOf({}), toUtc)).toBeUndefined();
});

it('finds the recording account by recurrence, its own elimination and its kill count', () => {
  const match = replayOf({
    eliminations: [
      elim(1000, id('b2'), OWNER),
      elim(2000, id('d4'), OWNER),
      elim(3000, id('e5'), MATE),
      elim(9000, OWNER, id('f6')),
    ],
    stats: {
      time: 9000,
      accuracy: 0,
      assists: 0,
      eliminations: 2,
      weaponDamage: 0,
      otherDamage: 0,
      revives: 0,
      damageTaken: 0,
    },
    team: { time: 9000, placement: 4, totalPlayers: 25 },
  });
  // Der Mitspieler kehrt wieder wie der Besitzer, scheidet aber nicht mit dem Match aus.
  const recurrence = new Map([
    [OWNER, 5],
    [MATE, 5],
  ]);
  const owner = resolveOwner(match, recurrence);
  expect(owner.id).toBe(OWNER);
  expect(owner.basis.join(' ')).toMatch(/scheidet aus/);
  // Mit Sieg fehlt das eigene Ausscheiden: dann ist es zwischen beiden offen, also keiner.
  const won = { ...match, team: { time: 9000, placement: 1, totalPlayers: 25 } };
  expect(resolveOwner(won, recurrence).id).toBeUndefined();
  // Ohne weitere Replays tragen Ausscheiden und Kill-Zahl gemeinsam, das Ausscheiden allein nicht.
  expect(resolveOwner(match, new Map()).id).toBe(OWNER);
  const miscounted = { ...match, stats: { ...match.stats!, eliminations: 5 } };
  expect(resolveOwner(miscounted, new Map()).id).toBeUndefined();
});

it('excludes shooters whose position the replay never knew, and honours entered accounts', () => {
  const match = replayOf({
    eliminations: [
      elim(1000, id('b2'), OWNER),
      elim(2000, id('d4'), MATE, 4, { killerAt: undefined }),
      elim(9000, OWNER, id('f6')),
    ],
    stats: {
      time: 9000,
      accuracy: 0,
      assists: 0,
      eliminations: 1,
      weaponDamage: 0,
      otherDamage: 0,
      revives: 0,
      damageTaken: 0,
    },
  });
  const recurrence = new Map([
    [OWNER, 3],
    [MATE, 3],
  ]);
  expect(resolveOwner(match, recurrence).id).toBe(OWNER);
  // Eingetragene Konten entscheiden allein, auch gegen die Hinweise.
  expect(resolveOwner(match, recurrence, [MATE.toUpperCase()]).id).toBe(MATE);
  expect(resolveOwner(match, recurrence, [id('99')])).toEqual({
    basis: ['keine eingetragene Konto-ID in diesem Replay'],
  });
});

it('lists the owner events of the clip window with weapon, distance and series', () => {
  const start = Date.UTC(2026, 8, 24, 18, 0, 0);
  const window = { start: start + 100000, end: start + 160000, anchor: 'name-end' as const };
  const far = { victimAt: { x: 0, y: 18340, z: 50 }, killerAt: { x: 0, y: 0, z: 50 } };
  const near = (m: number) => ({
    victimAt: { x: 0, y: m * 100, z: 50 },
    killerAt: { x: 0, y: 0, z: 50 },
  });
  const match = replayOf({
    eliminations: [
      elim(90000, id('b2'), OWNER, 3),
      // Knock mit dem Scharfschützengewehr knapp vor dem Clip, später ausgeblutet.
      elim(99500, id('d4'), OWNER, 6, { knocked: true, ...far }),
      elim(120000, id('d4'), OWNER, 17, near(40)),
      elim(140000, id('e5'), OWNER, 3, near(4)),
      elim(146000, id('f6'), OWNER, 3, near(6)),
      elim(150000, id('f6'), id('b2'), 4),
      elim(158000, OWNER, OWNER, 0, { killerAt: undefined }),
      elim(165000, id('e5'), OWNER, 3),
    ],
  });
  const events = clipEvents(match, OWNER, start, window);
  expect(events.map((e) => [e.kind, e.seconds, e.weapon, e.distance, e.count])).toEqual([
    ['knock', 0, 'sniper', 183.4, undefined],
    ['kill', 20, 'sniper', 183.4, undefined],
    ['kill', 40, 'shotgun', 4, undefined],
    ['kill', 46, 'shotgun', 6, undefined],
    ['multikill', 46, 'shotgun', undefined, 2],
    ['death', 58, 'storm', undefined, undefined],
  ]);
  expect(events.every((e) => e.source === 'replay')).toBe(true);
  // Platz 1: Das Match endet im Clip mit dem Sieg.
  const won = replayOf({
    stats: {
      time: 150000,
      accuracy: 0,
      assists: 0,
      eliminations: 0,
      weaponDamage: 0,
      otherDamage: 0,
      revives: 0,
      damageTaken: 0,
    },
    team: { time: 150000, placement: 1, totalPlayers: 100 },
  });
  expect(clipEvents(won, OWNER, start, window)).toMatchObject([{ kind: 'matchWon', seconds: 50 }]);
});

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'replayhaven-fortnite-'));
});
afterEach(async () => {
  if (resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('replayhaven-fortnite-'))
    await rm(root, { recursive: true, force: true });
});

/** Ein Match mit dem Besitzer, beginnend zur angegebenen UTC-Zeit. */
const match = (utcStart: number, elims: FixtureElim[], extra = {}) =>
  buildReplay({
    utcStart,
    localStart: utcStart + 2 * 3600000,
    lengthMs: 600000,
    elims,
    stats: { time: 590000, eliminations: elims.filter((e) => e.killer === OWNER).length },
    team: { time: 590000, placement: 9, totalPlayers: 30 },
    ...extra,
  });

it('maps a finished replay onto a clip, waits for a running match and skips other games', async () => {
  const day = Date.UTC(2026, 8, 24, 16, 0, 0);
  const shot = (time: number, victim: string, cause = 3): FixtureElim => ({
    time,
    victim,
    killer: OWNER,
    cause,
    victimAt: [0, 5000, 100],
    killerAt: [0, 0, 100],
  });
  // Drei frühere Matches desselben Kontos gegen jeweils andere Gegner: Nur es kehrt wieder.
  for (const [i, begin] of [day, day + 3600000, day + 7200000].entries())
    await writeFile(
      join(root, `UnsavedReplay-${i}.replay`),
      match(begin, [
        shot(60000, id(`b${i + 2}`)),
        { time: 590000, victim: OWNER, killer: id(`f${i + 6}`), cause: 4 },
      ]),
    );
  // Das Match des Clips: zwei schnelle Kills kurz vor dem Speichern um 21:10:00 Ortszeit.
  const begin = Date.UTC(2026, 8, 24, 19, 0, 0);
  await writeFile(
    join(root, 'UnsavedReplay-3.replay'),
    match(begin, [
      shot(580000, id('d4')),
      shot(585000, id('e5')),
      { time: 590000, victim: OWNER, killer: id('f6'), cause: 4 },
    ]),
  );
  const clip = join(root, 'Fortnite 2026.09.24 - 21.10.00.07.DVR.mp4');
  await writeFile(clip, 'test-only');
  const saved = begin + 600000;
  await utimes(clip, new Date(saved + 2000), new Date(saved + 2000));
  const replays = new FortniteReplays({ folder: root, toUtc });
  const found = await replays.lookup(clip, 30, saved + 2000);
  expect(found.status).toBe('ok');
  expect(found.trace).toMatchObject({
    file: 'UnsavedReplay-3.replay',
    owner: OWNER,
    anchor: 'name-end',
    clipStartInReplay: 570,
  });
  expect(found.events.map((e) => [e.kind, e.seconds, e.count])).toEqual([
    ['kill', 10, undefined],
    ['kill', 15, undefined],
    ['multikill', 15, 2],
    ['death', 20, undefined],
  ]);
  // Ein Clip außerhalb aller Replays bleibt ohne Replay-Ereignisse, ebenso andere Spiele.
  const earlier = join(root, 'Fortnite 2026.09.23 - 21.10.00.02.DVR.mp4');
  expect(await replays.lookup(earlier, 30, saved - 86400000 + 2000)).toMatchObject({
    status: 'none',
    events: [],
    trace: { reason: 'kein Replay deckt die Aufnahmezeit ab' },
  });
  expect(await replays.forClip(clip, 'VALORANT', 30)).toBeUndefined();

  // Ein Match, das vor dem Clipende begann und noch aufnimmt: warten.
  await writeFile(
    join(root, 'UnsavedReplay-4.replay'),
    buildReplay({ live: true, localStart: saved - 60000 + 2 * 3600000 }),
  );
  expect((await replays.lookup(clip, 30, saved + 2000)).status).toBe('wait');
  expect((await replays.forClip(clip, 'Fortnite', 30, saved + 2000 + 60000))?.status).toBe('wait');
  // Nach 45 Minuten zählen die Bilder allein.
  expect(await replays.forClip(clip, 'Fortnite', 30, saved + 2000 + MAX_WAIT_MS + 1)).toMatchObject(
    {
      status: 'none',
      trace: { reason: 'Match nach 45 Minuten nicht beendet' },
    },
  );
});
