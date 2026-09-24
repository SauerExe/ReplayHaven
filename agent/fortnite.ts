import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { readReplayFile } from './replay';
import type { Elimination, Replay, ReplayPlayer } from './replay';
import type { GameEvent, Weapon } from './events';
import { sameGame } from './players';

/**
 * Fortnite-Ereignisse für Clips, exakt aus den Replays, die Fortnite von jedem Match unter
 * %LOCALAPPDATA%\FortniteGame\Saved\Demos ablegt. Drei Schritte:
 *
 * 1. Clipzeit: NVIDIA schreibt die Ortszeit in den Dateinamen. Ob sie das Speichern (= Clipende)
 *    oder den Aufnahmebeginn meint, zeigt der Änderungszeitpunkt der Datei (clipWindow).
 * 2. Eigenes Konto: Ein Replay nennt nicht, wer aufgenommen hat. Es folgt aus eingetragenen
 *    IDs, aus der Wiederkehr über die Replays dieses PCs und aus der Match-Statistik
 *    (resolveOwner). Bleibt es offen, gibt es keine Replay-Ereignisse — lieber keine als fremde.
 * 3. Ereignisse: Kills, Knocks, eigenes Ausscheiden und Sieg im Clipfenster, mit Waffe und
 *    Entfernung (clipEvents).
 */

/**
 * Todesursachen (EDeathCause), wie Fortnite sie in Eliminierungen schreibt. Geprüft an
 * Replays bis Version 32.00 (2024); neuere Saisons könnten die Reihenfolge ändern, deshalb
 * gehört die Waffenart zu den Messkriterien.
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
/** Niedergeschlagen und ausgeblutet (DBNOTimeout): Die Waffe steht beim Knock davor. */
const BLEED_OUT = 17;
/** Bann, Entfernen, Zuschauen, Abmelden, Teamwechsel, Sieg, unbekannt: kein Tod im Spiel. */
const NOT_A_DEATH = new Set([18, 19, 46, 47, 48, 49, 50]);
/** Zwei Kills mit höchstens so viel Abstand bilden eine Serie, wie bei gelesenen Meldungen. */
const SERIES_GAP_MS = 12000;
/** Wie lange ein Clip höchstens auf das Ende seines Matches wartet. */
export const MAX_WAIT_MS = 45 * 60000;

export function isFortnite(game: string) {
  return sameGame('Fortnite', game);
}

/** Standardordner der Replays unter Windows. */
export function defaultDemosFolder(env: NodeJS.ProcessEnv = process.env) {
  return env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'FortniteGame', 'Saved', 'Demos') : '';
}

/**
 * Ortszeit aus einem NVIDIA-Dateinamen, ohne Zeitzone (als wäre sie UTC notiert):
 * "Fortnite 2025.02.14 - 16.55.58.18.Eliminierung.DVR.mp4". Die letzte Zahl ist eine laufende
 * Nummer, keine Hundertstelsekunde.
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

/** Ortszeit dieses PCs (als UTC notiert) in echte UTC-Millisekunden. */
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
  /** Beginn und Ende des Clips in UTC-Millisekunden. */
  start: number;
  end: number;
  /** name-end: Dateiname = Speichern (Clipende); name-start: Dateiname = Aufnahmebeginn. */
  anchor: 'name-end' | 'name-start';
}

/**
 * Zeitfenster eines Clips in UTC. NVIDIA schreibt die Datei beim Speichern; ihr
 * Änderungszeitpunkt liegt deshalb wenige Sekunden nach dem Clipende. Passt der Dateiname dazu
 * als Ende, meint er das Speichern; passt er als Beginn, die Aufnahme. Passt beides (sehr kurze
 * Clips) oder nichts (kopierte oder bearbeitete Datei), bleibt die Zeit offen.
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
  // Sekundengenauer Name, Schreiben der Datei: -2 bis +15 Sekunden bis zum Änderungszeitpunkt.
  const fits = (clipEnd: number) => mtime - clipEnd >= -2000 && mtime - clipEnd <= 15000;
  const asEnd = fits(named);
  const asStart = fits(named + length);
  if (asEnd === asStart) return undefined;
  return asEnd
    ? { start: named - length, end: named, anchor: 'name-end' }
    : { start: named, end: named + length, anchor: 'name-start' };
}

/** Beginn der Aufzeichnung in UTC: aus dem Timecode-Ereignis, sonst aus der Ortszeit im Kopf. */
export function replayStart(replay: Replay, toUtc: (naive: number) => number = localToUtc) {
  if (replay.utcStart !== undefined) return replay.utcStart;
  return replay.localStart !== undefined ? toUtc(replay.localStart) : undefined;
}

