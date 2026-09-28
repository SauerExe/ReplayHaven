import { SIGNIFICANCE, WEAPON_WITH, countWord, phrase } from './events';
import type { EventKind, GameEvent, Weapon } from './events';

/**
 * Checking and post-processing of the texts the model writes. It phrases things well but now and
 * then claims what did not happen ("Tod durch Feuerwaffe" over a clip in which the user
 * eliminates two enemies) or copies HUD readouts ("3 vs 1", "FINKA im Visier"). Both can be
 * checked against the proven events (experiment E17).
 */

const KILLS: EventKind[] = ['kill', 'multikill', 'headshot', 'ace'];
const WINS: EventKind[] = ['roundWon', 'matchWon', 'ace', 'clutch'];
const LOSSES: EventKind[] = ['roundLost', 'matchLost'];

// "von hinten ausgeschaltet" describes the player's own kill, "von Deadlock ausgeschaltet" a death.
const DEATH_BY =
  /\bvon\s+(?!hinten\b|oben\b|unten\b|vorne\b|links\b|rechts\b|weitem\b|nahem\b)[^\s,.;:!?]+(?:\s+[^\s,.;:!?]+)?\s+(?:ausgeschaltet|eliminiert|erledigt|erwischt|getötet|niedergestreckt)/i;
const DEATH = /\b(?:tod|tot|gestorben|stirbt|stirbst|getötet|ausgeschieden|draufgegangen)\b/i;
// Active voice: "Deadlock schaltet dich aus" is a death, "du schaltest ihn aus" a kill.
const DEATH_ACTIVE =
  /\b(?:schaltet|erledigt|erwischt|killt|tötet|eliminiert|holt|schlägt|besiegt|erschießt)\b[^.,;!?]{0,30}\b(?:dich|mich)\b/i;
// Trailing agent: "Ausgeschaltet von GegnerEins", "Erledigt durch einen Sturz".
const DEATH_PASSIVE =
  /\b(?:ausgeschaltet|eliminiert|erledigt|erwischt|getötet|besiegt)\s+(?:von|durch)\b/i;
const KILL_ACTIVE = /\b(?:schaltest|erledigst|erwischst|eliminierst|killst|holst)\b/i;
// Even as an activity ("Zombies töten") this is a claim that needs an event.
const KILL =
  /\b(?:kills?|headshots?|kopfsch(?:uss|üssen?)|ace|multikill|(?:doppel|dreifach|vierfach|mehrfach)-?kills?|abschuss|abgeschossen|abschie(?:ß|ss)en|töten|killen)\b/i;
// Only checked against replay events: snipes and knocks ("niedergeschlagen" is not a kill).
const SNIPE = /\b(?:snipes?|gesnip(?:ed|t)|no-?scope\w*)\b/i;
const KNOCK = /\b(?:knocks?|geknockt|umgeknockt|niedergeschlagen)\b/i;
// Can mean a kill or a death; allowed as soon as either one is proven.
const EITHER =
  /\b(?:ausgeschaltet|ausschalten|eliminiert|eliminieren|eliminierung(?:en)?|erledigt|erledigen|erwischt|besiegt)\b/i;
// "Gegner besiegt" is a kill, not a win.
const WIN = /(?<!be)sieg|gewonnen|gewinn|victory/i;
const LOSS = /niederlage|verloren|verlier/i;
// Revive and spectating imply a death without claiming one.
const AFTER_DEATH = /respawn|wiederbeleb|zuschau|ausgeschieden/i;

const GENERIC =
  /\b(?:spielabschnitt|gameplay|spielszene|spielansicht|aufnahme|clip|screenshot|bildschirm|video)\b/i;
const METHOD =
  /\b(?:stichprobe|frames?|einzelbild\w*|beobachtung\w*|notiz\w*|belegbild|sekunden?)\b/i;
