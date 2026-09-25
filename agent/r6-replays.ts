import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rename, rm, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { localToUtc } from './fortnite';
import type { ClipWindow } from './fortnite';

/**
 * R6-Ereignisse aus den Match-Replays, die Rainbow Six Siege mit „Match Replay“ je Runde als
 * .rec-Datei schreibt (docs/R6-REPLAYS.md). Die Dateien liest der Fork Gipson62/r6-dissect als
 * eigenes Programm; hier stehen nur Auswahl und Deutung. Noch nicht Teil der Analyse: Erst muss
 * das Messwerkzeug (npm run r6-replays) zeigen, dass Kills, Runden und Zeiten stimmen.
 */

/** Gepinnter Quellstand des Parsers. Der Fork hat keine Releases. */
export const DISSECT = {
  repository: 'https://github.com/Gipson62/r6-dissect.git',
  commit: 'e360e2bea96fb5d2ae05f62b47357af3d8f7fbf7',
  /** Neueste Season mit eigenen Schwellen in diesem Stand; neuere liest er auf dem neuesten Pfad. */
  newestSeason: 'Y11S2',
};

/** Zwei eigene Kills mit höchstens so viel Rundenuhr dazwischen bilden eine Serie, wie bei Fortnite. */
const SERIES_GAP = 12;
/** Auswahl, Vorbereitung, Aktionsphase, Entschärfer und Rundenende passen in diese Zeit. */
const MAX_ROUND_MS = 10 * 60000;
/** So weit darf der Beginn laut Kopf von der Anlagezeit der Datei abweichen. */
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
/** Das Nötigste aus der JSON-Ausgabe von r6-dissect für eine Runde. */
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

/** Liest die JSON-Ausgabe. IDs sind 64-Bit-Zahlen; als JS-Zahl verlören sie Stellen. */
export function parseDissect(text: string): DissectRound {
  return JSON.parse(text, (key, value, context?: { source?: string }) =>
    (key === 'id' || key === 'recordingPlayerID') && typeof value === 'number' && context?.source
      ? context.source
      : value,
  );
}

/**
 * Der aufnehmende Spieler. Die Profil-ID gehört zum Ubisoft-Konto und stimmte in den
 * Beispielrunden von r6-dissect auch dort, wo die Spieler-ID der Runde keinen Treffer hatte.
 * Zuschauer-Aufnahmen haben keinen.
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

/** Siegbedingungen, wie r6-dissect sie nennt. */
export const CONDITIONS: Record<string, string> = {
  KilledOpponents: 'Gegner ausgeschaltet',
  DefusedBomb: 'Bombe entschärft',
  DisabledDefuser: 'Entschärfer deaktiviert',
  Time: 'Zeit abgelaufen',
  SecuredArea: 'Bereich gesichert',
  ExtractedHostage: 'Geisel befreit',
};

/** Ob die Season neuer ist, als der gepinnte Parserstand kennt, etwa "Y11S3" gegenüber "Y11S2". */
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
  /** Rundenuhr in Sekunden, wie im HUD; sie zählt herunter. */
  clock: number;
  headshot: boolean;
  /** Nach dem Legen des Entschärfers. Welche Uhr r6-dissect dann führt, ist ungeklärt. */
  afterPlant: boolean;
}

export interface RoundFile {
  path: string;
  /** Änderungs- und Anlagezeit der Datei in Millisekunden. */
  mtime: number;
  birthtime?: number;
}

export interface OwnRound {
  file: string;
  /** Rundennummer ab 1, wie im Spiel. */
  number: number;
  map?: string;
  mode?: string;
  matchType?: string;
  season?: string;
  /** Rundenfenster in UTC-Millisekunden, falls es sich bestimmen ließ. */
  start?: number;
  end?: number;
  /** Woher das Rundenende stammt. */
  endFrom?: 'file' | 'next-round';
  side?: 'attack' | 'defense';
  operator?: string;
  won?: boolean;
  /** Siegbedingung der Runde, gleich wer gewonnen hat. */
  condition?: string;
  kills: OwnKill[];
  /** Eigene Niederschläge (DBNO), Rundenuhr. */
  knocks: number[];
  /** Rundenuhr beim eigenen Tod. */
  death?: number;
  /** Gegner am Leben, als man selbst als Letzter des Teams übrig war, bei gewonnener Runde. */
  clutch?: number;
  /** Längen der eigenen Serien mit mindestens zwei Kills. */
  series: number[];
  ace: boolean;
  /** Warum die Runde keinen eigenen Spieler hat. */
  problem?: string;
  /** Plausibilitätsprüfungen, die nicht aufgehen. */
  warnings: string[];
}

