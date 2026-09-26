import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rename, rm, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { localToUtc } from './fortnite';
import type { ClipWindow } from './fortnite';

/**
 * R6 events from the match replays that Rainbow Six Siege writes per round as a .rec file with
 * "Match Replay" (docs/R6-REPLAYS.md). The fork Gipson62/r6-dissect reads the files as a separate
 * program; this module only selects and interprets. Not yet part of the analysis: the measurement
 * tool (npm run r6-replays) must first show that kills, rounds and times are correct.
 */

/** Pinned source revision of the parser. The fork has no releases. */
export const DISSECT = {
  repository: 'https://github.com/Gipson62/r6-dissect.git',
  commit: 'e360e2bea96fb5d2ae05f62b47357af3d8f7fbf7',
  /** Newest season with its own thresholds in this revision; newer ones are read on the newest path. */
  newestSeason: 'Y11S2',
};

/** Two own kills with at most this much round clock between them form a streak, as in Fortnite. */
const SERIES_GAP = 12;
/** Selection, preparation, action phase, defuser and round end fit into this time. */
const MAX_ROUND_MS = 10 * 60000;
/** How far the start in the header may deviate from the file's creation time. */
const HEADER_TOLERANCE_MS = 3 * 60000;

interface DissectPlayer {
  id?: string | number;
  profileID?: string;
  username?: string;
  teamIndex?: number;
  operator?: { name?: string };
}
interface DissectTeam {
  won?: boolean;
  winCondition?: string;
  role?: string;
}
interface DissectUpdate {
  type?: { name?: string };
  username?: string;
  target?: string;
  timeInSeconds?: number;
  headshot?: boolean;
}
/** The essentials of r6-dissect's JSON output for one round. */
export interface DissectRound {
  gameVersion?: string;
  codeVersion?: number;
  timestamp?: string;
  matchType?: { name?: string };
  map?: { name?: string };
  gamemode?: { name?: string };
  recordingPlayerID?: string | number;
  recordingProfileID?: string;
  roundNumber?: number;
  teams?: DissectTeam[];
  players?: DissectPlayer[];
  matchFeedback?: DissectUpdate[];
  stats?: { username?: string; kills?: number }[];
}

/** Parses the JSON output. IDs are 64-bit numbers; as JS numbers they would lose digits. */
export function parseDissect(text: string): DissectRound {
  return JSON.parse(text, (key, value, context?: { source?: string }) =>
    (key === 'id' || key === 'recordingPlayerID') && typeof value === 'number' && context?.source
      ? context.source
      : value,
  );
}

/**
 * The recording player. The profile ID belongs to the Ubisoft account and matched in r6-dissect's
 * sample rounds even where the round's player ID found nothing. Spectator recordings have none.
 */
export function recorder(round: DissectRound): DissectPlayer | undefined {
  const players = round.players ?? [];
  const only = (list: DissectPlayer[]) => (list.length === 1 ? list[0] : undefined);
  const profile = round.recordingProfileID;
  const id = round.recordingPlayerID;
  return (
    (profile ? only(players.filter((p) => p.profileID === profile)) : undefined) ??
    (id !== undefined && String(id) !== '0'
      ? only(players.filter((p) => p.id !== undefined && String(p.id) === String(id)))
      : undefined)
  );
}

/** Win conditions as r6-dissect names them. */
export const CONDITIONS: Record<string, string> = {
  KilledOpponents: 'opponents eliminated',
  DefusedBomb: 'bomb defused',
  DisabledDefuser: 'defuser disabled',
  Time: 'time ran out',
  SecuredArea: 'area secured',
  ExtractedHostage: 'hostage extracted',
};

/** Whether the season is newer than the pinned parser revision knows, e.g. "Y11S3" vs "Y11S2". */
export function newerSeason(season: string | undefined, known = DISSECT.newestSeason) {
  const parse = (text?: string) =>
    /^Y(\d+)S(\d+)/i
      .exec(text ?? '')
      ?.slice(1)
      .map(Number);
  const [a, b] = [parse(season), parse(known)];
  if (!a || !b) return false;
  return a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
}

