import { basename } from 'node:path';
import type { FrameObservation } from '../server/schema';

/**
 * Ereignisse, die sich aus Bildschirmmeldungen sicher ablesen lassen. Das Modell liest diese
 * Meldungen zuverlässig, deutet sie aber unzuverlässig: es verwechselte "ELIMINIERT: X" mit dem
 * eigenen Tod und hielt "Teameliminierung" für einen eigenen Verlust (.docs/05-experimente.md,
 * E14 und E17). Deshalb deutet hier fester Code, was das Modell gelesen hat.
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

/** Waffenart oder Todesursache, wie sie ein Spiel-Replay nennt (agent/fortnite.ts). */
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
  /** Sekunde im Clip; null, wenn nur der Dateiname von NVIDIA das Ereignis nennt. */
  seconds: number | null;
  /** Die gelesene Meldung, oder das Ereignis aus dem Dateinamen bzw. Replay. */
  text: string;
  /** replay: aus den Spielereignissen eines Replays, exakt statt gelesen. */
  source: 'screen' | 'spectator' | 'nvidia' | 'replay';
  /** Gegner, falls die Meldung ihn nennt: Opfer bei Kills, Verursacher beim eigenen Tod. */
  other?: string;
  /** Nur aus Replays: Waffe bzw. Ursache, Entfernung in Metern, Zahl der Kills einer Serie. */
  weapon?: Weapon;
  distance?: number;
  count?: number;
}

export type SeenFrame = Pick<FrameObservation, 'kind' | 'visibleText'> & { seconds: number };

/** Wie stark ein Ereignis einen Clip trägt — für den Titel und die Wahl des Belegbilds. */
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
 * Meldungen, wie sie in der Sammlung tatsächlich vorkommen (gemessen an den Läufen vom
 * 2026-09-22 und den Kontaktbögen vom 2026-09-23): Fortnite und CoD auf Deutsch, R6 auf
 * Englisch, Valorant auf Deutsch. Mehrdeutiges bleibt bewusst draußen — "Angreifer haben durch
 * Eliminierung gewonnen" sagt nicht, auf welcher Seite der Nutzer steht.
 */