// Voice chat as such says nothing about the clip ("Verwirrung im Voice-Chat"); the topic of the
// conversation does, hence a separate piece of feedback that lets the model keep it.
const CHAT = /\b(?:voice-?chats?|sprachchats?|chats?|gespräch\w*|diskussion\w*|unterhaltung\w*)\b/i;
// Only the location phrase ("… im Voice-Chat"), which the fallback title can drop without
// losing the topic.
const CHAT_PLACE = /\s+(?:im|in|aus dem|über den)\s+(?:voice-?chat|sprachchat|chat)\b/gi;
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

/** Claims no event backs up. Empty if the text says nothing unproven. */
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
  // Replay events are counted and measured; only with them can snipes, knocks, streaks and
  // distances be checked. Clips without a replay are checked as before.
  if (events.some((e) => e.source === 'replay'))
    problems.push(...exactClaims(rest, events, killed));
  else {
    // A streak that was read is counted too: "Vierfach-Kill" with three kills is wrong.
    const counted = Math.max(
      0,
      ...events.map((e) => (e.kind === 'multikill' ? (e.count ?? 2) : 0)),
    );
    const series = seriesIn(rest);
    if (counted && series > counted)
      problems.push(`behauptet ${series} Kills in Folge, belegt sind ${counted}`);
  }
  // In R6 an operator is called ACE ("KILLED BY xiTango | ACE"); an ace needs its own message.
  if (/\bace\b/i.test(text) && !has(events, ['ace']))
    problems.push('behauptet ein Ace, das keine Meldung belegt');
  // Headshots are counted: "Drei Kopfschüsse" with two is wrong (VAL-B1, 2026-09-25).
  const heads = Math.max(
    events.filter((e) => e.kind === 'headshot').length,
    ...events.map((e) => (e.kind === 'multikill' ? (e.headshots ?? 0) : 0)),
  );
  const claimedHeads = HEADSHOT.test(rest) ? Math.max(1, countIn(rest, HEADSHOT_NOUNS)) : 0;
  if (claimedHeads > heads)
    problems.push(
      heads
        ? `behauptet ${claimedHeads} Kopfschüsse, belegt sind ${heads}`
        : 'behauptet einen Kopfschuss, den keine Meldung belegt',
    );
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
  // "Snipe-Knock über 180 m" describes a knock, not a kill.
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

/** Common phrases with "auf" that do not refer to a map ("Kopfschuss auf Distanz"). */
const COMMON_AFTER_AUF =
  /^(?:Distanz|Entfernung|Abstand|Anhieb|Augenhöhe|Sicht|Zeit|Kurs|Ansage|Kommando|Befehl|Risiko|Ansatz|Knopfdruck|Zuruf|Deckung|Führung|Position|Stellung|Lauer|Sicherheit|Eis|Feuer|Wasser|Lava|Kopf|Kette|Ketten)$/i;

/** What is known about the location: the recognised map and all maps of the game. */
export interface MapContext {
  map?: string;
  maps: readonly string[];
}