export interface OwnKill {
  /** Round clock in seconds, as in the HUD; it counts down. */
  clock: number;
  headshot: boolean;
  /** After the defuser was planted. Which clock r6-dissect keeps then is unclear. */
  afterPlant: boolean;
}

export interface RoundFile {
  path: string;
  /** Modification and creation time of the file in milliseconds. */
  mtime: number;
  birthtime?: number;
}

export interface OwnRound {
  file: string;
  /** Round number from 1, as in the game. */
  number: number;
  map?: string;
  mode?: string;
  matchType?: string;
  season?: string;
  /** Round window in UTC milliseconds, if it could be determined. */
  start?: number;
  end?: number;
  /** Where the round end comes from. */
  endFrom?: 'file' | 'next-round';
  side?: 'attack' | 'defense';
  operator?: string;
  won?: boolean;
  /** Win condition of the round, whoever won. */
  condition?: string;
  kills: OwnKill[];
  /** Own knockdowns (DBNO), round clock. */
  knocks: number[];
  /** Round clock at the player's own death. */
  death?: number;
  /** Opponents alive when the player was the last of the team left, in a won round. */
  clutch?: number;
  /** Lengths of the player's own streaks with at least two kills. */
  series: number[];
  ace: boolean;
  /** Why the round has no own player. */
  problem?: string;
  /** Plausibility checks that do not add up. */
  warnings: string[];
}

/** Streak lengths: own kills at most SERIES_GAP seconds of round clock apart. */
export function series(kills: readonly OwnKill[], gap = SERIES_GAP) {
  const out: number[] = [];
  let run = 0;
  let last: OwnKill | undefined;
  for (const kill of kills) {
    // The clock counts down; if it jumps up or switches with the defuser, the streak breaks.
    const close =
      last &&
      last.afterPlant === kill.afterPlant &&
      last.clock - kill.clock >= 0 &&
      last.clock - kill.clock <= gap;
    if (close) run++;
    else {
      if (run >= 2) out.push(run);
      run = 1;
    }
    last = kill;
  }
  if (run >= 2) out.push(run);
  return out;
}

/**
 * Start of the round in UTC. The header carries a "Z", but whether the game really writes UTC is
 * unverified. So the file's creation time decides, otherwise its modification time.
 */
export function roundStart(
  timestamp: string | undefined,
  file: Pick<RoundFile, 'mtime' | 'birthtime'>,
  toUtc: (naive: number) => number = localToUtc,
): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(timestamp ?? '');
  if (!match) return undefined;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  const candidates = [naive, toUtc(naive)];
  if (file.birthtime !== undefined && Number.isFinite(file.birthtime) && file.birthtime > 0) {
    const near = candidates.find((c) => Math.abs(file.birthtime! - c) <= HEADER_TOLERANCE_MS);
    if (near !== undefined) return near;
  }
  return candidates.find((c) => file.mtime - c >= 0 && file.mtime - c <= MAX_ROUND_MS);
}