const RULES: { kind: EventKind; pattern: RegExp; games?: RegExp }[] = [
  // Eigener Tod: der Verursacher steht hinter "von" bzw. "by".
  { kind: 'death', pattern: /\bGET(?:Ö|OE|O)TET (?:VON|DURCH)\b/ },
  { kind: 'death', pattern: /\b(?:ELIMINIERT|AUSGESCHALTET|NIEDERGESTRECKT) VON\b/ },
  {
    kind: 'death',
    pattern: /\bDU WURDEST\b.{0,40}\b(?:ELIMINIERT|GET(?:Ö|OE|O)TET|AUSGESCHALTET)\b/,
  },
  { kind: 'death', pattern: /\b(?:KILLED|ELIMINATED|SLAIN) BY\b/ },
  { kind: 'death', pattern: /\bYOU (?:WERE|GOT) (?:KILLED|ELIMINATED|SLAIN)\b|\bYOU DIED\b/ },
  { kind: 'death', pattern: /\bDU BIST (?:GESTORBEN|TOT)\b/ },
  // Eigener Kill: "ELIMINIERT: Name" (Fortnite), Punkte-Einblendungen, R6-Punkteleiste.
  { kind: 'kill', pattern: /\bELIMINIERT\s*[:：]/ },
  { kind: 'kill', pattern: /\+\s?[\d.,]+\s*(?:G?EP|XP)\b.{0,24}\bELIMINIERUNG\b/ },
  { kind: 'kill', pattern: /\bDU HAST\b.{0,40}\b(?:ELIMINIERT|GET(?:Ö|OE|O)TET|AUSGESCHALTET)\b/ },
  { kind: 'kill', pattern: /\+\s?\d+\s*KILL\b|\bKILL\s*\+\s?\d+/ },
  { kind: 'kill', pattern: /\bYOU (?:KILLED|ELIMINATED)\b|\bENEMY (?:KILLED|ELIMINATED)\b/ },
  { kind: 'kill', pattern: /\bABSCHUSS\b/ },
  // "TÖTUNG BESTÄTIGT" (Wardogs), nicht "BEI TÖTUNG ASSISTIERT". Nachgetragen nach dem Neutest
  // vom 2026-09-23, wo zwei Clips deshalb ohne Kill blieben.
  { kind: 'kill', pattern: /\bT(?:Ö|OE|O)TUNG BEST(?:Ä|AE|A)TIGT\b|\bKILL CONFIRMED\b/ },
  { kind: 'headshot', pattern: /\bHEAD\s?SHOT\b|\bKOPFSCHUSS\b/ },
  { kind: 'clutch', pattern: /\bCLUTCH\b/ },
  // "ACE" ist in R6 zugleich ein Operator-Name und darf dort nichts bedeuten.
  {
    kind: 'ace',
    pattern: /^ACE\b|\bTEAM ACE\b|\bACE\s*[!|]|\|\s*ACE\b/,
    games: /valorant|counter|\bcs/i,
  },
  // Runde und Match. Gegnerische Siege zählen als eigene Niederlage.
  { kind: 'roundLost', pattern: /\b(?:ENEMY|ENEMIES|OPPONENTS?)(?: TEAM)? WON ROUND\b/ },
  {
    kind: 'roundWon',
    pattern:
      /\bRUNDE GEWONNEN\b|\bRUNDENSIEG\b|\bROUND WON\b|\b(?:YOUR TEAM |WE )WON (?:THE )?ROUND\b/,
  },
  { kind: 'roundLost', pattern: /\bRUNDE VERLOREN\b|\bROUND LOST\b|\bLOST (?:THE )?ROUND\b/ },
  { kind: 'roundWon', pattern: /\bGEGNERISCHES TEAM ELIMINIERT\b/ },
  // Valorant blendet das Rundenende ohne das Wort "Runde" ein; "KNAPP", "FEHLERLOS" und
  // "MAKELLOS" sind Siegerbanner. Nachgetragen nach der Prüfung von E17 (VAL-WIN, VAL-KNAPP)
  // und dem Neutest (VAL-B1).
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
 * Zuschauer- und Respawn-Ansicht: der Nutzer ist ausgeschieden, auch wenn der Tod selbst fehlt.
 * "0 VS 2" zählt R6 aus Sicht des eigenen Teams — niemand von euch lebt mehr.
 */
const SPECTATOR =
  /\bWATCHING\b|\bSPECTATING\b|\bZUSCHAUEN\b|\bSPIELER WECHSELN\b|\bRESPAWN(?:EN|ING)?\b|\bWIEDERBELEBUNG IN\b|\b0\s*VS\.?\s*[1-9]\b/;
/** In Wiederholungen nach Rundenende steht "WATCHING" auch bei Überlebenden. */
const REPLAY = /\bREPLAY\b|\bWIEDERHOLUNG\b|\bKILLCAM\b|\bBESTE AKTION\b|\bPLAY OF THE/;

function normalize(text: string) {
  return text.toUpperCase().replace(/\s+/g, ' ').trim();
}

const TELLING =
  /ELIMINIER|KILL|ABSCHUSS|GET(?:Ö|OE|O)TET|SIEG|VICTORY|NIEDERLAGE|DEFEAT|GEWONNEN|VERLOREN|\bWON\b|\bLOST\b|\bWINS\b|HEAD\s?SHOT|KOPFSCHUSS|DOPPEL|DREIFACH|VIERFACH|\bX\s?[2-9]\b|CLUTCH|\bACE\b|WATCHING|RESPAWN|ZUSCHAU|SPIELER WECHSELN|\b\d\s*VS\.?\s*\d\b|\+\s?[\d.,]+\s*(?:G?EP|XP)\b/;
/**
 * Die Teile einer gelesenen Zeile, die etwas bedeuten. Das Modell schreibt Punkteleiste, FPS und
 * Munition oft mit ab; im Prompt und in den Zeitmarken stört das, und bei 90 Zeichen fiel sonst
 * ausgerechnet "DOPPELT" am Ende weg.
 */
function tellingPart(text: string) {
  const parts = text.split('|').map((p) => p.trim());
  const kept = parts.filter((p) => TELLING.test(normalize(p)));
  return (kept.length ? kept.join(' | ') : text).slice(0, 120);
}

/** Deutet eine gelesene Meldung. Liefert jede Ereignisart höchstens einmal. */
export function eventsInText(text: string, game = ''): EventKind[] {
  const upper = normalize(text);
  if (!upper) return [];
  const kinds = new Set<EventKind>();
  for (const rule of RULES) {
    if (rule.games && !rule.games.test(game)) continue;
    if (!rule.pattern.test(upper)) continue;
    // Ein gegnerischer Rundensieg ist schon als Niederlage erfasst.
    if (rule.kind === 'roundWon' && kinds.has('roundLost')) continue;
    if (rule.kind === 'matchWon' && kinds.has('matchLost')) continue;
    kinds.add(rule.kind);
  }
  // Mehrfach nur im Zusammenhang mit einem Kill, sonst wäre "DOPPELTE EP" ein Doppelkill.
  if (
    KILL_CONTEXT.test(upper) &&
    /\bDOPPEL(?:T|TE|-?KILL|ELIMINIERUNG)?\b|\bDREIFACH\b|\bVIERFACH\b|\bFÜNFFACH\b|\bX\s?[2-9]\b|\b(?:DOUBLE|TRIPLE|QUAD|PENTA|MULTI)\s?-?KILL\b/.test(
      upper,
    )
  )
    kinds.add('multikill');
  // Punkte für eine Elimination belegen einen Kill, auch wenn nur die Mehrfach-Angabe gelesen wurde.
  if (kinds.has('multikill') || kinds.has('headshot') || kinds.has('ace')) kinds.add('kill');
  // "Tod von X" und "X eliminiert" in derselben Zeile widersprechen sich nicht: beide bleiben.
  return [...kinds];
}

/** Gegner aus der Meldung: Verursacher des eigenen Todes oder Opfer eines Kills. */
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
 * Banner schreiben Namen in Großbuchstaben ("DEADLOCK", "GEGNER_ZWEI"). Im Titel wirkt das wie
 * abgeschrieben; also jeden Wortteil groß beginnen. Gemischte Schreibung bleibt, wie sie ist.
 */
function readable(name: string) {
  if (name !== name.toUpperCase() || !/\p{Lu}/u.test(name)) return name;
  return name
    .toLowerCase()
    .replace(/(^|[^\p{L}])(\p{L})/gu, (_, before, letter) => before + letter.toUpperCase());
}

/** NVIDIA speichert Highlights mit dem Ereignis im Dateinamen: "… 16.42.51.07.Eliminierung.DVR.mp4". */
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
 * Sammelt die Ereignisse eines Clips. Eine Meldung steht oft mehrere Sekunden im Bild und wird
 * dabei verschieden gelesen; Einträge derselben Art werden deshalb zusammengefasst, solange sie
 * ohne Lücke von mehr als zweieinhalb Sekunden weiterstehen, oder wenn sie denselben Gegner
 * nennen bzw. wörtlich gleich lauten und nicht zwischendurch aus dem Bild verschwunden sind.
 * Letzteres trennt zwei Tode durch denselben Agenten in zwei Runden (VAL-B2, Nachprüfung E17).
 */
export function collectEvents(frames: SeenFrame[], path: string, game = ''): GameEvent[] {
  const found: GameEvent[] = [];
  const lastSeen = new Map<GameEvent, number>();
  const ordered = [...frames].sort((a, b) => a.seconds - b.seconds);
  // Wiederholungen wie "BESTE AKTION" oder die Killcam können das Spiel eines anderen zeigen.
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
      // Ein einzelnes verlesenes Bild trennt nichts; eine längere Lücke, in der die Meldung
      // sichtbar fehlte, schon.
      const vanished =
        frame.seconds - seen > 12 &&
        ordered.some(
          (f) =>
            f.seconds > seen &&
            f.seconds < frame.seconds &&
            counted(f) &&
            !kindsOf.get(f)!.includes(kind),
        );
      if (
        previous &&
        (frame.seconds - seen <= 2.5 ||
          (!vanished &&
            ((other && previous.other && other.toLowerCase() === previous.other.toLowerCase()) ||
              normalize(tellingPart(text)) === normalize(previous.text))))
      ) {
        previous.other ??= other;
        lastSeen.set(previous, frame.seconds);
        continue;
      }
      const event: GameEvent = {
        kind,
        seconds: frame.seconds,
        text: tellingPart(text),
        source: 'screen',
        ...(other ? { other } : {}),
      };
      found.push(event);
      lastSeen.set(event, frame.seconds);
    }
  }
  // Zuschaueransicht ohne gelesenen Tod: ausgeschieden, sofern es mehr als ein Bild zeigt.
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
  // Zwei verschiedene Kills kurz nacheinander sind ein Mehrfach-Kill, auch ohne Einblendung.
  const kills = found.filter((e) => e.kind === 'kill');
  if (
    !found.some((e) => e.kind === 'multikill') &&
    kills.some((k, i) => i > 0 && k.seconds! - kills[i - 1].seconds! <= 12)
  ) {
    const second = kills.find((k, i) => i > 0 && k.seconds! - kills[i - 1].seconds! <= 12)!;
    found.push({
      kind: 'multikill',
      seconds: second.seconds,
      text: 'zwei Kills kurz nacheinander',
      source: 'screen',
    });
  }
  const file = eventsFromFileName(path);
  for (const kind of file.kinds)
    if (!found.some((e) => e.kind === kind))
      found.push({ kind, seconds: null, text: file.label, source: 'nvidia' });
  return found.sort((a, b) => (a.seconds ?? Infinity) - (b.seconds ?? Infinity));
}

