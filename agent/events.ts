import { basename } from 'node:path';
import type { FrameObservation } from '../server/schema';

/**
 * Events that can be read reliably from on-screen messages. The model reads these messages
 * reliably but interprets them unreliably: it mistook "ELIMINIERT: X" for the player's own death
 * and took "Teameliminierung" for a loss of its own (.docs/05-experimente.md, E14 and E17).
 * So fixed code interprets here what the model has read.
 */
export type EventKind =
  | 'kill'
  | 'multikill'
  | 'headshot'
  | 'ace'
  | 'clutch'
  | 'knock'
  | 'death'
  | 'roundWon'
  | 'roundLost'
  | 'matchWon'
  | 'matchLost';

/** Weapon type or cause of death as named by a game replay (agent/fortnite.ts). */
export type Weapon =
  | 'pistol'
  | 'shotgun'
  | 'rifle'
  | 'smg'
  | 'sniper'
  | 'noscope'
  | 'melee'
  | 'explosive'
  | 'bow'
  | 'minigun'
  | 'lmg'
  | 'vehicle'
  | 'trap'
  | 'storm'
  | 'fall';

export interface GameEvent {
  kind: EventKind;
  /** Second in the clip; null if only the NVIDIA file name mentions the event. */
  seconds: number | null;
  /** The message that was read, or the event from the file name or replay. */
  text: string;
  /**
   * replay: from a replay's game events, exact rather than read; ocr: from text recognition
   * (agent/r6.ts), round and match results only.
   */
  source: 'screen' | 'spectator' | 'nvidia' | 'replay' | 'ocr';
  /** Opponent, if the message names one: the victim for kills, the killer for the player's own death. */
  other?: string;
  /** From replays: weapon or cause, distance in metres. Number of kills in a streak. */
  weapon?: Weapon;
  distance?: number;
  count?: number;
  /** Multi-kill spread over the whole clip instead of in quick succession. */
  spread?: boolean;
  /** Multi-kill: this many of the kills were headshots. */
  headshots?: number;
  /**
   * Only for messages that were read: the last frame before, on which it was still missing. The
   * event lies between this frame and `seconds`; a message only appears after the kill.
   */
  from?: number;
}

export type SeenFrame = Pick<FrameObservation, 'kind' | 'visibleText'> & { seconds: number };

/** How strongly an event carries a clip, for the title and the choice of evidence frame. */
export const SIGNIFICANCE: Record<EventKind, number> = {
  matchWon: 9,
  matchLost: 9,
  ace: 8,
  clutch: 7,
  multikill: 6,
  roundWon: 5,
  roundLost: 5,
  headshot: 4,
  kill: 3,
  death: 3,
  knock: 2,
};

const KILL_CONTEXT = /\bELIMINIERUNG\b|\bKILLS?\b|\bABSCHUSS\b/;

/**
 * Messages as they actually occur in the collection (measured on the runs of 2026-09-22 and the
 * contact sheets of 2026-09-23): Fortnite and CoD in German, R6 in English, Valorant in German.
 * Ambiguous ones are deliberately left out: "Angreifer haben durch Eliminierung gewonnen" does
 * not say which side the user is on.
 */