/** Evaluates a round for the recording player. Other players' names never leave this function. */
export function ownRound(
  round: DissectRound,
  file: RoundFile,
  toUtc: (naive: number) => number = localToUtc,
): OwnRound {
  const players = round.players ?? [];
  const teams = round.teams ?? [];
  const season = round.gameVersion;
  const start = roundStart(round.timestamp, file, toUtc);
  const warnings: string[] = [];
  if (newerSeason(season))
    warnings.push(`Season ${season} is newer than the parser revision (${DISSECT.newestSeason})`);
  const winner = teams.findIndex((t) => t.won);
  if (teams.filter((t) => t.won).length !== 1) warnings.push('round result unclear');
  const base: OwnRound = {
    file: basename(file.path),
    number: (round.roundNumber ?? 0) + 1,
    ...(round.map?.name ? { map: round.map.name } : {}),
    ...(round.gamemode?.name ? { mode: round.gamemode.name } : {}),
    ...(round.matchType?.name ? { matchType: round.matchType.name } : {}),
    ...(season ? { season } : {}),
    ...(start !== undefined && file.mtime - start >= 0 && file.mtime - start <= MAX_ROUND_MS
      ? { start, end: file.mtime, endFrom: 'file' as const }
      : start !== undefined
        ? { start }
        : {}),
    ...(winner >= 0 && teams[winner].winCondition
      ? { condition: CONDITIONS[teams[winner].winCondition!] ?? teams[winner].winCondition }
      : {}),
    kills: [],
    knocks: [],
    series: [],
    ace: false,
    warnings,
  };
  const me = recorder(round);
  if (!me?.username || me.teamIndex === undefined)
    return {
      ...base,
      problem: players.length
        ? 'no own player (spectator recording or unknown account)'
        : 'no players in the file',
    };
  const names = players.map((p) => p.username).filter((n): n is string => !!n);
  const known = new Set<string | undefined>(names);
  const team = me.teamIndex;
  const opponents = players.filter((p) => p.teamIndex !== team);
  const alive = new Set<string | undefined>(names);
  const kills: OwnKill[] = [];
  const knocks: number[] = [];
  let death: number | undefined;
  let lastStanding: number | undefined;
  let planted = false;
  let strange = false;
  // The order of the messages is chronological; sorting by clock would not work because
  // preparation and action phase each count down from the start.
  for (const update of round.matchFeedback ?? []) {
    const type = update.type?.name;
    const clock = update.timeInSeconds;
    if (type === 'DefuserPlantComplete') planted = true;
    // Without a usable clock, the kill still counts for alive and dead players, just without a time.
    const timed = typeof clock === 'number' && clock >= 0 && clock <= 3600;
    if (!timed && (type === 'Kill' || type === 'DBNO')) strange = true;
    if (type === 'Kill' && (!known.has(update.username) || !known.has(update.target)))
      warnings.push('kill with unknown player');
    if (timed && type === 'Kill' && update.username === me.username)
      kills.push({ clock, headshot: update.headshot === true, afterPlant: planted });
    if (timed && type === 'DBNO' && update.username === me.username) knocks.push(clock);
    const gone: string | undefined =
      type === 'Kill'
        ? update.target
        : type === 'Death' || type === 'PlayerLeave'
          ? update.username
          : undefined;
    if (!gone || !alive.has(gone)) continue;
    alive.delete(gone);
    if (timed && gone === me.username && type !== 'PlayerLeave') death ??= clock;
    const mates = players.filter((p) => p.teamIndex === team && alive.has(p.username));
    if (lastStanding === undefined && mates.length === 1 && mates[0].username === me.username)
      lastStanding = opponents.filter((p) => alive.has(p.username)).length || undefined;
  }
  if (strange) warnings.push('round clock implausible');
  const counted = round.stats?.find((s) => s.username === me.username)?.kills;
  if (counted !== undefined && counted !== kills.length)
    warnings.push(`kills per killfeed ${kills.length}, per stats ${counted}`);
  const won = winner >= 0 ? winner === team : undefined;
  const role = teams[team]?.role;
  return {
    ...base,
    ...(role === 'Attack'
      ? { side: 'attack' as const }
      : role === 'Defense'
        ? { side: 'defense' as const }
        : {}),
    ...(me.operator?.name ? { operator: me.operator.name } : {}),
    ...(won !== undefined ? { won } : {}),
    kills,
    knocks,
    ...(death !== undefined ? { death } : {}),
    ...(won && death === undefined && lastStanding ? { clutch: lastStanding } : {}),
    series: series(kills),
    ace: kills.length >= 5,
    warnings: [...new Set(warnings)],
  };
}

/**
 * If a round lacks its end (file written later than the round can last), the start of the next
 * round of the same match counts.
 */
export function closeRounds(rounds: OwnRound[]): OwnRound[] {
  const sorted = [...rounds].sort((a, b) => a.number - b.number);
  return sorted.map((round, i) => {
    const next = sorted[i + 1]?.start;
    if (round.end !== undefined || round.start === undefined || next === undefined) return round;
    return next > round.start && next - round.start <= MAX_ROUND_MS
      ? { ...round, end: next, endFrom: 'next-round' as const }
      : round;
  });
}

export interface RoundChoice {
  round?: OwnRound;
  /** Overlap with the clip in seconds. */
  overlap: number;
  candidates: { file: string; number: number; overlap: number }[];
  reason?: string;
}

