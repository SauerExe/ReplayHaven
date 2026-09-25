import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  closeRounds,
  dissectFile,
  execute,
  keepMatchForClip,
  matchFolders,
  matchStarted,
  newerSeason,
  ownRound,
  parseDissect,
  recorder,
  roundForClip,
  roundStart,
  series,
} from './r6-replays';
import type { DissectRound, OwnKill, OwnRound } from './r6-replays';

const mates = ['SpielerEins', 'SpielerZwei', 'SpielerDrei', 'SpielerVier', 'SpielerFünf'];
const enemies = ['GegnerEins', 'GegnerZwei', 'GegnerDrei', 'GegnerVier', 'GegnerFünf'];
const utc = (text: string) => Date.parse(text);
/** Ortszeit UTC+2, wie im Sommer in Deutschland. */
const summer = (naive: number) => naive - 2 * 3600000;

/** Eine Runde, wie r6-dissect sie ausgibt: SpielerEins nimmt auf, Team 0 greift an und gewinnt. */
function round(
  feedback: [string, string, string | undefined, number, boolean?][],
  patch: Partial<DissectRound> = {},
): DissectRound {
  return {
    gameVersion: 'Y11S2',
    timestamp: '2026-09-24T18:00:00Z',
    matchType: { name: 'Ranked' },
    map: { name: 'Oregon' },
    gamemode: { name: 'Bomb' },
    recordingPlayerID: '9007199254740993',
    recordingProfileID: 'profil-eins',
    roundNumber: 2,
    teams: [
      { won: true, winCondition: 'KilledOpponents', role: 'Attack' },
      { won: false, role: 'Defense' },
    ],
    players: [
      ...mates.map((username, i) => ({
        id: String(9007199254740993n + BigInt(i)),
        profileID: i === 0 ? 'profil-eins' : `profil-${i}`,
        username,
        teamIndex: 0,
        operator: { name: i === 0 ? 'Sledge' : 'Ash' },
      })),
      ...enemies.map((username, i) => ({
        id: String(100 + i),
        profileID: `gegner-${i}`,
        username,
        teamIndex: 1,
      })),
    ],
    matchFeedback: feedback.map(([type, username, target, timeInSeconds, headshot]) => ({
      type: { name: type },
      username,
      ...(target ? { target } : {}),
      timeInSeconds,
      ...(headshot !== undefined ? { headshot } : {}),
    })),
    ...patch,
  };
}
const file = {
  path: '/replays/Match-2026-09-24_20-00-00-1/Match-R03.rec',
  mtime: utc('2026-09-24T18:04:10Z'),
};

it('keeps 64-bit ids exact when reading the JSON', () => {
  const parsed = parseDissect(
    '{"recordingPlayerID": 15960528403785102634, "players": [{"id": 15960528403785102634}], "roundNumber": 3}',
  );
  expect(parsed.recordingPlayerID).toBe('15960528403785102634');
  expect(parsed.players?.[0].id).toBe('15960528403785102634');
  expect(parsed.roundNumber).toBe(3);
});

it('finds the recording player by profile, else by player id, and nobody for spectators', () => {
  expect(recorder(round([]))?.username).toBe('SpielerEins');
  expect(recorder(round([], { recordingProfileID: '' }))?.username).toBe('SpielerEins');
  expect(
    recorder(round([], { recordingProfileID: 'zuschauer', recordingPlayerID: '1' })),
  ).toBeUndefined();
  expect(
    recorder(round([], { recordingProfileID: undefined, recordingPlayerID: '0' })),
  ).toBeUndefined();
});

it('lists own kills with clock and headshot, knocks, the win and the series', () => {
  const r = ownRound(
    round([
      ['Other', '', undefined, 179],
      ['Kill', 'SpielerZwei', 'GegnerEins', 160],
      ['DBNO', 'SpielerEins', 'GegnerZwei', 150],
      ['Kill', 'SpielerEins', 'GegnerZwei', 148, false],
      ['Kill', 'SpielerEins', 'GegnerDrei', 140, true],
      ['Kill', 'GegnerVier', 'SpielerDrei', 120],
      ['Kill', 'SpielerEins', 'GegnerVier', 90, true],
      ['Kill', 'SpielerZwei', 'GegnerFünf', 60],
    ]),
    file,
  );
  expect(r).toMatchObject({
    number: 3,
    map: 'Oregon',
    matchType: 'Ranked',
    side: 'attack',
    operator: 'Sledge',
    won: true,
    condition: 'Gegner ausgeschaltet',
    knocks: [150],
    series: [2],
    ace: false,
    warnings: [],
  });
  expect(r.kills).toEqual([
    { clock: 148, headshot: false, afterPlant: false },
    { clock: 140, headshot: true, afterPlant: false },
    { clock: 90, headshot: true, afterPlant: false },
  ]);
  expect(r.death).toBeUndefined();
  expect(r.clutch).toBeUndefined();
  // Fremde Namen tauchen im Ergebnis nicht auf.
  expect(JSON.stringify(r)).not.toMatch(/Gegner(Eins|Zwei|Drei|Vier|Fünf)|SpielerZwei/);
});

