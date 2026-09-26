/**
 * Speech as context for fun clips (docs/AI-RECOGNITION.md, stage 4). Ollama does not accept
 * audio; the transcript goes into the summary as text. Where it comes from (Whisper, Parakeet)
 * is up to the caller via `LocalAnalyzerOptions.speech`.
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
  /** Compute time in seconds. */
  seconds: number;
  words: number;
  /** Spots where laughter or crosstalk drove the recognition into repetitions. */
  laughs: number;
  /** What the conversation was about, if more than game callouts (LocalAnalyzer). */
  topic?: string;
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

/** From this many identical short sentences in a row on, it is no longer a conversation. */
const RUN = 4;

/**
 * Separates what was said from spots where the recognition fell into repeating itself. Whisper
 * answers laughter and crosstalk with series like "Nein. Nein. Nein." every second (measured on
 * 2026-09-24 on a Fortnite clip with a laughing fit, 95–110 s). Such series become a laugh spot;
 * at most their first line is kept as speech.
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

/** Whether there is enough talking for the conversation to carry a clip. */
export function conversational(transcript: Transcript | undefined) {
  if (!transcript) return false;
  const { said, laughs } = splitTranscript(transcript.segments);
  return said.reduce((n, s) => n + words(s.text), 0) >= 25 || laughs.length > 0;
}

/**
 * The speech as a paragraph for the prompt (German on purpose): with seconds, cut to about 250
 * words, plus the laugh spots. Empty if nothing was said.
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

/**
 * The topic the model found in the conversation, or empty if it is none: a single word or a
 * verbatim quoted sentence ("Nein", "Was hast du gemacht?", measured on 2026-09-25) does not say
 * what it was about.
 */
export function usableTopic(topic: unknown, said: string) {
  if (typeof topic !== 'string') return '';
  const clean = topic.replace(/\s+/g, ' ').trim().slice(0, 80);
  const key = plain(clean);
  // Only whole sentences count as a quote; a name from one ("Obi-Wan Kenobi") is a topic.
  const sentences = said
    .replace(/\[\d+ s\]/g, '\n')
    .split(/[\n.!?]+/)
    .map(plain);
  return words(clean) < 2 || sentences.includes(key) ? '' : clean;
}