/**
 * Ersetzt gelesene Kills, Knocks und Tode durch die exakten aus einem Replay. Gelesen kann eine
 * Meldung auch von einem beobachteten Mitspieler stammen oder doppelt zählen; das Replay kennt
 * jeden eigenen Treffer genau einmal. Meldungen zu Runde und Match bleiben, ein Sieg steht nur
 * einmal da. Eine leere Liste aus dem Replay heißt: In diesem Clip gab es nichts davon.
 */
export function withReplay(events: GameEvent[], replay: GameEvent[] | undefined) {
  if (!replay) return events;
  const exact: EventKind[] = ['kill', 'multikill', 'headshot', 'knock', 'death'];
  const won = replay.some((e) => e.kind === 'matchWon');
  return [
    ...events.filter((e) => !exact.includes(e.kind) && !(won && e.kind === 'matchWon')),
    ...replay,
  ].sort((a, b) => (a.seconds ?? Infinity) - (b.seconds ?? Infinity));
}

/** Stärkstes Ereignis einer Meldung, für die Wahl des Belegbilds. 0 ohne Ereignis. */
export function eventWeight(text: string, game = '') {
  return Math.max(0, ...eventsInText(text, game).map((k) => SIGNIFICANCE[k]));
}

/**
 * Die Ereignisse, von denen der Titel handeln soll: das gewichtigste aus dem Schluss, dazu
 * höchstens ein zweites anderer Art. NVIDIA-Ereignisse gehören zum gespeicherten Moment.
 * Ereignisse des Vorlaufs tragen keinen Titel: in Valorant steht während der Kaufphase der
 * Kampfbericht der Vorrunde im Bild, und der Titel handelte sonst vom Tod einer früheren Runde
 * (VAL-KNAPP, Prüfung von E17).
 */