it('names the winning condition also for a lost round and records the own death', () => {
  const r = ownRound(
    round([['Kill', 'GegnerEins', 'SpielerEins', 101, true]], {
      teams: [
        { won: false, role: 'Attack' },
        { won: true, winCondition: 'Time', role: 'Defense' },
      ],
    }),
    file,
  );
  expect(r).toMatchObject({ won: false, condition: 'Zeit abgelaufen', death: 101, kills: [] });
});

it('recognises a clutch only when the recorder was last alive and the round was won', () => {
  const lastAlive: [string, string, string | undefined, number][] = [
    ['Kill', 'GegnerEins', 'SpielerZwei', 150],
    ['Kill', 'GegnerEins', 'SpielerDrei', 140],
    ['Kill', 'SpielerEins', 'GegnerZwei', 130],
    ['Kill', 'GegnerEins', 'SpielerVier', 120],
    ['PlayerLeave', 'SpielerFünf', undefined, 118],
    ['Kill', 'SpielerEins', 'GegnerEins', 100],
    ['Kill', 'SpielerEins', 'GegnerDrei', 80],
    ['Kill', 'SpielerEins', 'GegnerVier', 70],
    ['Kill', 'SpielerEins', 'GegnerFünf', 50],
  ];
  const won = ownRound(round(lastAlive), file);
  // Als SpielerFünf ging, lebten noch vier Gegner; fünf eigene Kills sind ein Ace, 80 und 70 eine Serie.
  expect(won).toMatchObject({ clutch: 4, ace: true, series: [2] });
  const died = ownRound(
    round([...lastAlive.slice(0, 5), ['Kill', 'GegnerEins', 'SpielerEins', 110]]),
    file,
  );
  expect(died.clutch).toBeUndefined();
  expect(died.death).toBe(110);
});

it('breaks a series when the clock jumps or the defuser is planted', () => {
  const k = (clock: number, afterPlant = false): OwnKill => ({
    clock,
    headshot: false,
    afterPlant,
  });
  expect(series([k(100), k(95), k(84), k(60)])).toEqual([3]);
  expect(series([k(100), k(95), k(40, true), k(35, true)])).toEqual([2, 2]);
  // Vorbereitung und Aktionsphase zählen je von vorn herunter.
  expect(series([k(10), k(178)])).toEqual([]);
});

it('marks kills after the plant and warns about disagreements and newer seasons', () => {
  const r = ownRound(
    round(
      [
        ['DefuserPlantComplete', 'SpielerZwei', undefined, 40],
        ['Kill', 'SpielerEins', 'GegnerEins', 30],
        ['Kill', 'SpielerEins', 'Unbekannt', 20],
      ],
      { gameVersion: 'Y11S3', stats: [{ username: 'SpielerEins', kills: 1 }] },
    ),
    file,
  );
  expect(r.kills.every((kill) => kill.afterPlant)).toBe(true);
  expect(r.warnings).toEqual([
    'Season Y11S3 ist neuer als der Parserstand (Y11S2)',
    'Kill mit unbekanntem Spieler',
    'Kills laut Killfeed 2, laut Statistik 1',
  ]);
  expect(newerSeason('Y12S1')).toBe(true);
  expect(newerSeason('Y11S2')).toBe(false);
  expect(newerSeason('Y10S4')).toBe(false);
  expect(newerSeason('unbekannt')).toBe(false);
});