/** What is wrong with a title, as sentences for the follow-up question to the model. */
export function titleProblems(
  title: string,
  events: GameEvent[],
  headlineEvents: GameEvent[],
  place?: MapContext,
) {
  const problems = unsupportedClaims(title, events);
  // A map in the title must be the recognised one; a guessed one would often be wrong.
  const named = place?.maps.find((m) => new RegExp(`\\b${m}\\b`, 'i').test(title));
  if (named && named !== place?.map)
    problems.push(
      place?.map
        ? `nennt die Karte ${named}, erkannt wurde ${place.map}`
        : `nennt die Karte ${named}, die nicht erkannt wurde`,
    );
  // Also a place that does not exist at all: on 2026-09-24 Qwen3.5 wrote "Gelber Bagger auf
  // Dantzig" for a frame without a map name. "auf" plus a proper noun counts as a map.
  // At the end of the title after "auf", "über", "in", "bei", "nach" or "vor": for the same
  // frame Qwen3.5 also wrote "Übersicht über Dantzig".
  const where =
    /(?<!\p{L})(?:auf|über|in|bei|nach|vor)\s+([A-ZÄÖÜ][\p{L}'-]+(?:\s+[A-ZÄÖÜ][\p{L}'-]+)?)\s*[!.]?$/u.exec(
      title.trim(),
    );
  // Likewise two capitalised words after a preposition ("Übersicht über Dirt Haul"): in
  // German almost always a proper noun, whereas single words ("in Deckung") often are not.
  // Word boundary via lookbehind: \b does not know "ü" and would not find "über".
  const compound =
    /(?<!\p{L})(?:auf|über|in|im|am|an|bei|nach|vor)\s+([A-ZÄÖÜ][\p{L}'-]+\s+[A-ZÄÖÜ][\p{L}'-]+)/u.exec(
      title,
    );
  // "auf Kafe" means "Kafe Dostoyevsky": the start of the map name counts as the map.
  const isMap = (name: string) =>
    !!place?.map && `${place.map.toLowerCase()} `.startsWith(`${name.toLowerCase()} `);
  const invented = [where?.[1], compound?.[1]].find(
    (name) => name && !COMMON_AFTER_AUF.test(name) && !isMap(name),
  );
  // With a proven event the recognised map belongs in the title ("Dreifach-Kill auf Oregon").
  const short = place?.map?.split(' ')[0];
  if (place?.map && headlineEvents.length && !new RegExp(`\\b${short}\\b`, 'i').test(title))
    problems.push(`nennt die erkannte Karte nicht; hänge "auf ${place.map}" an`);
  if (place && !named && invented)
    problems.push(
      place.map
        ? `nennt den Ort ${invented}, erkannt wurde die Karte ${place.map}`
        : `nennt den Ort ${invented}, der nicht als Karte erkannt wurde`,
    );
  if (!title.trim()) problems.push('ist leer');
  if (shouting(title)) problems.push('übernimmt Bildschirmtext in Großbuchstaben');
  if (SCORE.test(title)) problems.push('enthält einen Punktestand oder ein Zahlenverhältnis');
  if (/\brunde\s+(?:\d+|eins|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn)\b/i.test(title))
    problems.push('nennt eine Rundennummer');
  if (GENERIC.test(title)) problems.push('ist zu allgemein');
  if (METHOD.test(title)) problems.push('spricht über das Verfahren statt über den Moment');
  if (CHAT.test(title))
    problems.push(
      'nennt den Voice-Chat statt seines Inhalts; behalte Thema oder Pointe und lass das Wort weg',
    );
  if (words(title).length > 8 || title.length > 60) problems.push('ist zu lang');
  // The second person ("du") is for the description; in a headline it reads oddly ("Du von
  // Deadlock ausgeschaltet"). The first person confuses the perspective ("Omen schaltet mich").
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
  // "Ausgeschaltet in der Luft" reads like a kill but was the player's own death (FN-02,
  // 2026-09-25). Without an own kill, a title about a death must say who got eliminated.
  else if (
    main?.kind === 'death' &&
    !problems.length &&
    !has(headlineEvents, KILLS) &&
    ![DEATH_BY, DEATH_ACTIVE, DEATH, AFTER_DEATH, DEATH_PASSIVE].some((p) => p.test(title))
  )
    problems.push(
      'lässt offen, wer ausgeschaltet wurde; es war dein eigener Tod (etwa "Von … ausgeschaltet")',
    );
  return problems;
}

