import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { readReplayFile } from './replay';
import type { Elimination, Replay, ReplayPlayer } from './replay';
import type { GameEvent, Weapon } from './events';
import { sameGame } from './players';

/**
 * Fortnite events for clips, exact from the replays Fortnite stores for every match under
 * %LOCALAPPDATA%\FortniteGame\Saved\Demos. Three steps:
 *
 * 1. Clip time: NVIDIA writes the local time into the file name. Whether it means the save
 *    (= clip end) or the recording start is shown by the file's modification time (clipWindow).
 * 2. Own account: a replay does not say who recorded it. It follows from configured IDs, from
 *    recurrence across this PC's replays and from the match stats (resolveOwner). If it stays
 *    open, there are no replay events: better none than someone else's.
 * 3. Events: kills, knocks, own elimination and victory in the clip window, with weapon and
 *    distance (clipEvents).
 */

/**
 * Death causes (EDeathCause) as Fortnite writes them in eliminations. Verified on replays up to
 * version 32.00 (2024); newer seasons could change the order, so the weapon type is one of the
 * measurement criteria.
 */
const CAUSES: Record<number, Weapon> = {
  0: 'storm',
  1: 'fall',
  2: 'pistol',
  3: 'shotgun',
  4: 'rifle',
  5: 'smg',
  6: 'sniper',
  7: 'noscope',
  8: 'melee',
  10: 'explosive',
  11: 'explosive',
  12: 'explosive',
  13: 'explosive',
  14: 'minigun',
  15: 'bow',
  16: 'trap',
  23: 'vehicle',
  29: 'lmg',
  30: 'explosive',
  38: 'storm',
};
/** Knocked down and bled out (DBNOTimeout): the weapon is on the knock before it. */
const BLEED_OUT = 17;
/** Ban, removal, spectating, logout, team switch, victory, unknown: not a death in the game. */
const NOT_A_DEATH = new Set([18, 19, 46, 47, 48, 49, 50]);
/** Two kills at most this far apart form a streak, as with read messages. */
const SERIES_GAP_MS = 12000;
/** The longest a clip waits for its match to end. */
export const MAX_WAIT_MS = 45 * 60000;

export function isFortnite(game: string) {
  return sameGame('Fortnite', game);
}

/** Default replay folder on Windows. */
export function defaultDemosFolder(env: NodeJS.ProcessEnv = process.env) {
  return env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'FortniteGame', 'Saved', 'Demos') : '';
}

/**
 * Local time from an NVIDIA file name, without time zone (as if written in UTC):
 * "Fortnite 2025.02.14 - 16.55.58.18.Eliminierung.DVR.mp4". The last number is a running
 * counter, not hundredths of a second.
 */
export function nvidiaLocalTime(path: string): number | undefined {
  const match = /(\d{4})\.(\d{2})\.(\d{2}) - (\d{2})\.(\d{2})\.(\d{2})\.\d+(?:\.|$)/.exec(
    basename(path),
  );
  if (!match) return undefined;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  const back = new Date(ms);
  if (back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) return undefined;
  if (hour > 23 || minute > 59 || second > 59) return undefined;
  return ms;
}

/** Converts this PC's local time (written as UTC) to real UTC milliseconds. */
export function localToUtc(naive: number) {
  const d = new Date(naive);
  return new Date(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
    d.getUTCMilliseconds(),
  ).getTime();
}

export interface ClipWindow {
  /** Start and end of the clip in UTC milliseconds. */
  start: number;
  end: number;
  /** name-end: file name = save (clip end); name-start: file name = recording start. */
  anchor: 'name-end' | 'name-start';
}

/**
 * Time window of a clip in UTC. NVIDIA writes the file when saving, so its modification time is
 * a few seconds after the clip end. If the file name fits that as the end, it means the save; if
 * it fits as the start, the recording. If both fit (very short clips) or neither (copied or
 * edited file), the time stays open.
 */
export function clipWindow(
  path: string,
  duration: number,
  mtime: number,
  toUtc: (naive: number) => number = localToUtc,
): ClipWindow | undefined {
  const local = nvidiaLocalTime(path);
  if (local === undefined || !(duration > 0) || !Number.isFinite(mtime)) return undefined;
  const named = toUtc(local);
  const length = duration * 1000;
  // Name accurate to the second, file write: -2 to +15 seconds until the modification time.
  const fits = (clipEnd: number) => mtime - clipEnd >= -2000 && mtime - clipEnd <= 15000;
  const asEnd = fits(named);
  const asStart = fits(named + length);
  if (asEnd === asStart) return undefined;
  return asEnd
    ? { start: named - length, end: named, anchor: 'name-end' }
    : { start: named, end: named + length, anchor: 'name-start' };
}