/** Längen der Serien: eigene Kills mit höchstens SERIES_GAP Sekunden Rundenuhr Abstand. */
export function series(kills: readonly OwnKill[], gap = SERIES_GAP) {
  const out: number[] = [];
  let run = 0;
  let last: OwnKill | undefined;
  for (const kill of kills) {
    // Die Uhr zählt herunter; springt sie hoch oder wechselt sie mit dem Entschärfer, reißt die Serie.
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
 * Beginn der Runde in UTC. Der Kopf trägt ein "Z", doch ob das Spiel wirklich UTC schreibt, ist
 * ungeprüft. Entschieden wird deshalb an der Anlagezeit der Datei, sonst an ihrer Änderungszeit.
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

/** Wertet eine Runde für den aufnehmenden Spieler aus. Fremde Namen verlassen diese Funktion nicht. */
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
    warnings.push(`Season ${season} ist neuer als der Parserstand (${DISSECT.newestSeason})`);
  const winner = teams.findIndex((t) => t.won);
  if (teams.filter((t) => t.won).length !== 1) warnings.push('Rundenausgang unklar');
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
        ? 'kein eigener Spieler (Zuschauer-Aufnahme oder unbekanntes Konto)'
        : 'keine Spieler in der Datei',
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
  // Die Reihenfolge der Meldungen ist die zeitliche; nach der Uhr sortieren ginge nicht, weil
  // Vorbereitung und Aktionsphase jeweils von vorn herunterzählen.
  for (const update of round.matchFeedback ?? []) {
    const type = update.type?.name;
    const clock = update.timeInSeconds;
    if (type === 'DefuserPlantComplete') planted = true;
    // Ohne brauchbare Uhr zählt der Kill trotzdem für Lebende und Tote, nur ohne Zeit.
    const timed = typeof clock === 'number' && clock >= 0 && clock <= 3600;
    if (!timed && (type === 'Kill' || type === 'DBNO')) strange = true;
    if (type === 'Kill' && (!known.has(update.username) || !known.has(update.target)))
      warnings.push('Kill mit unbekanntem Spieler');
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
  if (strange) warnings.push('Rundenuhr unplausibel');
  const counted = round.stats?.find((s) => s.username === me.username)?.kills;
  if (counted !== undefined && counted !== kills.length)
    warnings.push(`Kills laut Killfeed ${kills.length}, laut Statistik ${counted}`);
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
 * Fehlt einer Runde das Ende (Datei später geschrieben als die Runde dauern kann), gilt der
 * Beginn der nächsten Runde desselben Matches.
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
  /** Überlappung mit dem Clip in Sekunden. */
  overlap: number;
  candidates: { file: string; number: number; overlap: number }[];
  reason?: string;
}

/**
 * Die Runde eines Clips über die Uhrzeit. Lieber keine als eine falsche: Liegen zwei Runden
 * nennenswert im Clip, bleibt es offen.
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
    return { overlap: 0, candidates: listed, reason: 'keine Runde im Clipfenster' };
  if (candidates[1] && candidates[1].overlap > length * 0.3)
    return { overlap: 0, candidates: listed, reason: 'mehrere Runden im Clip' };
  return { round: candidates[0].round, overlap: listed[0].overlap, candidates: listed };
}

export interface MatchFolder {
  folder: string;
  name: string;
  rounds: string[];
}

/** Match-Ordner mit ihren Runden; ein Ordner, der selbst .rec-Dateien enthält, gilt als ein Match. */
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

/** Wo das Spiel die Match-Replays üblicherweise ablegt: im Installationsordner (Ubisoft Connect, Steam). */
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

/** Ordner für Hilfsprogramme, neben den Modellen von npm run laughs. */
export function toolFolder(env: NodeJS.ProcessEnv = process.env) {
  return env.LOCALAPPDATA
    ? join(env.LOCALAPPDATA, 'ReplayHaven', 'tools')
    : join(homedir(), '.cache', 'replayhaven', 'tools');
}

/** Das gebaute Programm; der Name trägt den Quellstand, ein neuer Stand baut neu. */
export function dissectFile(folder = toolFolder(), platform: NodeJS.Platform = process.platform) {
  return join(
    folder,
    `r6-dissect-${DISSECT.commit.slice(0, 7)}${platform === 'win32' ? '.exe' : ''}`,
  );
}

/** Startet ein Programm ohne Shell und liefert seine Ausgabe; wirft mit dem Ende von stderr. */
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
        new Error(`${basename(command)} endete mit ${code ?? signal}${tail ? `: ${tail}` : ''}`),
      );
    });
  });
}