export function headline(events: GameEvent[], momentStart: number): GameEvent[] {
  // Ein Treffer über große Distanz oder mit dem Scharfschützengewehr ist bemerkenswerter als
  // ein gewöhnlicher Kill oder der eigene Tod; das weiß nur ein Replay.
  const notable = (e: GameEvent) =>
    Number((e.distance ?? 0) >= 100 || e.weapon === 'sniper' || e.weapon === 'noscope');
  const pool = events
    .filter((e) => e.seconds === null || e.seconds >= momentStart)
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
  // Niederschlagen ist kein Kill; ein eigenes Tag gibt es dafür (noch) nicht.
  knock: [],
  death: ['Tod'],
  roundWon: ['Rundensieg'],
  roundLost: ['Runde verloren'],
  matchWon: ['Sieg'],
  matchLost: ['Niederlage'],
};

/**
 * Tags entstehen aus belegten Ereignissen und der Art der Bilder, nicht aus der Wahl des
 * Modells. Frei gewählt klebte "Tod" an 20 von 45 Clips, auch an Kletter- und Unterwasserszenen.
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

/** Waffe im Dativ, für "mit …" in Sätzen und Titeln. */
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

/** Wie viele Kills eine Serie hat, als Wort. */
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

/** Ein Ereignis als Satz aus Sicht des Nutzers, ohne Titelform — sonst schreibt das Modell ab. */
export function phrase(event: GameEvent) {
  const base =
    event.kind === 'multikill' && event.count
      ? `Du hast ${countWord(event.count)} Gegner kurz nacheinander ausgeschaltet`
      : PHRASE[event.kind];
  const details = [
    event.weapon ? WEAPON_WITH[event.weapon] : '',
    event.distance !== undefined && event.distance >= 10
      ? `aus ${Math.round(event.distance)} m Entfernung`
      : '',
  ].filter(Boolean);
  // Die Angaben gehören vor das Partizip: "… mit der Schrotflinte ausgeschaltet".
  const cut = base.lastIndexOf(' ');
  const sentence = details.length
    ? `${base.slice(0, cut)} ${details.join(' ')}${base.slice(cut)}`
    : base;
  return `${sentence}${event.kind === 'death' && event.other ? ` (von ${event.other})` : ''}`;
}

/** Die belegten Ereignisse als Tatsachen für den Prompt der Zusammenfassung. */
export function describeFacts(events: GameEvent[], momentStart: number) {
  if (!events.length)
    return 'Belegte Ereignisse: keine. Es wurde keine Meldung zu Kill, Tod, Sieg oder Niederlage gelesen, also behaupte nichts davon.';
  const lines = events.map((e) => {
    if (e.source === 'replay')
      return `- Sekunde ${e.seconds!.toFixed(1)} (${e.seconds! >= momentStart ? 'Schluss' : 'Vorlauf'}): ${phrase(e)}. Beleg: Spielereignis aus dem Fortnite-Replay, exakt.`;
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