/**
 * The round of a clip by time of day. Better none than a wrong one: if two rounds overlap the
 * clip noticeably, it stays open.
 */
export function roundForClip(clip: ClipWindow, rounds: readonly OwnRound[]): RoundChoice {
  const length = clip.end - clip.start;
  const candidates = rounds
    .filter((r) => r.start !== undefined && r.end !== undefined)
    .map((r) => ({
      round: r,
      overlap: Math.min(clip.end, r.end!) - Math.max(clip.start, r.start!),
    }))
    .filter((c) => c.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap);
  const listed = candidates.map((c) => ({
    file: c.round.file,
    number: c.round.number,
    overlap: Math.round(c.overlap / 100) / 10,
  }));
  if (!candidates.length)
    return { overlap: 0, candidates: listed, reason: 'no round in the clip window' };
  if (candidates[1] && candidates[1].overlap > length * 0.3)
    return { overlap: 0, candidates: listed, reason: 'several rounds in the clip' };
  return { round: candidates[0].round, overlap: listed[0].overlap, candidates: listed };
}

export interface MatchFolder {
  folder: string;
  name: string;
  rounds: string[];
}

/** Match folders with their rounds; a folder that itself contains .rec files counts as one match. */
export async function matchFolders(root: string): Promise<MatchFolder[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const recs = (list: string[]) => list.filter((name) => /\.rec$/i.test(name)).sort();
  const own = recs(entries.filter((e) => e.isFile()).map((e) => e.name));
  if (own.length)
    return [{ folder: root, name: basename(root), rounds: own.map((n) => join(root, n)) }];
  const out: MatchFolder[] = [];
  for (const entry of entries
    .filter((e) => e.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const folder = join(root, entry.name);
    const rounds = recs(await readdir(folder));
    if (rounds.length)
      out.push({ folder, name: entry.name, rounds: rounds.map((n) => join(folder, n)) });
  }
  return out;
}

/** Where the game usually stores match replays: in the install folder (Ubisoft Connect, Steam). */
export function defaultReplayFolders(env: NodeJS.ProcessEnv = process.env) {
  const programs = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  return [
    join(
      programs,
      'Ubisoft',
      'Ubisoft Game Launcher',
      'games',
      "Tom Clancy's Rainbow Six Siege",
      'MatchReplay',
    ),
    join(programs, 'Steam', 'steamapps', 'common', "Tom Clancy's Rainbow Six Siege", 'MatchReplay'),
  ];
}

/** Folder for helper programs, next to the models from npm run laughs. */
export function toolFolder(env: NodeJS.ProcessEnv = process.env) {
  return env.LOCALAPPDATA
    ? join(env.LOCALAPPDATA, 'ReplayHaven', 'tools')
    : join(homedir(), '.cache', 'replayhaven', 'tools');
}

/** The built program; its name carries the source revision, so a new revision rebuilds. */
export function dissectFile(folder = toolFolder(), platform: NodeJS.Platform = process.platform) {
  return join(
    folder,
    `r6-dissect-${DISSECT.commit.slice(0, 7)}${platform === 'win32' ? '.exe' : ''}`,
  );
}

/** Runs a program without a shell and returns its output; throws with the tail of stderr. */
export function execute(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      timeout: options.timeout,
      windowsHide: true,
    });
    const out: Buffer[] = [];
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      err = (err + chunk.toString()).slice(-4000);
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) return resolve(Buffer.concat(out).toString('utf8'));
      const tail = err.trim().split(/\r?\n/).slice(-3).join(' | ');
      reject(
        new Error(`${basename(command)} exited with ${code ?? signal}${tail ? `: ${tail}` : ''}`),
      );
    });
  });
}

const missing = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';

/**
 * Builds r6-dissect from the pinned source revision. Git verifies the revision via the commit
 * hash, Go the dependencies via go.sum. Needs Go and Git; on Windows e.g. via
 * "winget install GoLang.Go".
 */
