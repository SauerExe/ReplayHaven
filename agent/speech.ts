/**
 * Gesprochenes als Kontext für Spaßclips (docs/KI-ERKENNUNG.md, Stufe 4). Ollama nimmt keinen
 * Ton an; das Transkript geht als Text in die Zusammenfassung. Woher es kommt (Whisper,
 * Parakeet), entscheidet der Aufrufer über `LocalAnalyzerOptions.speech`.
 */

export interface SpeechSegment {
  start: number;
  end: number;
  text: string;
}

export interface Transcript {
  segments: SpeechSegment[];
  trace: SpeechTrace;
}

export interface SpeechTrace {
  engine: string;
  /** Rechenzeit in Sekunden. */
  seconds: number;
  words: number;
  /** Stellen, an denen Lachen oder Durcheinander die Erkennung in Wiederholungen trieb. */
  laughs: number;
  error?: string;
}

export interface Laugh {
  start: number;
  end: number;
}

const words = (text: string) => text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const plain = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .trim();

/** Ab so vielen gleichen Kurzsätzen hintereinander ist es kein Gespräch mehr. */
const RUN = 4;

/**
 * Trennt Gesagtes von Stellen, an denen die Erkennung ins Wiederholen fiel. Whisper antwortet
 * auf Lachen und Durcheinander mit Serien wie "Nein. Nein. Nein." im Sekundentakt (gemessen am
 * 2026-09-24 an einem Fortnite-Clip mit Lachflash, 95–110 s). Solche Serien werden zu einer
 * Lachstelle; von ihnen bleibt höchstens die erste Zeile als Gesagtes.
 */
export function splitTranscript(segments: readonly SpeechSegment[]): {
  said: SpeechSegment[];
  laughs: Laugh[];
} {
  const said: SpeechSegment[] = [];
  const laughs: Laugh[] = [];
  let i = 0;
  while (i < segments.length) {
    const key = plain(segments[i].text);
    let j = i + 1;
    while (
      j < segments.length &&
      key &&
      plain(segments[j].text) === key &&
      words(segments[j].text) <= 3
    )
      j++;
    if (j - i >= RUN && words(segments[i].text) <= 3) {
      said.push(segments[i]);
      laughs.push({ start: segments[i].start, end: segments[j - 1].end });
    } else said.push(...segments.slice(i, j));
    i = j;
  }
  return { said: said.filter((s) => words(s.text) > 0), laughs };
}

/** Ob genug gesprochen wird, dass das Gespräch einen Clip tragen kann. */
export function conversational(transcript: Transcript | undefined) {
  if (!transcript) return false;
  const { said, laughs } = splitTranscript(transcript.segments);
  return said.reduce((n, s) => n + words(s.text), 0) >= 25 || laughs.length > 0;
}

/**
 * Das Gesprochene als Absatz für den Prompt: mit Sekunden, gekürzt auf rund 250 Wörter, dazu die
 * Lachstellen. Leer, wenn nichts gesagt wurde.
 */
export function speechFacts(transcript: Transcript | undefined) {
  if (!transcript?.segments.length) return '';
  const { said, laughs } = splitTranscript(transcript.segments);
  if (!said.length && !laughs.length) return '';
  const lines: string[] = [];
  let budget = 250;
  for (const s of said) {
    if (budget <= 0) break;
    lines.push(`[${s.start.toFixed(0)} s] ${s.text.trim()}`);
    budget -= words(s.text);
  }
  const laughed = laughs.length
    ? `\nLachen oder Durcheinander im Voice-Chat bei ${laughs.map((l) => `${l.start.toFixed(0)}–${l.end.toFixed(0)} s`).join(', ')}.`
    : '';
  return `Gesprochen im Voice-Chat (automatisch mitgeschrieben, einzelne Wörter können falsch sein; Sprecher unbekannt):\n${lines.join('\n')}${laughed}`;
}