const RULES: { kind: EventKind; pattern: RegExp; games?: RegExp }[] = [
  // Own death: the killer follows "von" or "by".
  { kind: 'death', pattern: /\bGET(?:Ö|OE|O)TET (?:VON|DURCH)\b/ },
  { kind: 'death', pattern: /\b(?:ELIMINIERT|AUSGESCHALTET|NIEDERGESTRECKT) VON\b/ },
  {
    kind: 'death',
    pattern: /\bDU WURDEST\b.{0,40}\b(?:ELIMINIERT|GET(?:Ö|OE|O)TET|AUSGESCHALTET)\b/,
  },
  { kind: 'death', pattern: /\b(?:KILLED|ELIMINATED|SLAIN) BY\b/ },
  { kind: 'death', pattern: /\bYOU (?:WERE|GOT) (?:KILLED|ELIMINATED|SLAIN)\b|\bYOU DIED\b/ },
  { kind: 'death', pattern: /\bDU BIST (?:GESTORBEN|TOT)\b/ },
  // Own kill: "ELIMINIERT: Name" (Fortnite), score pop-ups, R6 score bar.
  { kind: 'kill', pattern: /\bELIMINIERT\s*[:：]/ },
  { kind: 'kill', pattern: /\+\s?[\d.,]+\s*(?:G?EP|XP)\b.{0,24}\bELIMINIERUNG\b/ },
  { kind: 'kill', pattern: /\bDU HAST\b.{0,40}\b(?:ELIMINIERT|GET(?:Ö|OE|O)TET|AUSGESCHALTET)\b/ },
  // The model often separates points and word with "|": R6 shows "+100 KILL" only for own kills.
  { kind: 'kill', pattern: /\+\s?\d+\s*(?:\|\s*)?KILL\b|\bKILL\s*(?:\|\s*)?\+\s?\d+/ },
  { kind: 'kill', pattern: /\bYOU (?:KILLED|ELIMINATED)\b|\bENEMY (?:KILLED|ELIMINATED)\b/ },
  { kind: 'kill', pattern: /\bABSCHUSS\b/ },
  // "TÖTUNG BESTÄTIGT" (Wardogs), not "BEI TÖTUNG ASSISTIERT". Added after the retest of
  // 2026-09-23, where two clips ended up without a kill because of it.
  { kind: 'kill', pattern: /\bT(?:Ö|OE|O)TUNG BEST(?:Ä|AE|A)TIGT\b|\bKILL CONFIRMED\b/ },
  { kind: 'headshot', pattern: /\bHEAD\s?SHOT\b|\bKOPFSCHUSS\b/ },
  { kind: 'clutch', pattern: /\bCLUTCH\b/ },
  // In R6 "ACE" is also an operator name and must not mean anything there.
  {
    kind: 'ace',
    pattern: /^ACE\b|\bTEAM ACE\b|\bACE\s*[!|]|\|\s*ACE\b/,
    games: /valorant|counter|\bcs/i,
  },
  // Round and match. Enemy wins count as the player's own loss.
  { kind: 'roundLost', pattern: /\b(?:ENEMY|ENEMIES|OPPONENTS?)(?: TEAM)? WON ROUND\b/ },
  {
    kind: 'roundWon',
    pattern:
      /\bRUNDE GEWONNEN\b|\bRUNDENSIEG\b|\bROUND WON\b|\b(?:YOUR TEAM |WE )WON (?:THE )?ROUND\b/,
  },
  { kind: 'roundLost', pattern: /\bRUNDE VERLOREN\b|\bROUND LOST\b|\bLOST (?:THE )?ROUND\b/ },
  { kind: 'roundWon', pattern: /\bGEGNERISCHES TEAM ELIMINIERT\b/ },
  // Valorant shows the end of a round without the word "Runde"; "KNAPP", "FEHLERLOS" and
  // "MAKELLOS" are victory banners. Added after the review of E17 (VAL-WIN, VAL-KNAPP)
  // and the retest (VAL-B1).
  {
    kind: 'roundWon',
    pattern: /(?:^|\|\s*)(?:GEWONNEN|KNAPP|FEHLERLOS|MAKELLOS)[!.]?(?:\s*$|\s*\|)/,
    games: /valorant/i,
  },
  {
    kind: 'roundLost',
    pattern: /(?:^|\|\s*)VERLOREN[!.]?(?:\s*$|\s*\|)/,
    games: /valorant/i,
  },
  { kind: 'matchLost', pattern: /\b(?:ENEMY|ENEMIES|OPPONENTS?)(?: TEAM)? WINS\b/ },
  {
    kind: 'matchWon',
    pattern: /\bSIEG\b|\bVICTORY\b|\bYOUR TEAM WINS\b|\b(?:MATCH|SPIEL|PARTIE) GEWONNEN\b/,
  },
  {
    kind: 'matchLost',
    pattern: /\bNIEDERLAGE\b|\bDEFEAT\b|\bYOUR TEAM LOSES\b|\b(?:MATCH|SPIEL|PARTIE) VERLOREN\b/,
  },
];

/**
 * Spectator and respawn view: the user is out, even if the death itself is missing.
 * R6 counts "0 VS 2" from the player's own team's view: none of you is alive anymore.
 */
const SPECTATOR =
  /\bWATCHING\b|\bSPECTATING\b|\bZUSCHAUEN\b|\bSPIELER WECHSELN\b|\bRESPAWN(?:EN|ING)?\b|\bWIEDERBELEBUNG IN\b|\b0\s*VS\.?\s*[1-9]\b/;