const missing = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';

/**
 * Baut r6-dissect aus dem gepinnten Quellstand. Git prüft den Stand über den Commit-Hash, Go
 * die Abhängigkeiten über go.sum. Braucht Go und Git; unter Windows etwa per
 * "winget install GoLang.Go".
 */
export async function buildDissect(target = dissectFile(), log: (line: string) => void = () => {}) {
  for (const [tool, hint] of [
    ['go', 'Go fehlt. Unter Windows: winget install GoLang.Go, danach ein neues Terminal öffnen.'],
    ['git', 'Git fehlt. Unter Windows: winget install Git.Git, danach ein neues Terminal öffnen.'],
  ] as const) {
    try {
      await execute(tool, ['version']);
    } catch (error) {
      throw missing(error) ? new Error(hint) : error;
    }
  }
  const work = await mkdtemp(join(tmpdir(), 'r6-dissect-'));
  try {
    log(`Lade Quellstand ${DISSECT.commit.slice(0, 7)} von ${DISSECT.repository} …`);
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
    if (head !== DISSECT.commit) throw new Error(`Unerwarteter Quellstand ${head}.`);
    log('Baue r6-dissect mit Go …');
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

/** Liest eine Runde mit r6-dissect. Eine Runde braucht hier 2 bis 6 Sekunden. */
export async function readRound(program: string, file: string) {
  return parseDissect(await execute(program, [file], { timeout: 3 * 60000 }));
}

/**
 * Wo der Client die Matches zu gespeicherten Clips aufbewahrt. Das Spiel behält nur die jüngsten
 * Matches (am 2026-09-25 hier 30, zusammen 940 MB) und löscht ältere; ohne Kopie wären die Runden
 * zu älteren Clips verloren, bevor die Auswertung sie nutzen kann.
 */
export function replayArchive(env: NodeJS.ProcessEnv = process.env) {
  return env.LOCALAPPDATA
    ? join(env.LOCALAPPDATA, 'ReplayHaven', 'r6-replays')
    : join(homedir(), '.cache', 'replayhaven', 'r6-replays');
}

/** Beginn eines Matches laut Ordnername ("Match-2026-07-12_20-41-13-36588"), in Ortszeit. */
export function matchStarted(name: string) {
  const m = /^Match-(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/.exec(name);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : undefined;
}

/** So lange nach der letzten Runde kann ein Clip noch gespeichert werden (Endbildschirm). */
const AFTER_MATCH_MS = 10 * 60000;

/**
 * Sichert das Match, in dem ein Clip gespeichert wurde: vom Start laut Ordnername bis kurz nach
 * der letzten geschriebenen Runde. Schon kopierte Runden bleiben, neue kommen dazu. Liefert den
 * Zielordner und ob das Match womöglich noch läuft (letzte Runde jünger als fünf Minuten); dann
 * lohnt ein späterer zweiter Aufruf.
 */
export async function keepMatchForClip(
  savedAt: number,
  roots: readonly string[] = defaultReplayFolders(),
  archive = replayArchive(),
  now = Date.now(),
): Promise<{ target: string; running: boolean } | undefined> {
  // Das jüngste Match, das vor dem Clip begann: Das vorige kann noch im Nachlauf liegen
  // (Clip 20:45, Match von 20:25 endete 20:38, das nächste begann 20:41; Test vom 2026-09-25).
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
    // Eine Runde, die beim letzten Mal noch geschrieben wurde, wird ersetzt.
    if (!to || to.size !== from.size) await cp(round, copy, { force: true });
  }
  return { target, running: now - best.last < 5 * 60000 };
}
