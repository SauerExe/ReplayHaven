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

// Local time two hours ahead of UTC, as in German summer.
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
  // Saved at 20:10:05 local time, fully written three seconds later.
  expect(clipWindow(name, 60, named + 3000, toUtc)).toEqual({
    start: named - 60000,
    end: named,
    anchor: 'name-end',
  });
  // Recording from 20:10:05, one minute long, then written.
  expect(clipWindow(name, 60, named + 62000, toUtc)).toEqual({
    start: named,
    end: named + 60000,
    anchor: 'name-start',
  });
  // Copied or edited: no reading fits. Very short: both fit.
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
  // The teammate recurs like the owner but is not eliminated when the match ends.
  const recurrence = new Map([
    [OWNER, 5],
    [MATE, 5],
  ]);
  const owner = resolveOwner(match, recurrence);
  expect(owner.id).toBe(OWNER);
  expect(owner.basis.join(' ')).toMatch(/eliminated when the own match ends/);
  // With a victory there is no own elimination: then it is open between both, so neither.
  const won = { ...match, team: { time: 9000, placement: 1, totalPlayers: 25 } };
  expect(resolveOwner(won, recurrence).id).toBeUndefined();
  // Without other replays, elimination and kill count together suffice, elimination alone does not.
  expect(resolveOwner(match, new Map()).id).toBe(OWNER);
  const miscounted = { ...match, stats: { ...match.stats!, eliminations: 5 } };
  expect(resolveOwner(miscounted, new Map()).id).toBeUndefined();
});