/** In replays after the end of a round, "WATCHING" also shows for survivors. */
const REPLAY = /\bREPLAY\b|\bWIEDERHOLUNG\b|\bKILLCAM\b|\bBESTE AKTION\b|\bPLAY OF THE/;

function normalize(text: string) {
  return text.toUpperCase().replace(/\s+/g, ' ').trim();
}

const TELLING =
  /ELIMINIER|KILL|ABSCHUSS|GET(?:Ö|OE|O)TET|SIEG|VICTORY|NIEDERLAGE|DEFEAT|GEWONNEN|VERLOREN|\bWON\b|\bLOST\b|\bWINS\b|HEAD\s?SHOT|KOPFSCHUSS|DOPPEL|DREIFACH|VIERFACH|\bX\s?[2-9]\b|CLUTCH|\bACE\b|WATCHING|RESPAWN|ZUSCHAU|SPIELER WECHSELN|\b\d\s*VS\.?\s*\d\b|\+\s?[\d.,]+\s*(?:G?EP|XP)\b/;
/**
 * The parts of a line that was read which mean something. The model often copies the score bar,
 * FPS and ammo as well; that gets in the way in the prompt and in highlights, and with a
 * 90-character cut, "DOPPELT" at the end of all things used to fall off.
 */
function tellingPart(text: string) {
  const parts = text.split('|').map((p) => p.trim());
  const kept = parts.filter((p) => TELLING.test(normalize(p)));
  return (kept.length ? kept.join(' | ') : text).slice(0, 120);
}

/** Interprets a message that was read. Returns each event kind at most once. */
export function eventsInText(text: string, game = ''): EventKind[] {
  const upper = normalize(text);
  if (!upper) return [];
  const kinds = new Set<EventKind>();
  for (const rule of RULES) {
    if (rule.games && !rule.games.test(game)) continue;
    if (!rule.pattern.test(upper)) continue;
    // An enemy round win is already recorded as a loss.
    if (rule.kind === 'roundWon' && kinds.has('roundLost')) continue;
    if (rule.kind === 'matchWon' && kinds.has('matchLost')) continue;
    kinds.add(rule.kind);
  }
  // Multi only in connection with a kill, otherwise "DOPPELTE EP" would be a double kill.
  if (
    KILL_CONTEXT.test(upper) &&
    /\bDOPPEL(?:T|TE|-?KILL|ELIMINIERUNG)?\b|\bDREIFACH\b|\bVIERFACH\b|\bFÜNFFACH\b|\bX\s?[2-9]\b|\b(?:DOUBLE|TRIPLE|QUAD|PENTA|MULTI)\s?-?KILL\b/.test(
      upper,
    )
  )
    kinds.add('multikill');
  // Points for an elimination prove a kill, even if only the multi-kill note was read.
  if (kinds.has('multikill') || kinds.has('headshot') || kinds.has('ace')) kinds.add('kill');
  // "Tod von X" and "X eliminiert" in the same line do not contradict each other: both stay.
  return [...kinds];
}

/** Opponent from the message: the player's killer or the victim of a kill. */
function otherParty(kind: EventKind, text: string) {
  const pattern =
    kind === 'death'
      ? /(?:GET(?:Ö|OE|O)TET|ELIMINIERT|AUSGESCHALTET|KILLED|ELIMINATED|SLAIN) (?:VON|DURCH|BY)\s*:?\s*([^\s|:/]{2,24})/i
      : kind === 'kill'
        ? /ELIMINIERT\s*[:：]\s*([^\s|/]{2,24})/i
        : null;
  const name = pattern?.exec(text)?.[1]?.replace(/[.,;!]+$/, '');
  if (!name || /^(?:KAMPFBERICHT|RUNDE|DEM|DER|DIE)$/i.test(name)) return undefined;
  return readable(name);
}

/**
 * Banners write names in capitals ("DEADLOCK", "GEGNER_ZWEI"). In a title that looks copied,
 * so each word part starts with a capital. Mixed case stays as it is.
 */
function readable(name: string) {
  if (name !== name.toUpperCase() || !/\p{Lu}/u.test(name)) return name;
  return name
    .toLowerCase()
    .replace(/(^|[^\p{L}])(\p{L})/gu, (_, before, letter) => before + letter.toUpperCase());
}