/** Start of the recording in UTC: from the timecode event, otherwise from the local time in the header. */
export function replayStart(replay: Replay, toUtc: (naive: number) => number = localToUtc) {
  if (replay.utcStart !== undefined) return replay.utcStart;
  return replay.localStart !== undefined ? toUtc(replay.localStart) : undefined;
}

const idOf = (p: ReplayPlayer) => (p.kind === 'player' ? p.id : undefined);
/** The same participant; nameless bots cannot be told apart. */
const same = (a: ReplayPlayer, b: ReplayPlayer) =>
  a.kind !== 'bot' && a.kind === b.kind && a.id === b.id;

/** All player IDs of a replay. */
export function playersIn(replay: Replay) {
  const ids = new Set<string>();
  for (const e of replay.eliminations)
    for (const id of [idOf(e.victim), idOf(e.killer)]) if (id) ids.add(id);
  return ids;
}

export interface OwnerResult {
  id?: string;
  /** Why this ID, or why none, for measurement runs. */
  basis: string[];
}

/**
 * The Epic account ID of the recording player. Weighted clues:
 * - configured own IDs decide alone if exactly one appears in the replay;
 * - recurrence (+2): whoever plays on this PC appears in almost every one of its replays, other
 *   players almost never in two; teammates from regular groups do too, though;
 * - own elimination (+2, +1 in team modes): the match stats are written when the player's own
 *   match ends; whoever is eliminated at exactly that moment is usually the owner. In team modes
 *   it may only end with the last team member;
 * - kill count (+1): own eliminations per stats, at most one off (on real replays: 7 vs 8,
 *   7 vs 6). Only from one kill up, since zero fits almost everyone;
 * - visibility (exclusion): the replay knows the player's own position while they are alive.
 *   Anyone who appears as a shooter without a position while alive was far away and is not the
 *   owner.
 * A decision needs at least three points and a two-point lead, so never recurrence alone: it
 * does not separate the owner from regular teammates. In team modes (there are knocks or
 * respawns) there is no decision as soon as another player recurs: better no account than a
 * teammate's kills. Then only the configured account ID helps.
 */
export function resolveOwner(
  replay: Replay,
  recurrence: ReadonlyMap<string, number>,
  accounts: readonly string[] = [],
): OwnerResult {
  const players = playersIn(replay);
  const own = accounts.map((a) => a.toLowerCase()).filter((a) => players.has(a));
  if (accounts.length) {
    if (own.length === 1) return { id: own[0], basis: ['configured account ID'] };
    return {
      basis: [
        own.length
          ? 'several configured account IDs in the same match'
          : 'no configured account ID in this replay',
      ],
    };
  }
  const elims = replay.eliminations;
  // From Chapter 2 on, the replay knows every victim's position; only then does a missing one mean something.
  const located = elims.length > 0 && elims.filter((e) => e.victimAt).length / elims.length >= 0.9;
  // Knocks exist only in team modes, repeated eliminations only with respawn (e.g. Team Rumble).
  const deaths = new Map<string, number>();
  for (const e of elims) {
    const id = idOf(e.victim);
    if (id && !e.knocked) deaths.set(id, (deaths.get(id) ?? 0) + 1);
  }
  const teams = elims.some((e) => e.knocked) || [...deaths.values()].some((n) => n > 1);
  const scores = new Map<string, { score: number; basis: string[] }>();
  const add = (id: string, points: number, why: string) => {
    const entry = scores.get(id) ?? { score: 0, basis: [] };
    entry.score += points;
    entry.basis.push(why);
    scores.set(id, entry);
  };
  const stated = replay.stats?.eliminations ?? 0;
  for (const id of players) {
    const seen = recurrence.get(id) ?? 0;
    if (seen >= 2) add(id, 2, `in ${seen} other replays`);
    else if (seen === 1) add(id, 1, 'in one other replay');
    const finals = elims.filter(
      (e) => idOf(e.killer) === id && idOf(e.victim) !== id && !e.knocked,
    ).length;
    if (stated > 0 && finals > 0 && Math.abs(finals - stated) <= 1)
      add(id, 1, `${finals} eliminations, stats ${stated}`);
  }
  if (replay.stats && (replay.team?.placement ?? 2) > 1)
    for (const e of elims) {
      const id = idOf(e.victim);
      if (id && !e.knocked && Math.abs(e.time - replay.stats.time) <= 500)
        add(id, teams ? 1 : 2, 'eliminated when the own match ends');
    }
  // Credits after the player's own elimination, e.g. for an enemy who bleeds out afterwards, can
  // come without a position, so they do not count.
  const hidden = (id: string) => {
    const out = elims.filter((e) => idOf(e.victim) === id && !e.knocked).at(-1)?.time ?? Infinity;
    return elims.some(
      (e) =>
        idOf(e.killer) === id &&
        idOf(e.victim) !== id &&
        !e.killerAt &&
        e.cause !== BLEED_OUT &&
        e.time < out,
    );
  };
  if (located) for (const id of [...scores.keys()]) if (hidden(id)) scores.delete(id);
  const ranked = [...scores.entries()].sort((a, b) => b[1].score - a[1].score);
  const [best, second] = ranked;
  if (!best || best[1].score < 3) return { basis: ['no player with enough clues'] };
  if (second && best[1].score - second[1].score < 2)
    return { basis: [`ambiguous: ${best[0]} or ${second[0]}`] };
  const regulars = [...players].filter((id) => id !== best[0] && (recurrence.get(id) ?? 0) > 0);
  if (teams && regulars.length)
    return {
      basis: [
        `team mode with ${regulars.length} other players from other replays: enter your own account ID`,
      ],
    };
  return { id: best[0], basis: best[1].basis };
}

