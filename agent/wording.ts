import { SIGNIFICANCE, WEAPON_WITH, countWord, phrase } from './events';
import type { EventKind, GameEvent, Weapon } from './events';

/**
 * Prüfung und Nachbearbeitung der Texte, die das Modell schreibt. Es formuliert gut, behauptet
 * aber gelegentlich, was nicht stattfand ("Tod durch Feuerwaffe" über einem Clip, in dem der
 * Nutzer zwei Gegner ausschaltet) oder schreibt Anzeigen ab ("3 vs 1", "FINKA im Visier").
 * Beides lässt sich gegen die belegten Ereignisse prüfen (.docs/05-experimente.md, E17).
 */

const KILLS: EventKind[] = ['kill', 'multikill', 'headshot', 'ace'];
const WINS: EventKind[] = ['roundWon', 'matchWon', 'ace', 'clutch'];
const LOSSES: EventKind[] = ['roundLost', 'matchLost'];

// "von hinten ausgeschaltet" beschreibt den eigenen Kill, "von Deadlock ausgeschaltet" den Tod.
const DEATH_BY =
  /\bvon\s+(?!hinten\b|oben\b|unten\b|vorne\b|links\b|rechts\b|weitem\b|nahem\b)[^\s,.;:!?]+(?:\s+[^\s,.;:!?]+)?\s+(?:ausgeschaltet|eliminiert|erledigt|erwischt|getötet|niedergestreckt)/i;
const DEATH = /\b(?:tod|tot|gestorben|stirbt|stirbst|getötet|ausgeschieden|draufgegangen)\b/i;
// Aktiv gesagt: "Deadlock schaltet dich aus" ist ein Tod, "du schaltest ihn aus" ein Kill.
const DEATH_ACTIVE =
  /\b(?:schaltet|erledigt|erwischt|killt|tötet|eliminiert|holt|schlägt|besiegt|erschießt)\b[^.,;!?]{0,30}\b(?:dich|mich)\b/i;
const KILL_ACTIVE = /\b(?:schaltest|erledigst|erwischst|eliminierst|killst|holst)\b/i;
// Auch als Tätigkeit ("Zombies töten") eine Behauptung, die ein Ereignis braucht.
const KILL =
  /\b(?:kills?|headshots?|kopfschuss|ace|multikill|(?:doppel|dreifach|vierfach|mehrfach)-?kills?|abschuss|abgeschossen|abschie(?:ß|ss)en|töten|killen)\b/i;
// Nur gegen Replay-Ereignisse geprüft: Snipes und Knocks ("niedergeschlagen" ist kein Kill).
const SNIPE = /\b(?:snipes?|gesnip(?:ed|t)|no-?scope\w*)\b/i;
const KNOCK = /\b(?:knocks?|geknockt|umgeknockt|niedergeschlagen)\b/i;
// Kann Kill oder Tod meinen; zulässig, sobald eins von beiden belegt ist.
const EITHER =
  /\b(?:ausgeschaltet|ausschalten|eliminiert|eliminieren|eliminierung(?:en)?|erledigt|erledigen|erwischt|besiegt)\b/i;
// "Gegner besiegt" ist ein Kill, kein Sieg.
const WIN = /(?<!be)sieg|gewonnen|gewinn|victory/i;
const LOSS = /niederlage|verloren|verlier/i;
// Wiederbelebung und Zuschauen setzen einen Tod voraus, ohne ihn zu behaupten.
const AFTER_DEATH = /respawn|wiederbeleb|zuschau|ausgeschieden/i;

const GENERIC =
  /\b(?:spielabschnitt|gameplay|spielszene|spielansicht|aufnahme|clip|screenshot|bildschirm|video)\b/i;
const METHOD =
  /\b(?:stichprobe|frames?|einzelbild\w*|beobachtung\w*|notiz\w*|belegbild|sekunden?)\b/i;
const SCORE = /\d+\s*[:–-]\s*\d+|\b\d+\s*vs\.?\s*\d+\b|\b\d+\s*\/\s*\d+\b/i;