/** NVIDIA saves highlights with the event in the file name: "… 16.42.51.07.Eliminierung.DVR.mp4". */
export function eventsFromFileName(path: string): { kinds: EventKind[]; label: string } {
  const match = /\.([A-Za-zÄÖÜäöüß ]{3,40})\.DVR\.[a-z0-9]+$/i.exec(basename(path));
  const label = match?.[1] ?? '';
  const name = label.toLowerCase().replace(/\s+/g, '');
  const kinds: EventKind[] =
    /^(doppel|dreifach|vierfach|fünffach|double|triple|quad|multi)/.test(name) &&
    /(eliminierung|elimination|kill)/.test(name)
      ? ['multikill', 'kill']
      : /^(eliminierung|elimination|kill|abschuss)$/.test(name)
        ? ['kill']
        : /^(eliminiert|eliminated|tod|death|gestorben)$/.test(name)
          ? ['death']
          : /^(sieg|victory|victoryroyale|gewonnen)$/.test(name)
            ? ['matchWon']
            : [];
  return { kinds, label: kinds.length ? label : '' };
}

/**
 * Collects a clip's events. A message often stays on screen for several seconds and is read
 * differently along the way; entries of the same kind are therefore merged as long as they
 * continue without a gap of more than two and a half seconds, or when they name the same
 * opponent or read identically and have not vanished from the screen in between. The latter
 * separates two deaths by the same agent in two rounds (VAL-B2, re-check of E17).
 */
/**
 * Several distinct kills in a clip are a multi-kill, even without an on-screen message and even
 * when they are spread across the round. It sits at the last kill and counts all of them.
 */
export function seriesOf(events: GameEvent[], source: GameEvent['source']): GameEvent | undefined {
  const kills = events.filter((e) => e.kind === 'kill' && e.seconds !== null);
  if (kills.length < 2) return undefined;
  const quick = kills.every((k, i) => i === 0 || k.seconds! - kills[i - 1].seconds! <= 12);
  // A headshot appears in the same message as its kill ("Head Shot +20", killfeed icon).
  const headshots = kills.filter((k) =>
    events.some(
      (h) => h.kind === 'headshot' && h.seconds !== null && Math.abs(h.seconds - k.seconds!) <= 1.5,
    ),
  ).length;
  return {
    kind: 'multikill',
    seconds: kills.at(-1)!.seconds,
    from: kills.at(-1)!.from,
    text: `${kills.length} Kills ${quick ? 'kurz nacheinander' : 'im Clip'}`,
    source,
    count: kills.length,
    ...(quick ? {} : { spread: true }),
    ...(headshots ? { headshots } : {}),
  };
}

/** The number of players alive as R6 shows it at the top ("3vs4"), or empty. */
function aliveCount(text: string) {
  const match = /\b(\d)\s*vs\.?\s*(\d)\b/i.exec(text);
  return match ? `${match[1]}:${match[2]}` : '';
}