/** Distance in metres between victim and shooter, if both positions are known. */
function distanceOf(e: Elimination) {
  if (!e.victimAt || !e.killerAt) return undefined;
  const d = Math.hypot(
    e.victimAt.x - e.killerAt.x,
    e.victimAt.y - e.killerAt.y,
    e.victimAt.z - e.killerAt.z,
  );
  return Math.round(d) / 100;
}

/** Weapon of an elimination; for a bleed-out, that of the preceding knock. */
function weaponOf(e: Elimination, knock?: Elimination) {
  return CAUSES[e.cause === BLEED_OUT && knock ? knock.cause : e.cause];
}

/**
 * The owner's events in the clip window, with seconds in the clip. `start` is the recording
 * start in UTC. Events up to one second before and two after the clip count too (that is how
 * precise the time in the file name is) and are moved to the edge.
 */
export function clipEvents(
  replay: Replay,
  owner: string,
  start: number,
  window: ClipWindow,
): GameEvent[] {
  const duration = (window.end - window.start) / 1000;
  const second = (time: number) => (start + time - window.start) / 1000;
  const inClip = (time: number) => second(time) >= -1 && second(time) <= duration + 2;
  const at = (time: number) => Math.round(Math.min(duration, Math.max(0, second(time))) * 10) / 10;
  const events: GameEvent[] = [];
  const kills: { time: number; weapon?: Weapon }[] = [];
  for (const e of replay.eliminations) {
    const killer = idOf(e.killer);
    const victim = idOf(e.victim);
    if (!inClip(e.time)) continue;
    if (killer === owner && victim !== owner) {
      const knock = replay.eliminations
        .filter(
          (k) =>
            k.knocked && k.time <= e.time && idOf(k.killer) === owner && same(k.victim, e.victim),
        )
        .at(-1);
      const bled = e.cause === BLEED_OUT;
      const weapon = weaponOf(e, knock);
      const distance = bled ? knock && distanceOf(knock) : distanceOf(e);
      const kind = e.knocked ? 'knock' : 'kill';
      events.push({
        kind,
        seconds: at(e.time),
        text: `Replay: ${kind === 'knock' ? 'Knock' : bled ? 'Kill (bled out)' : 'Kill'}${weapon ? `, ${weapon}` : ''}${distance !== undefined ? `, ${Math.round(distance)} m` : ''}`,
        source: 'replay',
        ...(weapon ? { weapon } : {}),
        ...(distance !== undefined ? { distance } : {}),
      });
      if (!e.knocked) kills.push({ time: e.time, weapon });
    } else if (victim === owner && !e.knocked && !NOT_A_DEATH.has(e.cause)) {
      const weapon = CAUSES[e.cause];
      const distance = killer !== owner ? distanceOf(e) : undefined;
      events.push({
        kind: 'death',
        seconds: at(e.time),
        text: `Replay: eliminated${weapon ? `, ${weapon}` : ''}`,
        source: 'replay',
        ...(weapon ? { weapon } : {}),
        ...(distance !== undefined ? { distance } : {}),
      });
    }
  }
  // Streaks: kills at most twelve seconds apart, reported at the last kill.
  let chain: typeof kills = [];
  const flush = () => {
    if (chain.length >= 2) {
      const weapons = new Set(chain.map((k) => k.weapon));
      const weapon = weapons.size === 1 ? chain[0].weapon : undefined;
      events.push({
        kind: 'multikill',
        seconds: at(chain.at(-1)!.time),
        text: `Replay: ${chain.length} kills in a row`,
        source: 'replay',
        count: chain.length,
        ...(weapon ? { weapon } : {}),
      });
    }
    chain = [];
  };
  for (const kill of kills) {
    if (chain.length && kill.time - chain.at(-1)!.time > SERIES_GAP_MS) flush();
    chain.push(kill);
  }
  flush();
  // Victory: the player's own match ends in first place within the clip.
  if (replay.team?.placement === 1 && replay.stats && inClip(replay.stats.time))
    events.push({
      kind: 'matchWon',
      seconds: at(replay.stats.time),
      text: 'Replay: first place',
      source: 'replay',
    });
  return events.sort((a, b) => a.seconds! - b.seconds!);
}

