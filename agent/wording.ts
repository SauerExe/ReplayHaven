import type { EventKind, GameEvent } from './events';

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
  if (!killed && EITHER.test(rest) && !kill && !death)
    problems.push('behauptet ein Ausschalten, das keine Meldung belegt');
  if (WIN.test(text) && !has(events, WINS))
    problems.push('behauptet einen Sieg, den keine Meldung belegt');
  if (LOSS.test(text) && !has(events, LOSSES))
    problems.push('behauptet eine Niederlage, die keine Meldung belegt');
  return problems;
}

/** Was an einem Titel nicht stimmt, als Sätze für die Rückfrage an das Modell. */
export function titleProblems(title: string, events: GameEvent[], headlineEvents: GameEvent[]) {
  const problems = unsupportedClaims(title, events);
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
  if (main && !problems.length && !mentions(title, main.kind))
    problems.push(`benennt das wichtigste belegte Ereignis nicht (${label(main)})`);
  return problems;
}

function mentions(title: string, kind: EventKind) {
  const trade = /abtausch|\btrade\b|gegenseitig/i;
  if (kind === 'death')
    return [DEATH_BY, DEATH_ACTIVE, DEATH, EITHER, AFTER_DEATH, trade].some((p) => p.test(title));
  if (KILLS.includes(kind)) return [KILL, KILL_ACTIVE, EITHER, trade].some((p) => p.test(title));
  if (kind === 'clutch') return /clutch|unterzahl|allein|letzte/i.test(title);
  if (WINS.includes(kind)) return WIN.test(title);
  return LOSS.test(title);
}

/** Kurzform eines Ereignisses, für Ersatztitel und Zeitmarken. */
export function label(event: GameEvent) {
  const text = event.text.toUpperCase();
  switch (event.kind) {
    case 'matchWon':
      return 'Match gewonnen';
    case 'matchLost':
      return 'Match verloren';
    case 'ace':
      return 'Ace';
    case 'clutch':
      return 'Clutch';
    case 'multikill':
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
      return 'Gegner ausgeschaltet';
    case 'death':
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
) {
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
  if (death && traded) return `Abtausch mit ${death.other}`;
  if (headlineEvents.length) return headlineEvents.map(label).join(' – ');
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
export function tidyHighlights(proposed: Highlight[], events: GameEvent[], duration: number) {
  const out: Highlight[] = [];
  // Neben belegten Ereignissen reichen wenige Vorschläge; sonst reihen sich "Kampfbericht",
  // "Schneeumgebung" und "Karte B Site" hinter den eigentlichen Moment.
  let room = events.some((e) => e.source === 'screen') ? 3 : 5;
  const key = (title: string) => title.toLowerCase().replace(/[^a-zäöüß0-9]+/g, '');
  const add = (h: Highlight) => {
    if (!Number.isFinite(h.seconds) || h.seconds < 0 || h.seconds > duration) return;
    const seconds = h.seconds;
    const title = h.title.replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!title) return;
    if (out.some((o) => key(o.title) === key(title) || Math.abs(o.seconds - seconds) < 1.5)) return;
    out.push({
      seconds: Number(seconds.toFixed(2)),
      title,
      description: cleanText(h.description).slice(0, 400),
    });
  };
  for (const e of events)
    if (e.seconds !== null && e.source === 'screen')
      add({ seconds: e.seconds, title: label(e), description: `Meldung: ${e.text}` });
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