/** Roughly how long a message such as the R6 killfeed stays on screen. */
const MESSAGE_SECONDS = 5;
export function collectEvents(frames: SeenFrame[], path: string, game = ''): GameEvent[] {
  const found: GameEvent[] = [];
  const lastSeen = new Map<GameEvent, number>();
  const lastText = new Map<GameEvent, string>();
  const ordered = [...frames].sort((a, b) => a.seconds - b.seconds);
  // Replays such as "BESTE AKTION" or the killcam can show someone else's play.
  const counted = (f: SeenFrame) => f.kind !== 'loading' && !REPLAY.test(normalize(f.visibleText));
  const kindsOf = new Map(
    ordered.map((f) => [f, counted(f) ? eventsInText(f.visibleText, game) : []]),
  );
  for (const frame of ordered) {
    const text = frame.visibleText.replace(/\s+/g, ' ').trim();
    if (!text || !counted(frame)) continue;
    for (const kind of kindsOf.get(frame)!) {
      const other = otherParty(kind, text);
      const previous = [...found].reverse().find((e) => e.kind === kind);
      const seen = previous ? lastSeen.get(previous)! : -Infinity;
      // A single misread frame separates nothing; a longer gap in which the message was
      // visibly missing does.
      const vanished =
        frame.seconds - seen > 12 &&
        ordered.some(
          (f) =>
            f.seconds > seen &&
            f.seconds < frame.seconds &&
            counted(f) &&
            !kindsOf.get(f)!.includes(kind),
        );
      // A kill message stays for about five seconds and thus on two consecutive frames, even
      // if its text changes ("+100 KILL", then "+100 KILL | Head Shot +20"). Only a changed
      // number of players alive ("3vs4" → "3vs3") shows a new kill.
      const adjacent =
        previous &&
        (kind === 'kill' || kind === 'headshot') &&
        frame.seconds - seen <= MESSAGE_SECONDS - 0.5 &&
        !ordered.some((f) => f.seconds > seen && f.seconds < frame.seconds && counted(f)) &&
        aliveCount(text) === aliveCount(lastText.get(previous) ?? '');
      if (
        previous &&
        (frame.seconds - seen <= 2.5 ||
          adjacent ||
          (!vanished &&
            ((other && previous.other && other.toLowerCase() === previous.other.toLowerCase()) ||
              normalize(tellingPart(text)) === normalize(previous.text))))
      ) {
        previous.other ??= other;
        lastSeen.set(previous, frame.seconds);
        lastText.set(previous, text);
        continue;
      }
      const before = ordered.filter((f) => f.seconds < frame.seconds).at(-1);
      const event: GameEvent = {
        kind,
        seconds: frame.seconds,
        // No message stays longer than about five seconds; with wide frame spacing that matters.
        from: Math.max(before?.seconds ?? 0, frame.seconds - MESSAGE_SECONDS),
        text: tellingPart(text),
        source: 'screen',
        ...(other ? { other } : {}),
      };
      found.push(event);
      lastSeen.set(event, frame.seconds);
      lastText.set(event, text);
    }
  }
  // Spectator view without a death that was read: out, provided more than one frame shows it.
  const watching = ordered.filter(
    (f) =>
      f.kind !== 'other' &&
      SPECTATOR.test(normalize(f.visibleText)) &&
      !REPLAY.test(normalize(f.visibleText)),
  );
  if (watching.length >= 2 && !found.some((e) => e.kind === 'death'))
    found.push({
      kind: 'death',
      seconds: watching[0].seconds,
      text: tellingPart(watching[0].visibleText),
      source: 'spectator',
    });
  const series = found.some((e) => e.kind === 'multikill') ? undefined : seriesOf(found, 'screen');
  if (series) found.push(series);
  const file = eventsFromFileName(path);
  for (const kind of file.kinds)
    if (!found.some((e) => e.kind === kind))
      found.push({ kind, seconds: null, text: file.label, source: 'nvidia' });
  return found.sort((a, b) => (a.seconds ?? Infinity) - (b.seconds ?? Infinity));
}

/**
 * Replaces kills, knocks and deaths that were read with the exact ones from a replay. A message
 * that was read may come from a spectated teammate or be counted twice; the replay knows each
 * of the player's own hits exactly once. Round and match messages stay; a win appears only
 * once. An empty list from the replay means there was none of these in this clip.
 */
export function withReplay(events: GameEvent[], replay: GameEvent[] | undefined) {
  if (!replay) return events;
  const exact: EventKind[] = ['kill', 'multikill', 'headshot', 'knock', 'death'];
  const won = replay.some((e) => e.kind === 'matchWon');
  // A replay does not know headshots: one that was read stays if the replay has an own kill at
  // the same time (±3 s); otherwise it probably belonged to a spectated teammate.
  const backed = (e: GameEvent) =>
    e.kind === 'headshot' &&
    e.seconds !== null &&
    replay.some((r) => r.kind === 'kill' && Math.abs(r.seconds! - e.seconds!) <= 3);
  return [
    ...events.filter(
      (e) => (!exact.includes(e.kind) || backed(e)) && !(won && e.kind === 'matchWon'),
    ),
    ...replay,
  ].sort((a, b) => (a.seconds ?? Infinity) - (b.seconds ?? Infinity));
}

/**
 * Adds round and match results from text recognition (agent/r6.ts). They were never wrong in
 * the blind test; a result the model read at the same point (±5 s) gives way to them.
 */
export function withTexts(events: GameEvent[], texts: GameEvent[] | undefined, feed = false) {
  // A killfeed that was read is authoritative for kills and deaths, even if it shows none of
  // the player's own: the model once took the previous round's combat report for a death here.
  if (feed) {
    const personal: EventKind[] = ['kill', 'multikill', 'headshot', 'knock', 'death'];
    events = events.filter((e) => !personal.includes(e.kind) || e.source === 'replay');
  }
  if (!texts?.length) return events;
  const results: EventKind[] = ['roundWon', 'roundLost', 'matchWon', 'matchLost'];
  const covered = (e: GameEvent) =>
    results.includes(e.kind) &&
    e.seconds !== null &&
    texts.some((t) => results.includes(t.kind) && Math.abs(t.seconds! - e.seconds!) <= 5);
  return [...events.filter((e) => !covered(e)), ...texts].sort(
    (a, b) => (a.seconds ?? Infinity) - (b.seconds ?? Infinity),
  );
}