/** What a replay contributes to a clip. */
export interface ReplayTrace {
  status: 'ok' | 'wait' | 'none';
  /** Why no replay was used. */
  reason?: string;
  file?: string;
  gameVersion?: string;
  owner?: string;
  basis?: string[];
  anchor?: ClipWindow['anchor'];
  /** Second of the recording at which the clip starts. */
  clipStartInReplay?: number;
}

export interface ReplayLookup {
  status: 'ok' | 'wait' | 'none';
  /** Only with "ok": the owner's events in the clip; empty means none of them happened. */
  events: GameEvent[];
  trace: ReplayTrace;
}

type Loaded = { path: string; key: string; mtime: number; replay?: Replay; error?: string };

/** In how many other finished replays each player ID appears. */
function recurrenceBesides(finished: { path: string; replay: Replay }[], path: string) {
  const recurrence = new Map<string, number>();
  for (const l of finished)
    if (l.path !== path)
      for (const id of playersIn(l.replay)) recurrence.set(id, (recurrence.get(id) ?? 0) + 1);
  return recurrence;
}

/** A replay overview for measurement runs (agent/fortnite-cli.ts). */
export interface ReplaySurvey {
  file: string;
  error?: string;
  live?: boolean;
  gameVersion?: string;
  /** Start in UTC, ISO format. */
  start?: string;
  minutes?: number;
  placement?: number;
  statsEliminations?: number;
  eliminations?: number;
  unreadable?: number;
  owner?: OwnerResult;
}

/**
 * The replays of a folder. Only the preamble, header and events are read; the result stays
 * cached per file as long as size and modification time do not change.
 */
export class FortniteReplays {
  private cache = new Map<string, Loaded>();
  constructor(
    readonly options: {
      folder: string;
      /** Configured own Epic account IDs; empty: detect automatically. */
      accounts?: string[];
      toUtc?: (naive: number) => number;
    },
  ) {}

  /** All readable replays of the folder. If the folder is missing, the list is empty. */
  async load(): Promise<Loaded[]> {
    let names: string[];
    try {
      names = (await readdir(this.options.folder)).filter((n) =>
        n.toLowerCase().endsWith('.replay'),
      );
    } catch {
      return [];
    }
    const paths = names.map((name) => join(this.options.folder, name));
    // Replays that Fortnite has deleted in the meantime drop out of the cache.
    for (const cached of this.cache.keys()) if (!paths.includes(cached)) this.cache.delete(cached);
    const infos = await Promise.all(paths.map((path) => stat(path).catch(() => undefined)));
    const loaded: Loaded[] = [];
    for (const [i, path] of paths.entries()) {
      const info = infos[i];
      if (!info) continue; // vanished between listing and reading
      const key = `${info.size}:${info.mtimeMs}`;
      let entry = this.cache.get(path);
      if (entry?.key !== key) {
        try {
          entry = { path, key, mtime: info.mtimeMs, replay: await readReplayFile(path) };
        } catch (error) {
          entry = {
            path,
            key,
            mtime: info.mtimeMs,
            error: error instanceof Error ? error.message : 'unreadable',
          };
        }
        this.cache.set(path, entry);
      }
      loaded.push(entry);
    }
    return loaded;
  }