it('never takes a regular teammate for the owner in team matches', () => {
  const stats = (time: number, eliminations: number) => ({
    time,
    accuracy: 0,
    assists: 0,
    eliminations,
    weaponDamage: 0,
    otherDamage: 0,
    revives: 0,
    damageTaken: 0,
  });
  const regulars = new Map([
    [OWNER, 6],
    [MATE, 6],
  ]);
  // Duo win without an own kill or knock: the owner is missing from the events, the regular
  // teammate has a kill. Recurrence alone is not enough.
  const carried = replayOf({
    eliminations: [
      elim(1000, id('b2'), id('d4'), 3, { knocked: true }),
      elim(5000, id('e5'), MATE),
    ],
    stats: stats(9000, 0),
    team: { time: 9000, placement: 1, totalPlayers: 50 },
  });
  expect(resolveOwner(carried, regulars).id).toBeUndefined();
  // Both in the match, the owner clearly leads. In team modes a regular teammate can still be
  // the one whose elimination triggers the stats, so nothing decides here.
  const together = replayOf({
    eliminations: [
      elim(1000, id('b2'), OWNER, 3, { knocked: true }),
      elim(1500, id('b2'), OWNER),
      elim(2000, id('d4'), OWNER),
      elim(6000, MATE, id('f6')),
      elim(9000, OWNER, id('f6')),
    ],
    stats: stats(9000, 2),
    team: { time: 9000, placement: 3, totalPlayers: 50 },
  });
  expect(resolveOwner(together, regulars).basis[0]).toMatch(
    /team mode .* enter your own account ID/,
  );
  expect(resolveOwner(together, regulars).id).toBeUndefined();
  // If the teammate does not recur (random squad), the owner's clues suffice.
  const alone = new Map([[OWNER, 6]]);
  expect(resolveOwner(together, alone).id).toBe(OWNER);
  // An enemy knocked down by the owner bleeds out without a position after the owner is out.
  // That does not exclude the owner.
  const late = replayOf({
    ...together,
    eliminations: [
      ...together.eliminations,
      elim(9500, id('g7'), OWNER, 17, { killerAt: undefined }),
    ],
  });
  expect(resolveOwner(late, alone).id).toBe(OWNER);
  // A kill without a position while alive, however, excludes.
  const far = replayOf({
    ...together,
    eliminations: [
      ...together.eliminations,
      elim(500, id('g7'), OWNER, 4, { killerAt: undefined }),
    ],
  });
  expect(resolveOwner(far, alone).id).toBeUndefined();
  // Team Rumble: no knocks but respawns. The teammate is eliminated at match end and has as many
  // kills as the stats; scored as solo he would win. As a team mode, nothing decides.
  const rumble = replayOf({
    eliminations: [
      elim(1000, id('b2'), OWNER),
      elim(2000, id('d4'), OWNER),
      elim(2500, id('e5'), MATE),
      elim(3000, OWNER, id('f6')),
      elim(4000, id('g7'), OWNER),
      elim(5000, id('b2'), MATE),
      elim(6000, MATE, id('d4')),
      elim(7000, id('e5'), MATE),
      elim(9000, MATE, id('f6')),
    ],
    stats: stats(9000, 3),
    team: { time: 9000, placement: 2, totalPlayers: 16 },
  });
  expect(resolveOwner(rumble, regulars).id).toBeUndefined();
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
  // Configured accounts decide alone, even against the clues.
  expect(resolveOwner(match, recurrence, [MATE.toUpperCase()]).id).toBe(MATE);
  expect(resolveOwner(match, recurrence, [id('99')])).toEqual({
    basis: ['no configured account ID in this replay'],
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
      // Knock with the sniper rifle just before the clip, bled out later.
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
  // Nameless bots cannot be told apart: no inherited knock from another bot.
  const bots = replayOf({
    eliminations: [
      {
        ...elim(101000, OWNER, OWNER, 6, { knocked: true, ...far }),
        victim: { kind: 'bot', id: '' },
      },
      { ...elim(130000, OWNER, OWNER, 17, near(3)), victim: { kind: 'bot', id: '' } },
    ],
  });
  expect(clipEvents(bots, OWNER, start, window).map((e) => [e.kind, e.weapon, e.distance])).toEqual(
    [
      ['knock', 'sniper', 183.4],
      ['kill', undefined, undefined],
    ],
  );
  // First place: the match ends with the victory inside the clip.
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

/** A match with the owner, starting at the given UTC time. */
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
  // Three earlier matches of the same account against different enemies: only it recurs.
  for (const [i, begin] of [day, day + 3600000, day + 7200000].entries())
    await writeFile(
      join(root, `UnsavedReplay-${i}.replay`),
      match(begin, [
        shot(60000, id(`b${i + 2}`)),
        { time: 590000, victim: OWNER, killer: id(`f${i + 6}`), cause: 4 },
      ]),
    );
  // The clip's match: two quick kills shortly before saving at 21:10:00 local time.
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
  // A clip outside all replays gets no replay events, and neither do other games.
  const earlier = join(root, 'Fortnite 2026.09.23 - 21.10.00.02.DVR.mp4');
  expect(await replays.lookup(earlier, 30, saved - 86400000 + 2000)).toMatchObject({
    status: 'none',
    events: [],
    trace: { reason: 'no replay covers the recording time' },
  });
  expect(await replays.forClip(clip, 'VALORANT', 30)).toBeUndefined();

  // A replay left open by a crash a week ago holds nothing up.
  const live = join(root, 'UnsavedReplay-4.replay');
  await writeFile(live, buildReplay({ live: true, localStart: saved - 60000 + 2 * 3600000 }));
  const week = new Date(saved - 7 * 86400000);
  await utimes(live, week, week);
  expect((await replays.lookup(clip, 30, saved + 2000)).status).toBe('ok');
  // A match that began before the clip end and is still recording: wait.
  await utimes(live, new Date(saved + 60000), new Date(saved + 60000));
  expect((await replays.lookup(clip, 30, saved + 2000)).status).toBe('wait');
  expect((await replays.forClip(clip, 'Fortnite', 30, saved + 2000 + 60000))?.status).toBe('wait');
  // After 45 minutes, the frames alone count.
  expect(await replays.forClip(clip, 'Fortnite', 30, saved + 2000 + MAX_WAIT_MS + 1)).toMatchObject(
    {
      status: 'none',
      trace: { reason: 'match not finished after 45 minutes' },
    },
  );
});