/** Strongest event of a message, for choosing the evidence frame. 0 without an event. */
export function eventWeight(text: string, game = '') {
  return Math.max(0, ...eventsInText(text, game).map((k) => SIGNIFICANCE[k]));
}

/**
 * The events the title should be about: the weightiest one from the end, plus at most a second
 * one of another kind. NVIDIA events belong to the saved moment. Events from the lead-in carry
 * no title: in Valorant the previous round's combat report is on screen during the buy phase,
 * and the title would otherwise be about a death in an earlier round (VAL-KNAPP, review of E17).
 */
export function headline(events: GameEvent[], momentStart: number): GameEvent[] {
  // A long-distance hit or a sniper rifle hit is more remarkable than an ordinary kill or the
  // player's own death; only a replay knows that.
  const notable = (e: GameEvent) =>
    Number(
      ['kill', 'knock', 'multikill'].includes(e.kind) &&
        ((e.distance ?? 0) >= 100 || e.weapon === 'sniper' || e.weapon === 'noscope'),
    );
  // A multi-kill sums up the whole round and therefore also counts from the lead-in.
  const pool = events
    .filter((e) => e.seconds === null || e.seconds >= momentStart || e.kind === 'multikill')
    .sort(
      (a, b) =>
        SIGNIFICANCE[b.kind] + notable(b) - (SIGNIFICANCE[a.kind] + notable(a)) ||
        (b.seconds ?? 0) - (a.seconds ?? 0),
    );
  const first = pool[0];
  if (!first) return [];
  const family = (k: EventKind) =>
    k === 'death'
      ? 'death'
      : ['roundWon', 'roundLost', 'matchWon', 'matchLost'].includes(k)
        ? 'result'
        : 'kill';
  const second = pool.find((e) => family(e.kind) !== family(first.kind));
  return second ? [first, second] : [first];
}

const TAG_FOR: Record<EventKind, string[]> = {
  kill: ['Kill'],
  multikill: ['Kill', 'Multikill'],
  headshot: ['Kill', 'Headshot'],
  ace: ['Kill', 'Multikill', 'Ace'],
  clutch: ['Clutch'],
  // A knock is not a kill; there is no tag of its own for it (yet).
  knock: [],
  death: ['Tod'],
  roundWon: ['Rundensieg'],
  roundLost: ['Runde verloren'],
  matchWon: ['Sieg'],
  matchLost: ['Niederlage'],
};

/**
 * Tags come from proven events and the kind of frames, not from the model's choice. When chosen
 * freely, "Tod" stuck to 20 of 45 clips, including climbing and underwater scenes.
 */
export function tagsFor(
  events: GameEvent[],
  frames: Pick<SeenFrame, 'kind'>[],
  vocabulary: readonly string[],
) {
  const tags = new Set(events.flatMap((e) => TAG_FOR[e.kind]));
  const share = (kind: FrameObservation['kind']) =>
    frames.length ? frames.filter((f) => f.kind === kind).length / frames.length : 0;
  if (share('loading') >= 0.5) tags.add('Ladebildschirm');
  if (
    !frames.some((f) => ['gameplay', 'result', 'respawn'].includes(f.kind)) &&
    share('menu') >= 0.5
  )
    tags.add('Menü');
  return vocabulary.filter((t) => tags.has(t));
}

const PHRASE: Record<EventKind, string> = {
  kill: 'Du hast einen Gegner ausgeschaltet',
  multikill: 'Du hast mehrere Gegner kurz nacheinander ausgeschaltet',
  headshot: 'Du hast einen Gegner per Kopfschuss ausgeschaltet',
  ace: 'Du hast das ganze gegnerische Team allein ausgeschaltet (Ace)',
  clutch: 'Du hast eine Runde in Unterzahl entschieden (Clutch)',
  knock: 'Du hast einen Gegner niedergeschlagen',
  death: 'Du wurdest ausgeschaltet',
  roundWon: 'Dein Team gewinnt die Runde',
  roundLost: 'Dein Team verliert die Runde',
  matchWon: 'Dein Team gewinnt das Match',
  matchLost: 'Dein Team verliert das Match',
};