export async function buildDissect(target = dissectFile(), log: (line: string) => void = () => {}) {
  for (const [tool, hint] of [
    ['go', 'Go is missing. On Windows: winget install GoLang.Go, then open a new terminal.'],
    ['git', 'Git is missing. On Windows: winget install Git.Git, then open a new terminal.'],
  ] as const) {
    try {
      await execute(tool, ['version']);
    } catch (error) {
      throw missing(error) ? new Error(hint) : error;
    }
  }
  const work = await mkdtemp(join(tmpdir(), 'r6-dissect-'));
  try {
    log(`Fetching source revision ${DISSECT.commit.slice(0, 7)} from ${DISSECT.repository} …`);
    await execute('git', ['init', '-q', work]);
    await execute('git', [
      '-C',
      work,
      'fetch',
      '-q',
      '--depth',
      '1',
      DISSECT.repository,
      DISSECT.commit,
    ]);
    await execute('git', ['-C', work, 'checkout', '-q', '--detach', 'FETCH_HEAD']);
    const head = (await execute('git', ['-C', work, 'rev-parse', 'HEAD'])).trim();
    if (head !== DISSECT.commit) throw new Error(`Unexpected source revision ${head}.`);
    log('Building r6-dissect with Go …');
    await mkdir(dirname(target), { recursive: true });
    const part = `${target}.part`;
    await execute('go', ['build', '-trimpath', '-ldflags=-s -w', '-o', part, '.'], {
      cwd: work,
      env: { ...process.env, CGO_ENABLED: '0', GOFLAGS: '-mod=readonly' },
      timeout: 15 * 60000,
    });
    await rename(part, target);
    return target;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** Reads a round with r6-dissect. A round takes 2 to 6 seconds here. */
export async function readRound(program: string, file: string) {
  return parseDissect(await execute(program, [file], { timeout: 3 * 60000 }));
}

/**
 * Where the client keeps the matches of saved clips. The game keeps only the most recent matches
 * (30 here on 2026-09-25, 940 MB in total) and deletes older ones; without a copy, the rounds of
 * older clips would be lost before the analysis can use them.
 */
export function replayArchive(env: NodeJS.ProcessEnv = process.env) {
  return env.LOCALAPPDATA
    ? join(env.LOCALAPPDATA, 'ReplayHaven', 'r6-replays')
    : join(homedir(), '.cache', 'replayhaven', 'r6-replays');
}

/** Start of a match from its folder name ("Match-2026-07-12_20-41-13-36588"), in local time. */
export function matchStarted(name: string) {
  const m = /^Match-(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/.exec(name);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : undefined;
}

/** How long after the last round a clip can still be saved (end screen). */
const AFTER_MATCH_MS = 10 * 60000;

/**
 * Backs up the match in which a clip was saved: from the start in the folder name until shortly
 * after the last written round. Rounds already copied stay, new ones are added. Returns the target
 * folder and whether the match may still be running (last round younger than five minutes); then
 * a second call later is worthwhile.
 */
export async function keepMatchForClip(
  savedAt: number,
  roots: readonly string[] = defaultReplayFolders(),
  archive = replayArchive(),
  now = Date.now(),
): Promise<{ target: string; running: boolean } | undefined> {
  // The most recent match that began before the clip: the previous one may still be in its
  // grace period (clip 20:45, match from 20:25 ended 20:38, the next began 20:41; test on 2026-09-25).
  let best: { match: MatchFolder; start: number; last: number } | undefined;
  for (const root of roots) {
    let matches: MatchFolder[];
    try {
      matches = await matchFolders(root);
    } catch {
      continue;
    }
    for (const match of matches) {
      const start = matchStarted(match.name);
      if (start === undefined || savedAt < start || (best && start <= best.start)) continue;
      const last = Math.max(
        ...(await Promise.all(match.rounds.map((r) => stat(r)))).map((s) => s.mtimeMs),
      );
      if (savedAt <= last + AFTER_MATCH_MS) best = { match, start, last };
    }
  }
  if (!best) return undefined;
  const target = join(archive, best.match.name);
  await mkdir(target, { recursive: true });
  for (const round of best.match.rounds) {
    const copy = join(target, basename(round));
    const [from, to] = await Promise.all([stat(round), stat(copy).catch(() => undefined)]);
    // A round that was still being written last time is replaced.
    if (!to || to.size !== from.size) await cp(round, copy, { force: true });
  }
  return { target, running: now - best.last < 5 * 60000 };
}