it('keeps kills without a usable clock in the count of the living and warns about them', () => {
  const r = ownRound(
    round([
      ['Kill', 'GegnerEins', 'SpielerZwei', -1],
      ['Kill', 'GegnerEins', 'SpielerDrei', 140],
      ['Kill', 'GegnerEins', 'SpielerVier', 130],
      ['Kill', 'GegnerEins', 'SpielerFünf', 120],
      ['Kill', 'SpielerEins', 'GegnerEins', 110],
    ]),
    file,
  );
  // Ohne den ersten Kill wäre SpielerEins nie als Letzter übrig gewesen.
  expect(r).toMatchObject({ clutch: 5, warnings: ['Rundenuhr unplausibel'] });
});

it('explains rounds without an own player instead of guessing one', () => {
  const r = ownRound(
    round([['Kill', 'SpielerEins', 'GegnerEins', 100]], {
      recordingProfileID: 'zuschauer',
      recordingPlayerID: '1',
    }),
    file,
  );
  expect(r.problem).toMatch(/Zuschauer/);
  expect(r.kills).toEqual([]);
});

it('decides between UTC and local time by the file creation time, else by the change time', () => {
  const created = utc('2026-09-24T18:00:04Z');
  expect(
    roundStart('2026-09-24T18:00:00Z', { mtime: created + 200000, birthtime: created }, summer),
  ).toBe(utc('2026-09-24T18:00:00Z'));
  // Schreibt das Spiel Ortszeit, passt nur die umgerechnete Zeit zur Anlagezeit.
  expect(
    roundStart('2026-09-24T20:00:00Z', { mtime: created + 200000, birthtime: created }, summer),
  ).toBe(utc('2026-09-24T18:00:00Z'));
  expect(roundStart('2026-09-24T18:00:00Z', { mtime: utc('2026-09-24T18:04:00Z') }, summer)).toBe(
    utc('2026-09-24T18:00:00Z'),
  );
  expect(
    roundStart('2026-09-24T18:00:00Z', { mtime: utc('2026-09-24T19:00:00Z') }, summer),
  ).toBeUndefined();
  expect(roundStart(undefined, { mtime: created })).toBeUndefined();
});

it('takes the next round as the end when a file was written much later', () => {
  const late = { ...file, mtime: utc('2026-09-24T19:30:00Z') };
  const first = ownRound(round([], { roundNumber: 0 }), {
    ...late,
    birthtime: utc('2026-09-24T18:00:00Z'),
  });
  const second = ownRound(round([], { roundNumber: 1, timestamp: '2026-09-24T18:04:30Z' }), {
    ...late,
    birthtime: utc('2026-09-24T18:04:30Z'),
  });
  expect(first.end).toBeUndefined();
  const closed = closeRounds([second, first]);
  expect(closed.map((r) => [r.number, r.end, r.endFrom])).toEqual([
    [1, utc('2026-09-24T18:04:30Z'), 'next-round'],
    [2, undefined, undefined],
  ]);
});

it('assigns a clip to the round it overlaps, and to none when two rounds share it', () => {
  const at = (number: number, start: string, end: string): OwnRound => ({
    file: `R0${number}.rec`,
    number,
    start: utc(start),
    end: utc(end),
    kills: [],
    knocks: [],
    series: [],
    ace: false,
    warnings: [],
  });
  const rounds = [
    at(1, '2026-09-24T18:00:00Z', '2026-09-24T18:04:00Z'),
    at(2, '2026-09-24T18:04:20Z', '2026-09-24T18:08:00Z'),
  ];
  const clip = (start: string, seconds: number) => ({
    start: utc(start),
    end: utc(start) + seconds * 1000,
    anchor: 'name-end' as const,
  });
  expect(roundForClip(clip('2026-09-24T18:03:10Z', 60), rounds)).toMatchObject({
    round: { number: 1 },
    overlap: 50,
    candidates: [{ number: 1, overlap: 50 }],
  });
  // Je 20 s aus zwei Runden: offen lassen statt raten.
  expect(roundForClip(clip('2026-09-24T18:03:40Z', 60), rounds)).toMatchObject({
    reason: 'mehrere Runden im Clip',
    candidates: [
      { number: 1, overlap: 20 },
      { number: 2, overlap: 20 },
    ],
  });
  expect(roundForClip(clip('2026-09-24T18:03:25Z', 60), rounds)).toMatchObject({
    round: { number: 1 },
    overlap: 35,
  });
  expect(roundForClip(clip('2026-09-24T19:00:00Z', 60), rounds)).toMatchObject({
    reason: 'keine Runde im Clipfenster',
  });
});