/** Weapon in the German dative case, for "mit …" in sentences and titles. */
export const WEAPON_WITH: Record<Weapon, string> = {
  pistol: 'mit der Pistole',
  shotgun: 'mit der Schrotflinte',
  rifle: 'mit dem Gewehr',
  smg: 'mit der MP',
  sniper: 'mit dem Scharfschützengewehr',
  noscope: 'mit dem Scharfschützengewehr ohne Zielfernrohr (No-Scope)',
  melee: 'im Nahkampf',
  explosive: 'mit Sprengstoff',
  bow: 'mit dem Bogen',
  minigun: 'mit der Minigun',
  lmg: 'mit dem MG',
  vehicle: 'mit einem Fahrzeug',
  trap: 'mit einer Falle',
  storm: 'durch den Sturm',
  fall: 'durch Fallschaden',
};

/** How many kills a streak has, as a word. */
export function countWord(count: number) {
  return count === 2
    ? 'zwei'
    : count === 3
      ? 'drei'
      : count === 4
        ? 'vier'
        : count === 5
          ? 'fünf'
          : String(count);
}

/** An event as a sentence from the user's point of view, not in title form, or the model copies it. */
export function phrase(event: GameEvent) {
  const base =
    event.kind === 'multikill' && event.count
      ? `Du hast ${countWord(event.count)} Gegner ${event.spread ? 'in diesem Clip' : 'kurz nacheinander'} ausgeschaltet`
      : PHRASE[event.kind];
  const details = [
    event.weapon ? WEAPON_WITH[event.weapon] : '',
    event.distance !== undefined && event.distance >= 10
      ? `aus ${Math.round(event.distance)} m Entfernung`
      : '',
  ].filter(Boolean);
  // The details go before the participle: "… mit der Schrotflinte ausgeschaltet".
  const cut = base.lastIndexOf(' ');
  const sentence = details.length
    ? `${base.slice(0, cut)} ${details.join(' ')}${base.slice(cut)}`
    : base;
  const heads =
    event.kind === 'multikill' && event.headshots && event.count
      ? `, ${event.headshots >= event.count ? (event.count === 2 ? 'beide' : 'alle') : `${event.headshots === 1 ? 'einer' : countWord(event.headshots)} davon`} per Kopfschuss`
      : '';
  return `${sentence}${heads}${event.kind === 'death' && event.other ? ` (von ${event.other})` : ''}`;
}

/** The proven events as facts for the summary prompt. */
export function describeFacts(events: GameEvent[], momentStart: number) {
  if (!events.length)
    return 'Belegte Ereignisse: keine. Es wurde keine Meldung zu Kill, Tod, Sieg oder Niederlage gelesen, also behaupte nichts davon.';
  const lines = events.map((e) => {
    if (e.source === 'replay')
      return `- Sekunde ${e.seconds!.toFixed(1)} (${e.seconds! >= momentStart ? 'Schluss' : 'Vorlauf'}): ${phrase(e)}. Beleg: Spielereignis aus dem Fortnite-Replay, exakt.`;
    if (e.source === 'ocr')
      return `- Sekunde ${e.seconds!.toFixed(1)} (${e.seconds! >= momentStart ? 'Schluss' : 'Vorlauf'}): ${phrase(e)}. Beleg: Texterkennung "${e.text}".`;
    if (e.source === 'nvidia')
      return `- Laut NVIDIA, die den Clip als "${e.text}" gespeichert hat: ${PHRASE[e.kind]}. Die Stelle selbst ist in den Bildern nicht belegt.`;
    const where = e.seconds! >= momentStart ? 'Schluss' : 'Vorlauf';
    const who = e.kind === 'death' && e.other ? ` von ${e.other}` : '';
    const how =
      e.source === 'spectator'
        ? `Zuschauer- oder Respawn-Ansicht ("${e.text}"), du bist also ausgeschieden`
        : `Meldung "${e.text}"`;
    return `- Sekunde ${e.seconds!.toFixed(1)} (${where}): ${PHRASE[e.kind]}${who}. Beleg: ${how}.`;
  });
  return `Belegte Ereignisse, aus Bildschirmmeldungen gedeutet und verlässlich:\n${lines.join('\n')}`;
}