function words(text: string) {
  return text.split(/[\s,.;:!?„“"'()–-]+/).filter(Boolean);
}
function shouting(text: string) {
  return words(text).some(
    (w) => w.length >= 4 && /\p{Lu}/u.test(w) && w === w.toUpperCase() && !/\d/.test(w),
  );
}
const has = (events: GameEvent[], kinds: EventKind[]) => events.some((e) => kinds.includes(e.kind));

/** Behauptungen, die kein Ereignis deckt. Leer, wenn der Text nichts Unbelegtes sagt. */
export function unsupportedClaims(text: string, events: GameEvent[]) {
  const problems: string[] = [];
  const deathBy = DEATH_BY.test(text) || DEATH_ACTIVE.test(text);
  const rest = text.replace(DEATH_BY, ' ').replace(DEATH_ACTIVE, ' ');
  const kill = has(events, KILLS);
  const death = has(events, ['death']);
  const killed = KILL.test(rest) || KILL_ACTIVE.test(rest);
  if ((deathBy || DEATH.test(rest)) && !death)
    problems.push('behauptet deinen Tod, den keine Meldung belegt');
  if (killed && !kill) problems.push('behauptet einen Kill, den keine Meldung belegt');
  // Replay-Ereignisse sind gezählt und vermessen; nur mit ihnen lassen sich Snipes, Knocks,
  // Serien und Entfernungen prüfen. Clips ohne Replay prüft das wie bisher.
  if (events.some((e) => e.source === 'replay'))
    problems.push(...exactClaims(rest, events, killed));
  else {
    // Auch eine gelesene Serie ist gezählt: "Vierfach-Kill" bei drei Kills stimmt nicht.
    const counted = Math.max(
      0,
      ...events.map((e) => (e.kind === 'multikill' ? (e.count ?? 2) : 0)),
    );
    const series = seriesIn(rest);
    if (counted && series > counted)
      problems.push(`behauptet ${series} Kills in Folge, belegt sind ${counted}`);
  }
  // In R6 heißt ein Operator ACE ("KILLED BY xiTango | ACE"); ein Ace braucht eine eigene Meldung.
  if (/\bace\b/i.test(text) && !has(events, ['ace']))
    problems.push('behauptet ein Ace, das keine Meldung belegt');
  if (!killed && EITHER.test(rest) && !kill && !death)
    problems.push('behauptet ein Ausschalten, das keine Meldung belegt');
  if (WIN.test(text) && !has(events, WINS))
    problems.push('behauptet einen Sieg, den keine Meldung belegt');
  if (LOSS.test(text) && !has(events, LOSSES))
    problems.push('behauptet eine Niederlage, die keine Meldung belegt');
  return problems;
}

function exactClaims(text: string, events: GameEvent[], killed: boolean) {
  const problems: string[] = [];
  const kill = has(events, KILLS);
  // "Snipe-Knock über 180 m" beschreibt einen Knock, keinen Kill.
  if (SNIPE.test(text) && !killed && !kill && !(KNOCK.test(text) && has(events, ['knock'])))
    problems.push('behauptet einen Kill, den keine Meldung belegt');
  if (KNOCK.test(text) && !kill && !has(events, ['knock']))
    problems.push('behauptet einen Knock, den kein Ereignis belegt');
  const series = seriesIn(text);
  const counted = Math.max(
    0,
    ...events.map((e) =>
      e.kind === 'multikill'
        ? (e.count ?? 2)
        : e.kind === 'ace'
          ? 5
          : KILLS.includes(e.kind)
            ? 1
            : 0,
    ),
  );
  if (series > counted) problems.push(`behauptet ${series} Kills in Folge, belegt sind ${counted}`);
  for (const [kind, nouns, plural] of [
    ['kill', KILL_NOUNS, 'Kills'],
    ['knock', 'knocks?', 'Knocks'],
  ] as const) {
    const claimed = countIn(text, nouns);
    const proven = events.filter((e) => e.kind === kind).length;
    if (claimed > proven) problems.push(`behauptet ${claimed} ${plural}, belegt sind ${proven}`);
  }
  const meters = distanceIn(text);
  const farthest = Math.max(0, ...events.map((e) => e.distance ?? 0));
  if (meters !== undefined && meters > farthest + 5)
    problems.push(
      farthest
        ? `übertreibt die Entfernung (belegt sind ${Math.round(farthest)} m)`
        : 'nennt eine Entfernung, die kein Ereignis belegt',
    );
  return problems;
}

/** Gewöhnliche Wendungen mit "auf", die keine Karte meinen ("Kopfschuss auf Distanz"). */
const COMMON_AFTER_AUF =
  /^(?:Distanz|Entfernung|Abstand|Anhieb|Augenhöhe|Sicht|Zeit|Kurs|Ansage|Kommando|Befehl|Risiko|Ansatz|Knopfdruck|Zuruf)$/i;

/** Was über den Ort bekannt ist: die erkannte Karte und alle Karten des Spiels. */
export interface MapContext {
  map?: string;
  maps: readonly string[];
}

/** Was an einem Titel nicht stimmt, als Sätze für die Rückfrage an das Modell. */
export function titleProblems(
  title: string,
  events: GameEvent[],
  headlineEvents: GameEvent[],
  place?: MapContext,
) {
  const problems = unsupportedClaims(title, events);
  // Eine Karte im Titel muss die erkannte sein; geraten wäre sie oft falsch.
  const named = place?.maps.find((m) => new RegExp(`\\b${m}\\b`, 'i').test(title));
  if (named && named !== place?.map)
    problems.push(
      place?.map
        ? `nennt die Karte ${named}, erkannt wurde ${place.map}`
        : `nennt die Karte ${named}, die nicht erkannt wurde`,
    );
  // Auch ein Ort, den es gar nicht gibt: Qwen3.5 schrieb am 2026-09-24 "Gelber Bagger auf
  // Dantzig" zu einem Bild ohne Kartennamen. "auf" plus Eigenname zählt als Kartenangabe.
  const where = /\bauf\s+([A-ZÄÖÜ][\p{L}'-]+(?:\s+[A-ZÄÖÜ][\p{L}'-]+)?)\s*[!.]?$/u.exec(
    title.trim(),
  );
  // Ebenso zwei großgeschriebene Wörter nach einer Präposition ("Übersicht über Dirt Haul"):
  // im Deutschen fast immer ein Eigenname, einzelne Wörter ("in Deckung") dagegen oft nicht.
  // Wortgrenze per Lookbehind: \b kennt kein "ü" und fände "über" nicht.
  const compound =
    /(?<!\p{L})(?:auf|über|in|im|am|an|bei|nach|vor)\s+([A-ZÄÖÜ][\p{L}'-]+\s+[A-ZÄÖÜ][\p{L}'-]+)/u.exec(
      title,
    );
  const invented = [where?.[1], compound?.[1]].find(
    (name) =>
      name && !COMMON_AFTER_AUF.test(name) && name.toLowerCase() !== place?.map?.toLowerCase(),
  );
  if (place && !named && invented)
    problems.push(
      place.map
        ? `nennt den Ort ${invented}, erkannt wurde die Karte ${place.map}`
        : `nennt den Ort ${invented}, der nicht als Karte erkannt wurde`,
    );
  if (!title.trim()) problems.push('ist leer');
  if (shouting(title)) problems.push('übernimmt Bildschirmtext in Großbuchstaben');
  if (SCORE.test(title)) problems.push('enthält einen Punktestand oder ein Zahlenverhältnis');
  if (/\brunde\s+\d+/i.test(title)) problems.push('nennt eine Rundennummer');
  if (GENERIC.test(title)) problems.push('ist zu allgemein');
  if (METHOD.test(title)) problems.push('spricht über das Verfahren statt über den Moment');
  if (words(title).length > 8 || title.length > 60) problems.push('ist zu lang');
  // Die Du-Form gilt für die Beschreibung; als Überschrift wird sie schief ("Du von Deadlock
  // ausgeschaltet"). Die Ich-Form verwechselt die Perspektive ("Omen schaltet mich").
  if (/^du\b/i.test(title.trim())) problems.push('beginnt mit "Du", ist aber eine Überschrift');
  if (/\b(?:ich|mich|mir|mein\w*)\b/i.test(title)) problems.push('spricht in der Ich-Form');
  const main = headlineEvents[0];
  if (main?.weapon) {
    const named = weaponsIn(title);
    if (named.length && !named.includes(main.weapon))
      problems.push(`nennt eine andere Waffe, als das Spiel meldet (${label(main)})`);
  }
  if (main && !problems.length && !mentions(title, main))
    problems.push(`benennt das wichtigste belegte Ereignis nicht (${label(main)})`);
  else if (main && !problems.length && !mentionsDetail(title, main))
    problems.push(`lässt das Besondere am Ereignis weg (${label(main)})`);
  return problems;
}

/** Zahl einer genannten Serie: "Doppel-Kill" 2, "Triple Kill" 3. 0 ohne Serie. */
function seriesIn(text: string) {
  const series: [RegExp, number][] = [
    [/\b(?:fünffach|penta)\w*/i, 5],
    [/\b(?:vierfach|quad)\w*/i, 4],
    [/\b(?:dreifach|triple)\w*/i, 3],
    [/\b(?:doppel|double|zweifach)(?:-?kills?|-?eliminierung\w*|\b)/i, 2],
  ];
  return series.find(([pattern]) => pattern.test(text))?.[1] ?? 0;
}

const NUMBERS: Record<string, number> = {
  zwei: 2,
  drei: 3,
  vier: 4,
  fünf: 5,
  sechs: 6,
  sieben: 7,
  acht: 8,
  neun: 9,
  zehn: 10,
};
const KILL_NOUNS = 'kills?|abschüsse|eliminierungen';
/**
 * Genannte Anzahl vor einem Wort wie "Kills": "Drei Kills in Folge", "zwei schnelle Abschüsse",
 * "Drei-Kill-Serie", "4 Kills". Entfernungen wie "200 Meter Kill" sind keine Anzahl. 0 ohne Angabe.
 */
function countIn(text: string, nouns: string) {
  const match = new RegExp(
    `(?<![\\wäöüß])(${Object.keys(NUMBERS).join('|')}|\\d{1,2})[\\s-]+(?!(?:m|meter[n]?)(?![\\wäöüß]))(?:[\\wäöüß]+[\\s-]+)?(?:${nouns})(?![\\wäöüß])`,
    'i',
  ).exec(text);
  return match ? (NUMBERS[match[1].toLowerCase()] ?? Number(match[1])) : 0;
}

/** Genannte Entfernung in Metern: "über 180 m", "180-m-Snipe", "200 Meter". */
function distanceIn(text: string) {
  const match = /\b(\d{2,4})\s*-?\s*m(?:eter[n]?)?\b/i.exec(text);
  return match ? Number(match[1]) : undefined;
}

const WEAPON_WORDS: [Weapon[], RegExp][] = [
  [['sniper', 'noscope'], /snipe|sniper|scharfschütz|no-?scope/i],
  [['shotgun'], /schrot|shotgun|pump/i],
  [['smg'], /\bmp\b|maschinenpistole|\bsmg\b/i],
  [['pistol'], /(?<!maschinen)pistole|\bpistol\b|revolver/i],
  [['rifle'], /(?<!scharfschützen)gewehr|\brifle\b|\bar\b|\bdmr\b/i],
  [['explosive'], /granate|rakete|sprengstoff|explosion|\bc4\b/i],
  [['bow'], /\bbogen\b|\bbow\b/i],
  [['melee'], /spitzhacke|nahkampf|pickaxe|melee/i],
  [['minigun'], /minigun/i],
  [['lmg'], /\bl?mg\b/i],
  [['vehicle'], /fahrzeug|überfahren/i],
];

/** Waffen, die ein Text nennt. */
function weaponsIn(text: string) {
  return WEAPON_WORDS.filter(([, pattern]) => pattern.test(text)).flatMap(([weapons]) => weapons);
}

/**
 * Was ein Ereignis aus dem Replay besonders macht, soll der Titel tragen: die Zahl einer Serie,
 * einen Snipe oder eine große Entfernung. Gelesene Meldungen haben solche Angaben nicht.
 */
function mentionsDetail(title: string, event: GameEvent) {
  if (event.kind === 'multikill' && event.count)
    return (
      seriesIn(title) === Math.min(event.count, 5) ||
      countIn(title, KILL_NOUNS) === event.count ||
      new RegExp(`\\b${countWord(event.count)}\\b`, 'i').test(title) ||
      title.includes(String(event.count))
    );
  if (!['kill', 'knock'].includes(event.kind)) return true;
  const far = (event.distance ?? 0) >= 100;
  const sniped = event.weapon === 'sniper' || event.weapon === 'noscope';
  if (!far && !sniped) return true;
  return (
    (far && distanceIn(title) !== undefined) || (sniped && weaponsIn(title).includes(event.weapon!))
  );
}

function mentions(title: string, event: GameEvent) {
  const kind = event.kind;
  const trade = /abtausch|\btrade\b|gegenseitig/i;
  if (kind === 'knock') return KNOCK.test(title);
  if (kind === 'death')
    return [DEATH_BY, DEATH_ACTIVE, DEATH, EITHER, AFTER_DEATH, trade].some((p) => p.test(title));
  if (KILLS.includes(kind))
    return [KILL, KILL_ACTIVE, EITHER, trade, ...(event.source === 'replay' ? [SNIPE] : [])].some(
      (p) => p.test(title),
    );
  if (kind === 'clutch') return /clutch|unterzahl|allein|letzte/i.test(title);
  if (WINS.includes(kind)) return WIN.test(title);
  return LOSS.test(title);
}

/** Entfernung für Titel: abgerundet auf zehn Meter, damit "über" immer stimmt. */
function over(distance: number | undefined) {
  return distance !== undefined && distance >= 50
    ? ` über ${Math.floor(distance / 10) * 10} m`
    : '';
}

/** Kurzform eines Replay-Treffers: "Snipe über 180 m", "Kill mit der Schrotflinte". */
function hitLabel(event: GameEvent, noun: 'Kill' | 'Knock') {
  if (event.weapon === 'noscope') return `No-Scope-${noun}${over(event.distance)}`;
  if (event.weapon === 'sniper')
    return noun === 'Kill' ? `Snipe${over(event.distance)}` : `Snipe-Knock${over(event.distance)}`;
  if ((event.distance ?? 0) >= 100) return `${noun}${over(event.distance)}`;
  if (event.weapon && !['storm', 'fall'].includes(event.weapon))
    return `${noun} ${WEAPON_WITH[event.weapon]}`;
  return noun === 'Kill' ? 'Gegner ausgeschaltet' : 'Gegner niedergeschlagen';
}

/** Kurzform eines Ereignisses, für Ersatztitel und Zeitmarken. */
export function label(event: GameEvent) {
  const text = event.text.toUpperCase();
  switch (event.kind) {
    case 'matchWon':
      return event.source === 'replay' ? 'Victory Royale' : 'Match gewonnen';
    case 'matchLost':
      return 'Match verloren';
    case 'ace':
      return 'Ace';
    case 'clutch':
      return 'Clutch';
    case 'multikill':
      if (event.count) {
        const name =
          ['', '', 'Doppel-Kill', 'Dreifach-Kill', 'Vierfach-Kill', 'Fünffach-Kill'][event.count] ??
          `${event.count} Kills in Folge`;
        return event.weapon && !['storm', 'fall'].includes(event.weapon)
          ? `${name} ${WEAPON_WITH[event.weapon]}`
          : name;
      }
      return /DREIFACH|TRIPLE|X\s?3/.test(text)
        ? 'Dreifach-Kill'
        : /VIERFACH|QUAD|X\s?4/.test(text)
          ? 'Vierfach-Kill'
          : /DOPPEL|DOUBLE|X\s?2|ZWEI/.test(text)
            ? 'Doppel-Kill'
            : 'Mehrfach-Kill';
    case 'roundWon':
      return 'Runde gewonnen';
    case 'roundLost':
      return 'Runde verloren';
    case 'headshot':
      return 'Headshot';
    case 'kill':
      return hitLabel(event, 'Kill');
    case 'knock':
      return hitLabel(event, 'Knock');
    case 'death':
      if (event.weapon === 'storm') return 'Im Sturm ausgeschieden';
      if (event.weapon === 'fall') return 'Durch Fallschaden ausgeschieden';
      if (event.source === 'replay' && event.weapon) {
        const how = WEAPON_WITH[event.weapon];
        return `${how[0].toUpperCase()}${how.slice(1)} ausgeschaltet`;
      }
      return event.source !== 'spectator' && event.other
        ? `Von ${event.other} ausgeschaltet`
        : 'Ausgeschieden';
  }
}

/**
 * Ersatztitel, wenn auch der zweite Vorschlag des Modells nicht besteht. Mit Ereignis nennt er
 * es schlicht, ohne Ereignis nimmt er den Vorschlag des Modells und entfernt nur Abgeschriebenes.
 */
export function fallbackTitle(
  headlineEvents: GameEvent[],
  modelTitles: string[],
  events: GameEvent[],
  mostly: 'loading' | 'menu' | null,
  map?: string,
) {
  const where = map ? ` auf ${map}` : '';
  // Kill und Tod gegen denselben Gegner im selben Moment sind ein Abtausch (FN-19).
  const death = headlineEvents.find((e) => e.kind === 'death' && e.other);
  const traded = headlineEvents.find(
    (e) =>
      KILLS.includes(e.kind) &&
      death?.other &&
      events.some(
        (k) => k.kind === 'kill' && k.other?.toLowerCase() === death.other!.toLowerCase(),
      ),
  );
  if (death && traded) return `Abtausch mit ${death.other}${where}`;
  if (headlineEvents.length) return `${headlineEvents.map(label).join(' – ')}${where}`;
  if (mostly === 'loading') return 'Ladebildschirm';
  if (mostly === 'menu') return 'Im Menü';
  for (const candidate of modelTitles) {
    if (unsupportedClaims(candidate, events).length) continue;
    const repaired = candidate
      .replace(SCORE, ' ')
      .replace(/\brunde\s+\d+/gi, 'Runde')
      .split(/\s+/)
      .map((w) =>
        w.length >= 4 && w === w.toUpperCase() && /\p{Lu}/u.test(w)
          ? w[0] + w.slice(1).toLowerCase()
          : w,
      )
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (
      repaired &&
      !GENERIC.test(repaired) &&
      !METHOD.test(repaired) &&
      words(repaired).length <= 8
    )
      return repaired;
  }
  return 'Ohne besonderes Ereignis';
}

// Methodengerede, das in der Fußzeile der Bibliothek landete: "Bildstichprobe aus Sekunde 118.37 …".
const METHOD_SENTENCE =
  /stichprobe|einzelbild|beobachtung|notiz|belegbild|beigefügte\w* bild|bild aus sekunde|sekunde \d|verlässlichste\w* beleg|unzuverlässig|bildschirmtext|daran zu prüfen|hinweise? (?:im|aus dem) prompt/i;
// Einblendungen der Aufnahmesoftware sind kein Spielinhalt.
const OVERLAY_SENTENCE =
  /nvidia|geforce|shadowplay|instant replay|game bar|discord|steam-overlay|die aufnahme wurde (?:begonnen|gestartet|gespeichert)/i;
const PERFORMANCE_SENTENCE = /\b\d+\s*fps\b|\bfps\b|\bping\b|\blatenz\b/i;

/** Entfernt Sätze über das Verfahren, die Aufnahmesoftware und Leistungsanzeigen. */
export function cleanText(text: string, { keepOverlay = false } = {}) {
  const sentences = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+/);
  return sentences
    .filter(
      (s) =>
        !METHOD_SENTENCE.test(s) &&
        !PERFORMANCE_SENTENCE.test(s) &&
        (keepOverlay || !OVERLAY_SENTENCE.test(s)),
    )
    .join(' ')
    .trim();
}

