import { expect, it } from 'vitest';
import { conversational, speechFacts, splitTranscript, usableTopic } from './speech';
import { tidyHighlights } from './wording';
import type { SpeechSegment, Transcript } from './speech';

// Auszug aus dem Transkript eines Fortnite-Clips (Whisper medium, 2026-09-24): Star-Wars-Raten,
// dann ein Lachflash, den Whisper als Serie von "Nein." mitschrieb.
const said = (start: number, text: string): SpeechSegment => ({ start, end: start + 1, text });
const segments = [
  said(71.2, 'Anakin Skywalker.'),
  said(72.2, 'Nein.'),
  said(89.7, 'Das ist Obi-Wan Kenobi.'),
  said(94.7, 'Obi-Wan Kenobi ist doch grün.'),
  ...Array.from({ length: 15 }, (_, i) => said(95.7 + i, 'Nein.')),
  said(117.5, 'Das ist Yoda.'),
];
const transcript: Transcript = {
  segments,
  trace: { engine: 'test', seconds: 1, words: 0, laughs: 0 },
};

it('turns a run of repeated short lines into a laugh and keeps the conversation', () => {
  const { said: kept, laughs } = splitTranscript(segments);
  expect(laughs).toEqual([{ start: 95.7, end: 110.7 }]);
  expect(kept.map((s) => s.text)).toEqual([
    'Anakin Skywalker.',
    'Nein.',
    'Das ist Obi-Wan Kenobi.',
    'Obi-Wan Kenobi ist doch grün.',
    'Nein.',
    'Das ist Yoda.',
  ]);
});

it('keeps a short answer repeated only a few times', () => {
  expect(splitTranscript([said(1, 'Ja.'), said(2, 'Ja.'), said(3, 'Ja.')]).laughs).toEqual([]);
});

it('writes the conversation with seconds and the laugh for the prompt', () => {
  const facts = speechFacts(transcript);
  expect(facts).toContain('[95 s] Obi-Wan Kenobi ist doch grün.');
  expect(facts).toContain('Lachen oder Durcheinander im Voice-Chat bei 96–111 s.');
  expect(facts.match(/Nein/g)).toHaveLength(2);
  expect(conversational(transcript)).toBe(true);
  expect(speechFacts(undefined)).toBe('');
  expect(conversational({ ...transcript, segments: [said(3, 'Go go.')] })).toBe(false);
});

it('marks the laugh just before it starts, next to the model proposals', () => {
  const { laughs } = splitTranscript(segments);
  expect(
    tidyHighlights([{ seconds: 72, title: 'Star-Wars-Raten', description: '' }], [], 120, laughs),
  ).toEqual([
    { seconds: 72, title: 'Star-Wars-Raten', description: '' },
    { seconds: 94.7, title: 'Lachflash', description: 'Lachen im Voice-Chat.' },
  ]);
});

it('keeps a summarised topic and drops single words and quoted sentences', () => {
  const text = speechFacts(transcript);
  expect(usableTopic('Obi-Wan oder Yoda?', text)).toBe('Obi-Wan oder Yoda?');
  expect(usableTopic('Obi-Wan Kenobi', text)).toBe('Obi-Wan Kenobi');
  expect(usableTopic('Nein', text)).toBe('');
  expect(usableTopic('Das ist Obi-Wan Kenobi', text)).toBe('');
  expect(usableTopic('', text)).toBe('');
  expect(usableTopic(undefined, text)).toBe('');
});