/** Count of a named streak: "Doppel-Kill" 2, "Triple Kill" 3. 0 without a streak. */
function seriesIn(text: string) {
  const series: [RegExp, number][] = [
    [/\b(?:fünffach|penta)\w*/i, 5],
    [/\b(?:vierfach|quad)\w*/i, 4],
    [/\b(?:dreifach|triple)\w*/i, 3],
    // Also "Doppelter Kopfschuss".
    [/\b(?:doppel|double|zweifach)(?:-?kills?|-?eliminierung\w*|te[rnms]?\b|\b)/i, 2],
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
const KILL_NOUNS = 'kills?|abschüsse|eliminierungen|kopfschüssen?|headshots';
const HEADSHOT_NOUNS = 'kopfschüssen?|kopfschuss|headshots?';
const HEADSHOT = /\b(?:kopfsch(?:uss|üssen?)|headshots?)\b/i;
/**
 * Count stated before a word like "Kills": "Drei Kills in Folge", "zwei schnelle Abschüsse",
 * "Drei-Kill-Serie", "4 Kills". Distances like "200 Meter Kill" are not a count. 0 if none
 * is stated.
 */
function countIn(text: string, nouns: string) {
  const match = new RegExp(
    `(?<![\\wäöüß])(${Object.keys(NUMBERS).join('|')}|\\d{1,2})[\\s-]+(?!(?:m|meter[n]?)(?![\\wäöüß]))(?:[\\wäöüß]+[\\s-]+)?(?:${nouns})(?![\\wäöüß])`,
    'i',
  ).exec(text);
  return match ? (NUMBERS[match[1].toLowerCase()] ?? Number(match[1])) : 0;
}

/** Stated distance in metres: "über 180 m", "180-m-Snipe", "200 Meter". */
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

/** Weapons a text mentions. */
function weaponsIn(text: string) {
  return WEAPON_WORDS.filter(([, pattern]) => pattern.test(text)).flatMap(([weapons]) => weapons);
}

/**
 * What makes a replay event special should be in the title: the size of a streak, a snipe or
 * a long distance. Messages read from the screen carry no such details.
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

/** Distance for titles: rounded down to ten metres so that "über" (over) is always true. */
function over(distance: number | undefined) {
  return distance !== undefined && distance >= 50
    ? ` über ${Math.floor(distance / 10) * 10} m`
    : '';
}

/** Short form of a replay hit: "Snipe über 180 m", "Kill mit der Schrotflinte". */
function hitLabel(event: GameEvent, noun: 'Kill' | 'Knock') {
  if (event.weapon === 'noscope') return `No-Scope-${noun}${over(event.distance)}`;
  if (event.weapon === 'sniper')
    return noun === 'Kill' ? `Snipe${over(event.distance)}` : `Snipe-Knock${over(event.distance)}`;
  if ((event.distance ?? 0) >= 100) return `${noun}${over(event.distance)}`;
  if (event.weapon && !['storm', 'fall'].includes(event.weapon))
    return `${noun} ${WEAPON_WITH[event.weapon]}`;
  return noun === 'Kill' ? 'Gegner ausgeschaltet' : 'Gegner niedergeschlagen';
}

/** Short form of an event, for fallback titles and highlights. */
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
          : event.headshots && event.headshots >= event.count
            ? `${name} per Kopfschuss`
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
 * Fallback title when the model's second suggestion fails too. With an event it simply names
 * it; without one it takes the model's suggestion and only removes copied HUD text.
 */
export function fallbackTitle(
  headlineEvents: GameEvent[],
  modelTitles: string[],
  events: GameEvent[],
  mostly: 'loading' | 'menu' | null,
  map?: string,
) {
  const where = map ? ` auf ${map}` : '';
  // A kill and a death against the same enemy at the same moment are a trade (FN-19).
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
  // The map belongs to the first event: "Runde gewonnen auf Kanal – Von … ausgeschaltet".
  if (headlineEvents.length)
    return [`${label(headlineEvents[0])}${where}`, ...headlineEvents.slice(1).map(label)].join(
      ' – ',
    );
  if (mostly === 'loading') return 'Ladebildschirm';
  if (mostly === 'menu') return 'Im Menü';
  // Latest suggestion first: it answers the follow-up question and has usually fixed its
  // problems already ("Eiswand im Voice-Chat", then "Obi-Wan und Yoda im Voice-Chat").
  for (const candidate of [...modelTitles].reverse()) {
    if (unsupportedClaims(candidate, events).length) continue;
    const repaired = candidate
      .replace(CHAT_PLACE, ' ')
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
      !CHAT.test(repaired) &&
      words(repaired).length <= 8
    )
      return repaired;
  }
  return 'Ohne besonderes Ereignis';
}

// Method talk that ended up in the library footer: "Bildstichprobe aus Sekunde 118.37 …".
const METHOD_SENTENCE =
  /stichprobe|einzelbild|beobachtung|notiz|belegbild|beigefügte\w* bild|bild aus sekunde|sekunde \d|verlässlichste\w* beleg|unzuverlässig|bildschirmtext|daran zu prüfen|hinweise? (?:im|aus dem) prompt/i;
// Overlays from the recording software are not game content.
const OVERLAY_SENTENCE =
  /nvidia|geforce|shadowplay|instant replay|game bar|discord|steam-overlay|die aufnahme wurde (?:begonnen|gestartet|gespeichert)/i;
const PERFORMANCE_SENTENCE = /\b\d+\s*fps\b|\bfps\b|\bping\b|\blatenz\b/i;

/** Removes sentences about the method, the recording software and performance overlays. */
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
 * Highlights: first the proven events, then the model's suggestions, as long as they claim
 * nothing unproven and do not repeat the same position or title. Previously six highlights
 * with the same title "Tod durch Feuerwaffe" were listed one below the other.
 */
/** Seconds of lead-in before a highlight from a message or replay. */
export const HIGHLIGHT_LEAD = 1;
/** Minimum distance of a model suggestion from a proven highlight, in seconds. */
const PROVEN_GAP = 3;
/** Instant events whose on-screen message only appears afterwards. */
const SUDDEN: EventKind[] = ['kill', 'multikill', 'headshot', 'knock', 'death', 'ace', 'clutch'];
export function tidyHighlights(
  proposed: Highlight[],
  events: GameEvent[],
  duration: number,
  /** Laughs from the transcript (agent/speech.ts); the highlight starts shortly before the laugh. */
  laughs: readonly { start: number; end: number }[] = [],
) {
  const out: Highlight[] = [];
  // Next to proven events a few suggestions are enough; otherwise "Kampfbericht",
  // "Schneeumgebung" and "Karte B Site" line up behind the actual moment.
  let room = events.some((e) => ['screen', 'replay', 'ocr'].includes(e.source)) ? 3 : 5;
  const key = (title: string) => title.toLowerCase().replace(/[^a-zäöüß0-9]+/g, '');
  // Proven kills and deaths may share a title: three kills are three positions. A victory banner
  // seen in two frames, however, is one position, as is a suggestion with a title already taken.
  // The model places proven moments at the time of the on-screen message; next to the earlier
  // highlight of the same moment that would be a second one, so suggestions keep their distance.
  const proven: number[] = [];
  // `proven`: from an event or audio; `repeatable`: the same title may appear several times.
  const add = (h: Highlight, source: 'suggested' | 'proven' | 'repeatable' = 'suggested') => {
    if (!Number.isFinite(h.seconds) || h.seconds < 0 || h.seconds > duration) return;
    const seconds = h.seconds;
    const title = h.title.replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!title) return;
    if (
      out.some(
        (o) =>
          (source !== 'repeatable' && key(o.title) === key(title)) ||
          Math.abs(o.seconds - seconds) < 1.5,
      ) ||
      (source === 'suggested' && proven.some((p) => Math.abs(p - seconds) < PROVEN_GAP))
    )
      return;
    if (source !== 'suggested') proven.push(seconds);
    out.push({
      seconds: Number(seconds.toFixed(2)),
      title,
      description: cleanText(h.description).slice(0, 400),
    });
  };
  // A highlight should show the moment, not the message afterwards: messages that were read
  // start at the last frame without them, all with some lead-in so you see the kill coming.
  // Result banners stay on screen for long and mark their own appearance; they stay put.
  const start = (e: GameEvent, seconds: number) =>
    SUDDEN.includes(e.kind) ? Math.max(0, seconds - HIGHLIGHT_LEAD) : seconds;
  // At the same position the weightier event wins: the triple kill before the third kill.
  const ordered = [...events].sort(
    (a, b) => (a.seconds ?? 0) - (b.seconds ?? 0) || SIGNIFICANCE[b.kind] - SIGNIFICANCE[a.kind],
  );
  const sourceOf = (e: GameEvent) => (SUDDEN.includes(e.kind) ? 'repeatable' : 'proven');
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
      'repeatable',
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
 * Caveat for the footer. The model's own notes were almost always method talk or doubted proven
 * facts ("unklar, ob du bereits ausgeschaltet wurdest" under "GETÖTET VON DEADLOCK"). So this
 * only states what is actually open about the evidence.
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