const idOf = (p: ReplayPlayer) => (p.kind === 'player' ? p.id : undefined);
/** Derselbe Beteiligte; namenlose Bots lassen sich nicht auseinanderhalten. */
const same = (a: ReplayPlayer, b: ReplayPlayer) =>
  a.kind !== 'bot' && a.kind === b.kind && a.id === b.id;

/** Alle Spieler-IDs eines Replays. */
export function playersIn(replay: Replay) {
  const ids = new Set<string>();
  for (const e of replay.eliminations)
    for (const id of [idOf(e.victim), idOf(e.killer)]) if (id) ids.add(id);
  return ids;
}

export interface OwnerResult {
  id?: string;
  /** Warum diese ID, oder warum keine — für Messläufe. */
  basis: string[];
}

/**
 * Die Epic-Konto-ID des aufnehmenden Spielers. Hinweise, gewichtet:
 * - eingetragene eigene IDs entscheiden allein, wenn genau eine im Replay vorkommt;
 * - Wiederkehr (+2): Wer auf diesem PC spielt, steht in fast jedem seiner Replays, fremde
 *   Spieler fast nie in zwei; Mitspieler aus festen Gruppen allerdings auch;
 * - eigenes Ausscheiden (+2, im Teammodus +1): Die Match-Statistik entsteht, wenn das eigene
 *   Match endet; scheidet genau dann jemand aus, ist das meist der Besitzer. Im Teammodus endet
 *   es womöglich erst mit dem letzten Teammitglied;
 * - Kill-Zahl (+1): Eigene Eliminierungen laut Statistik, höchstens eine Abweichung (an echten
 *   Replays: 7 statt 8, 7 statt 6). Erst ab einem Kill, null passt auf fast jeden;
 * - Sichtbarkeit (Ausschluss): Der eigene Standort ist dem Replay bekannt, solange man lebt.
 *   Wer zu Lebzeiten als Schütze ohne Standort vorkommt, war weit weg und ist nicht der Besitzer.
 * Entschieden wird nur mit mindestens drei Punkten und zwei Punkten Vorsprung, also nie allein
 * aus Wiederkehr: Die trennt den Besitzer nicht von festen Mitspielern. Im Teammodus (es gibt
 * Knocks oder Respawns) gibt es keine Entscheidung, sobald ein weiterer Spieler wiederkehrt:
 * Lieber kein Konto als die Kills eines Mitspielers. Dann hilft nur die eingetragene Konto-ID.
 */
export function resolveOwner(
  replay: Replay,
  recurrence: ReadonlyMap<string, number>,
  accounts: readonly string[] = [],
): OwnerResult {
  const players = playersIn(replay);
  const own = accounts.map((a) => a.toLowerCase()).filter((a) => players.has(a));
  if (accounts.length) {
    if (own.length === 1) return { id: own[0], basis: ['eingetragene Konto-ID'] };
    return {
      basis: [
        own.length
          ? 'mehrere eingetragene Konto-IDs im selben Match'
          : 'keine eingetragene Konto-ID in diesem Replay',
      ],
    };
  }
  const elims = replay.eliminations;
  // Ab Kapitel 2 kennt das Replay den Ort jedes Opfers; nur dann taugt ein fehlender Ort.
  const located = elims.length > 0 && elims.filter((e) => e.victimAt).length / elims.length >= 0.9;
  // Knocks gibt es nur im Teammodus, mehrfaches Ausscheiden nur mit Respawn (etwa Team Rumble).
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
    if (seen >= 2) add(id, 2, `in ${seen} weiteren Replays`);
    else if (seen === 1) add(id, 1, 'in einem weiteren Replay');
    const finals = elims.filter(
      (e) => idOf(e.killer) === id && idOf(e.victim) !== id && !e.knocked,
    ).length;
    if (stated > 0 && finals > 0 && Math.abs(finals - stated) <= 1)
      add(id, 1, `${finals} Eliminierungen, Statistik ${stated}`);
  }
  if (replay.stats && (replay.team?.placement ?? 2) > 1)
    for (const e of elims) {
      const id = idOf(e.victim);
      if (id && !e.knocked && Math.abs(e.time - replay.stats.time) <= 500)
        add(id, teams ? 1 : 2, 'scheidet aus, als das eigene Match endet');
    }
  // Gutschriften nach dem eigenen Aus, etwa für einen Gegner, der danach ausblutet, können ohne
  // Standort kommen; sie zählen deshalb nicht.
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
  if (!best || best[1].score < 3) return { basis: ['kein Spieler mit genug Hinweisen'] };
  if (second && best[1].score - second[1].score < 2)
    return { basis: [`nicht eindeutig: ${best[0]} oder ${second[0]}`] };
  const regulars = [...players].filter((id) => id !== best[0] && (recurrence.get(id) ?? 0) > 0);
  if (teams && regulars.length)
    return {
      basis: [
        `Teammodus mit ${regulars.length} weiteren Spielern aus anderen Replays: eigene Konto-ID eintragen`,
      ],
    };
  return { id: best[0], basis: best[1].basis };
}