  /** Overview of all replays in the folder with the detected account, for measurement runs. */
  async survey(): Promise<ReplaySurvey[]> {
    const toUtc = this.options.toUtc ?? localToUtc;
    const loaded = await this.load();
    const finished = loaded.filter(
      (l): l is Loaded & { replay: Replay } => !!l.replay && !l.replay.live,
    );
    return loaded.map((l) => {
      const file = basename(l.path);
      if (!l.replay) return { file, error: l.error };
      const begun = replayStart(l.replay, toUtc);
      return {
        file,
        live: l.replay.live,
        ...(l.replay.gameVersion ? { gameVersion: l.replay.gameVersion } : {}),
        ...(begun !== undefined ? { start: new Date(begun).toISOString() } : {}),
        minutes: Math.round(l.replay.lengthMs / 6000) / 10,
        ...(l.replay.team ? { placement: l.replay.team.placement } : {}),
        ...(l.replay.stats ? { statsEliminations: l.replay.stats.eliminations } : {}),
        eliminations: l.replay.eliminations.length,
        unreadable: l.replay.unreadable,
        ...(l.replay.live
          ? {}
          : {
              owner: resolveOwner(
                l.replay,
                recurrenceBesides(finished, l.path),
                this.options.accounts ?? [],
              ),
            }),
      };
    });
  }

  /**
   * For the analysis: only Fortnite clips, and it waits at most 45 minutes after saving. If a
   * replay stays open longer (crash, match in the background), the frames count.
   */
  async forClip(path: string, game: string, duration: number, now = Date.now()) {
    if (!isFortnite(game)) return undefined;
    const { mtimeMs } = await stat(path);
    const result = await this.lookup(path, duration, mtimeMs);
    if (result.status !== 'wait' || now - mtimeMs <= MAX_WAIT_MS) return result;
    return {
      status: 'none',
      events: [],
      trace: { ...result.trace, status: 'none', reason: 'match not finished after 45 minutes' },
    } satisfies ReplayLookup;
  }

  /**
   * Replay events for a clip. "wait" means a match is recording right now and began before the
   * clip end: the clip probably belongs to it, and the events are only settled after the match.
   */
  async lookup(clip: string, duration: number, mtime: number): Promise<ReplayLookup> {
    const toUtc = this.options.toUtc ?? localToUtc;
    const none = (reason: string, trace: Partial<ReplayTrace> = {}): ReplayLookup => ({
      status: 'none',
      events: [],
      trace: { status: 'none', reason, ...trace },
    });
    const window = clipWindow(clip, duration, mtime, toUtc);
    if (!window) return none('recording time from file name and modification time is ambiguous');
    const loaded = await this.load();
    // Running: marked live, begun before the clip end and still written since the clip start.
    // A replay left open by a crash is no longer written and holds nothing up.
    const running = loaded.find((l) => {
      if (!l.replay?.live) return false;
      const begun = replayStart(l.replay, toUtc);
      return begun !== undefined && begun <= window.end && l.mtime >= window.start;
    });
    if (running)
      return {
        status: 'wait',
        events: [],
        trace: { status: 'wait', file: basename(running.path), anchor: window.anchor },
      };
    const finished = loaded.filter(
      (l): l is Loaded & { replay: Replay } => !!l.replay && !l.replay.live,
    );
    const covering = finished
      .map((l) => ({ ...l, begun: replayStart(l.replay, toUtc) }))
      .filter(
        (l) =>
          l.begun !== undefined &&
          l.begun <= window.end &&
          l.begun + l.replay.lengthMs >= window.end - 1000,
      )
      .sort((a, b) => b.begun! - a.begun!)[0];
    if (!covering) return none('no replay covers the recording time', { anchor: window.anchor });
    const owner = resolveOwner(
      covering.replay,
      recurrenceBesides(finished, covering.path),
      this.options.accounts ?? [],
    );
    const trace: ReplayTrace = {
      status: 'ok',
      file: basename(covering.path),
      ...(covering.replay.gameVersion ? { gameVersion: covering.replay.gameVersion } : {}),
      basis: owner.basis,
      anchor: window.anchor,
      clipStartInReplay: Math.round((window.start - covering.begun!) / 100) / 10,
    };
    if (!owner.id) return none('own account is ambiguous', trace);
    return {
      status: 'ok',
      events: clipEvents(covering.replay, owner.id, covering.begun!, window),
      trace: { ...trace, owner: owner.id },
    };
  }
}