export interface Highlight {
  seconds: number;
  title: string;
  description: string;
}

/**
 * Zeitmarken: zuerst die belegten Ereignisse, dann die Vorschläge des Modells, sofern sie nichts
 * Unbelegtes behaupten und nicht dieselbe Stelle oder denselben Titel wiederholen. Vorher standen
 * sechs Marken mit demselben Titel "Tod durch Feuerwaffe" untereinander.
 */
/** Sekunden Vorlauf vor einer Zeitmarke aus Meldung oder Replay. */
export const HIGHLIGHT_LEAD = 1;
/** Mindestabstand eines Modellvorschlags zu einer belegten Marke, in Sekunden. */
const PROVEN_GAP = 3;
/** Ereignisse eines Augenblicks, deren Einblendung erst danach erscheint. */
const SUDDEN: EventKind[] = ['kill', 'multikill', 'headshot', 'knock', 'death', 'ace', 'clutch'];
export function tidyHighlights(
  proposed: Highlight[],
  events: GameEvent[],
  duration: number,
  /** Lachstellen aus dem Transkript (agent/speech.ts); die Marke setzt kurz vor dem Lachen an. */
  laughs: readonly { start: number; end: number }[] = [],
) {
  const out: Highlight[] = [];
  // Neben belegten Ereignissen reichen wenige Vorschläge; sonst reihen sich "Kampfbericht",
  // "Schneeumgebung" und "Karte B Site" hinter den eigentlichen Moment.
  let room = events.some((e) => ['screen', 'replay', 'ocr'].includes(e.source)) ? 3 : 5;
  const key = (title: string) => title.toLowerCase().replace(/[^a-zäöüß0-9]+/g, '');
  // Belegte Kills und Tode dürfen gleich heißen: drei Kills sind drei Stellen. Ein Siegerbanner,
  // das in zwei Bildern stand, ist dagegen eine Stelle, ebenso ein Vorschlag mit vergebenem Titel.
  // Das Modell nennt belegte Momente zur Zeit der Einblendung; neben der vorgezogenen Marke
  // desselben Moments wäre das eine zweite, deshalb halten Vorschläge Abstand zu belegten Marken.
  const proven: number[] = [];
  // `belegt`: aus Ereignis oder Ton; `wiederholbar`: derselbe Titel darf mehrmals stehen.
  const add = (h: Highlight, source: 'vorschlag' | 'belegt' | 'wiederholbar' = 'vorschlag') => {
    if (!Number.isFinite(h.seconds) || h.seconds < 0 || h.seconds > duration) return;
    const seconds = h.seconds;
    const title = h.title.replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!title) return;
    if (
      out.some(
        (o) =>
          (source !== 'wiederholbar' && key(o.title) === key(title)) ||
          Math.abs(o.seconds - seconds) < 1.5,
      ) ||
      (source === 'vorschlag' && proven.some((p) => Math.abs(p - seconds) < PROVEN_GAP))
    )
      return;
    if (source !== 'vorschlag') proven.push(seconds);
    out.push({
      seconds: Number(seconds.toFixed(2)),
      title,
      description: cleanText(h.description).slice(0, 400),
    });
  };
  // Eine Zeitmarke soll den Moment zeigen, nicht die Einblendung danach: gelesene Meldungen
  // beginnen am letzten Bild ohne sie, alle mit etwas Vorlauf, damit man den Kill kommen sieht.
  // Ergebnisbanner stehen lange und markieren ihr Erscheinen selbst; sie bleiben, wo sie sind.
  const start = (e: GameEvent, seconds: number) =>
    SUDDEN.includes(e.kind) ? Math.max(0, seconds - HIGHLIGHT_LEAD) : seconds;
  // An derselben Stelle gewinnt das gewichtigere Ereignis: der Dreifach-Kill vor dem dritten Kill.
  const ordered = [...events].sort(
    (a, b) => (a.seconds ?? 0) - (b.seconds ?? 0) || SIGNIFICANCE[b.kind] - SIGNIFICANCE[a.kind],
  );
  const sourceOf = (e: GameEvent) => (SUDDEN.includes(e.kind) ? 'wiederholbar' : 'belegt');
  for (const e of ordered)
    if (e.seconds !== null && (e.source === 'screen' || e.source === 'ocr'))
      add(
        {
          seconds: start(e, SUDDEN.includes(e.kind) ? (e.from ?? e.seconds) : e.seconds),
          title: label(e),
          description: `Meldung: ${e.text}`,
        },
        sourceOf(e),
      );
    else if (e.seconds !== null && e.source === 'replay')
      add(
        { seconds: start(e, e.seconds), title: label(e), description: `${phrase(e)}.` },
        sourceOf(e),
      );
  for (const laugh of laughs)
    add(
      {
        seconds: Math.max(0, laugh.start - HIGHLIGHT_LEAD),
        title: 'Lachflash',
        description: 'Lachen im Voice-Chat.',
      },
      'wiederholbar',
    );
  for (const h of proposed) {
    if (room <= 0) break;
    if (unsupportedClaims(`${h.title} ${h.description}`, events).length || shouting(h.title))
      continue;
    const before = out.length;
    add(h);
    if (out.length > before) room--;
  }
  return out.sort((a, b) => a.seconds - b.seconds).slice(0, 6);
}

/**
 * Vorbehalt für die Fußzeile. Die Angaben des Modells waren fast immer Methodengerede oder
 * zweifelten an belegten Tatsachen ("unklar, ob du bereits ausgeschaltet wurdest" unter
 * "GETÖTET VON DEADLOCK"). Hier steht deshalb nur, was an der Beleglage tatsächlich offen ist.
 */
export function uncertaintyFor(headlineEvents: GameEvent[], lostFrames: number) {
  const notes: string[] = [];
  const main = headlineEvents[0];
  if (main?.source === 'nvidia')
    notes.push(
      'Das Ereignis nennt NVIDIA im Dateinamen, die Stelle selbst ist in den Bildern nicht zu sehen.',
    );
  else if (headlineEvents.some((e) => e.kind === 'death' && e.source === 'spectator'))
    notes.push('Dein Ausscheiden selbst ist nicht zu sehen, nur die Ansicht danach.');
  if (lostFrames) notes.push('Einige Bilder ließen sich nicht auswerten.');
  return notes.join(' ');
}