/** Entfernung in Metern zwischen Opfer und Schütze, wenn beide Orte bekannt sind. */
function distanceOf(e: Elimination) {
  if (!e.victimAt || !e.killerAt) return undefined;
  const d = Math.hypot(
    e.victimAt.x - e.killerAt.x,
    e.victimAt.y - e.killerAt.y,
    e.victimAt.z - e.killerAt.z,
  );
  return Math.round(d) / 100;
}

/** Waffe einer Eliminierung; beim Ausbluten die des vorangegangenen Knocks. */
function weaponOf(e: Elimination, knock?: Elimination) {
  return CAUSES[e.cause === BLEED_OUT && knock ? knock.cause : e.cause];
}

/**
 * Die Ereignisse des Besitzers im Clipfenster, mit Sekunden im Clip. `start` ist der Beginn der
 * Aufzeichnung in UTC. Ereignisse bis eine Sekunde vor und zwei nach dem Clip zählen mit — so
 * genau ist die Zeit im Dateinamen — und werden an den Rand gelegt.
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
        text: `Replay: ${kind === 'knock' ? 'Knock' : bled ? 'Kill (ausgeblutet)' : 'Kill'}${weapon ? `, ${weapon}` : ''}${distance !== undefined ? `, ${Math.round(distance)} m` : ''}`,
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
        text: `Replay: ausgeschieden${weapon ? `, ${weapon}` : ''}`,
        source: 'replay',
        ...(weapon ? { weapon } : {}),
        ...(distance !== undefined ? { distance } : {}),
      });
    }
  }
  // Serien: Kills mit höchstens zwölf Sekunden Abstand, gemeldet beim letzten Kill.
  let chain: typeof kills = [];
  const flush = () => {
    if (chain.length >= 2) {
      const weapons = new Set(chain.map((k) => k.weapon));
      const weapon = weapons.size === 1 ? chain[0].weapon : undefined;
      events.push({
        kind: 'multikill',
        seconds: at(chain.at(-1)!.time),
        text: `Replay: ${chain.length} Kills in Folge`,
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
  // Sieg: Das eigene Match endet mit Platz 1 innerhalb des Clips.
  if (replay.team?.placement === 1 && replay.stats && inClip(replay.stats.time))
    events.push({
      kind: 'matchWon',
      seconds: at(replay.stats.time),
      text: 'Replay: Platz 1',
      source: 'replay',
    });
  return events.sort((a, b) => a.seconds! - b.seconds!);
}

/** Was ein Replay zu einem Clip beiträgt. */
export interface ReplayTrace {
  status: 'ok' | 'wait' | 'none';
  /** Warum kein Replay genutzt wurde. */
  reason?: string;
  file?: string;
  gameVersion?: string;
  owner?: string;
  basis?: string[];
  anchor?: ClipWindow['anchor'];
  /** Sekunde der Aufzeichnung, bei der der Clip beginnt. */
  clipStartInReplay?: number;
}

export interface ReplayLookup {
  status: 'ok' | 'wait' | 'none';
  /** Nur bei "ok": die Ereignisse des Besitzers im Clip; leer heißt, es geschah nichts davon. */
  events: GameEvent[];
  trace: ReplayTrace;
}

type Loaded = { path: string; key: string; mtime: number; replay?: Replay; error?: string };