it('finds match folders, or treats a folder with rounds as one match', async () => {
  const root = await mkdtemp(join(tmpdir(), 'r6-replays-'));
  try {
    for (const [folder, names] of [
      ['Match-2026-09-24_20-00-00-1', ['Match-R02.rec', 'Match-R01.rec', 'notiz.txt']],
      ['Match-2026-09-24_20-40-00-2', ['Match-R01.rec']],
      ['Leer', []],
    ] as const) {
      await mkdir(join(root, folder));
      for (const name of names) await writeFile(join(root, folder, name), '');
    }
    const found = await matchFolders(root);
    expect(found.map((m) => [m.name, m.rounds.map((r) => r.slice(root.length + 1))])).toEqual([
      [
        'Match-2026-09-24_20-00-00-1',
        [
          join('Match-2026-09-24_20-00-00-1', 'Match-R01.rec'),
          join('Match-2026-09-24_20-00-00-1', 'Match-R02.rec'),
        ],
      ],
      ['Match-2026-09-24_20-40-00-2', [join('Match-2026-09-24_20-40-00-2', 'Match-R01.rec')]],
    ]);
    expect((await matchFolders(join(root, 'Match-2026-09-24_20-40-00-2')))[0].rounds).toHaveLength(
      1,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('runs programs without a shell and reports the end of stderr on failure', async () => {
  expect(await execute(process.execPath, ['-e', 'process.stdout.write("ok")'])).toBe('ok');
  await expect(
    execute(process.execPath, ['-e', 'console.error("kaputt"); process.exit(3)']),
  ).rejects.toThrow(/endete mit 3: kaputt/);
  await expect(execute('replayhaven-gibt-es-nicht', [])).rejects.toMatchObject({ code: 'ENOENT' });
  expect(dissectFile('/werkzeuge', 'win32')).toMatch(/r6-dissect-e360e2b\.exe$/);
  expect(dissectFile('/werkzeuge', 'linux')).toMatch(/r6-dissect-e360e2b$/);
});

it('keeps the match a clip was saved in and adds rounds written later', async () => {
  const root = await mkdtemp(join(tmpdir(), 'r6-keep-'));
  try {
    const replays = join(root, 'MatchReplay');
    const archive = join(root, 'archiv');
    const name = 'Match-2026-07-12_20-41-13-36588';
    const started = matchStarted(name)!;
    expect(new Date(started).getHours()).toBe(20);
    const match = join(replays, name);
    await mkdir(match, { recursive: true });
    const round = async (n: number, minutes: number, size = 10) => {
      const file = join(match, `${name}-R0${n}.rec`);
      await writeFile(file, 'x'.repeat(size));
      const at = new Date(started + minutes * 60000);
      await utimes(file, at, at);
    };
    await round(1, 4);
    await round(2, 8);
    // Ein Clip aus Runde 2, gesichert, während das Match noch läuft.
    const saved = started + 7 * 60000;
    const first = await keepMatchForClip(saved, [replays], archive, started + 9 * 60000);
    expect(first).toMatchObject({ target: join(archive, name), running: true });
    await round(3, 12);
    await round(2, 8, 20);
    const second = await keepMatchForClip(saved, [replays], archive, started + 30 * 60000);
    expect(second?.running).toBe(false);
    expect((await readdir(join(archive, name))).sort()).toEqual([
      `${name}-R01.rec`,
      `${name}-R02.rec`,
      `${name}-R03.rec`,
    ]);
    // Ein früheres Match, das kurz vorher endete, verliert gegen das laufende.
    const earlier = join(replays, 'Match-2026-07-12_20-25-52-36588');
    await mkdir(earlier);
    await writeFile(join(earlier, 'x-R01.rec'), 'x');
    const ended = new Date(started - 2 * 60000);
    await utimes(join(earlier, 'x-R01.rec'), ended, ended);
    expect((await keepMatchForClip(saved, [replays], archive))?.target).toBe(join(archive, name));
    // Ein Clip lange nach dem Match oder davor gehört zu keinem.
    expect(await keepMatchForClip(started + 60 * 60000, [replays], archive)).toBeUndefined();
    expect(await keepMatchForClip(started - 60 * 60000, [replays], archive)).toBeUndefined();
    expect(await keepMatchForClip(saved, [join(root, 'fehlt')], archive)).toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