/** In wie vielen anderen fertigen Replays jede Spieler-ID vorkommt. */
function recurrenceBesides(finished: { path: string; replay: Replay }[], path: string) {
  const recurrence = new Map<string, number>();
  for (const l of finished)
    if (l.path !== path)
      for (const id of playersIn(l.replay)) recurrence.set(id, (recurrence.get(id) ?? 0) + 1);
  return recurrence;
}

/** Ein Replay im Überblick für Messläufe (agent/fortnite-cli.ts). */
export interface ReplaySurvey {
  file: string;
  error?: string;
  live?: boolean;
  gameVersion?: string;
  /** Beginn in UTC, ISO-Schreibweise. */
  start?: string;
  minutes?: number;
  placement?: number;
  statsEliminations?: number;
  eliminations?: number;
  unreadable?: number;
  owner?: OwnerResult;
}

/**
 * Die Replays eines Ordners. Gelesen werden nur Vorspann, Kopf und Ereignisse; das Ergebnis
 * bleibt je Datei zwischengespeichert, solange sich Größe und Änderungszeit nicht ändern.
 */
export class FortniteReplays {
  private cache = new Map<string, Loaded>();
  constructor(
    readonly options: {
      folder: string;
      /** Eingetragene eigene Epic-Konto-IDs; leer: automatisch erkennen. */
      accounts?: string[];
      toUtc?: (naive: number) => number;
    },
  ) {}

  /** Alle lesbaren Replays des Ordners. Fehlt der Ordner, ist die Liste leer. */
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
    // Replays, die Fortnite inzwischen gelöscht hat, fallen aus dem Zwischenspeicher.
    for (const cached of this.cache.keys()) if (!paths.includes(cached)) this.cache.delete(cached);
    const infos = await Promise.all(paths.map((path) => stat(path).catch(() => undefined)));
    const loaded: Loaded[] = [];
    for (const [i, path] of paths.entries()) {
      const info = infos[i];
      if (!info) continue; // zwischen Auflisten und Lesen verschwunden
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
            error: error instanceof Error ? error.message : 'unlesbar',
          };
        }
        this.cache.set(path, entry);
      }
      loaded.push(entry);
    }
    return loaded;
  }

  /** Überblick über alle Replays des Ordners samt erkanntem Konto, für Messläufe. */
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
   * Für die Analyse: nur Fortnite-Clips, und gewartet wird höchstens 45 Minuten nach dem
   * Speichern. Bleibt ein Replay länger offen (Absturz, Match im Hintergrund), zählen die Bilder.
   */
  async forClip(path: string, game: string, duration: number, now = Date.now()) {
    if (!isFortnite(game)) return undefined;
    const { mtimeMs } = await stat(path);
    const result = await this.lookup(path, duration, mtimeMs);
    if (result.status !== 'wait' || now - mtimeMs <= MAX_WAIT_MS) return result;
    return {
      status: 'none',
      events: [],
      trace: { ...result.trace, status: 'none', reason: 'Match nach 45 Minuten nicht beendet' },
    } satisfies ReplayLookup;
  }

  /**
   * Replay-Ereignisse für einen Clip. "wait" heißt: Ein Match nimmt gerade auf und hat vor dem
   * Clipende begonnen — der Clip gehört vermutlich dazu, die Ereignisse stehen erst nach dem
   * Match fest.
   */
  async lookup(clip: string, duration: number, mtime: number): Promise<ReplayLookup> {
    const toUtc = this.options.toUtc ?? localToUtc;
    const none = (reason: string, trace: Partial<ReplayTrace> = {}): ReplayLookup => ({
      status: 'none',
      events: [],
      trace: { status: 'none', reason, ...trace },
    });
    const window = clipWindow(clip, duration, mtime, toUtc);
    if (!window) return none('Aufnahmezeit aus Dateiname und Änderungszeit nicht eindeutig');
    const loaded = await this.load();
    // Läuft: als live markiert, vor dem Clipende begonnen und seit Clipbeginn noch geschrieben.
    // Ein Replay, das ein Absturz offen ließ, wird nicht mehr geschrieben und hält nichts auf.
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
    if (!covering) return none('kein Replay deckt die Aufnahmezeit ab', { anchor: window.anchor });
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
    if (!owner.id) return none('eigenes Konto nicht eindeutig', trace);
    return {
      status: 'ok',
      events: clipEvents(covering.replay, owner.id, covering.begun!, window),
      trace: { ...trace, owner: owner.id },
    };
  }
}
