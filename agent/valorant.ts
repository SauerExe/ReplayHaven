import { seriesOf } from './events';
import type { GameEvent } from './events';
import type { Box, TextLine } from './ocr';
import { sameGame } from './players';

/**
 * Kills und Tode in Valorant aus dem Killfeed oben rechts, per Texterkennung (agent/ocr.ts).
 * Eine Zeile lautet "Täter [Waffe] [Kopfschuss] Opfer". Steht ein eigener Name links, ist es ein
 * eigener Kill, steht er rechts, der eigene Tod. Das Kopfschuss-Symbol liest PaddleOCR als
 * einzelnes Zeichen wie "小" kurz vor dem Opfer (gemessen am 2026-09-24, VAL-B2).
 */

export function isValorant(game: string) {
  return sameGame('Valorant', game);
}

/** Lage des Killfeeds als Anteil des Bildes: rechtes Viertel, oberes Drittel ohne Anzeigeleiste. */
export const KILLFEED: Box = { x: 0.72, y: 0.06, w: 0.28, h: 0.3 };

/**
 * Ein Killfeed-Eintrag nennt Namen mit mindestens drei Zeichen, wie Valorant sie verlangt.
 * Symbole liest die Erkennung als ein, zwei Zeichen: PP-OCRv4 das Kopfschuss-Symbol als "小",
 * das lateinische PP-OCRv5 als "2" oder "as".
 */
function isName(line: TextLine) {
  return line.score >= 0.8 && line.text.replace(/[^\p{L}\p{N}]/gu, '').length >= 3;
}

/** Kleinbuchstaben ohne Leerzeichen; typische Verwechslungen der Erkennung werden gleich. */
function plain(name: string) {
  // Nur Buchstaben und Ziffern: die Erkennung hängt gern Satzzeichen an ("leavingtonight)").
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .replace(/0/g, 'o')
    .replace(/[1il]/g, 'l');
}

function distance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const here = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = here;
    }
  }
  return row[b.length];
}

/** Ob ein gelesener Name einer der eigenen ist; ab fünf Zeichen verzeiht er einen Lesefehler. */
export function sameName(read: string, own: string) {
  const a = plain(read);
  const b = plain(own);
  if (!a || !b) return false;
  return a === b || (b.length >= 5 && distance(a, b) <= 1);
}

export interface FeedLine {
  killer: string;
  victim: string;
  headshot: boolean;
}

/** Ordnet die gelesenen Stücke eines Killfeed-Ausschnitts zu Zeilen "Täter → Opfer". */
export function feedLines(lines: TextLine[]): FeedLine[] {
  const rows: TextLine[][] = [];
  for (const line of [...lines].sort((a, b) => a.box.y - b.box.y)) {
    const middle = line.box.y + line.box.h / 2;
    const row = rows.find((r) =>
      r.some((o) => Math.abs(o.box.y + o.box.h / 2 - middle) < Math.max(o.box.h, line.box.h) / 2),
    );
    if (row) row.push(line);
    else rows.push([line]);
  }
  const out: FeedLine[] = [];
  for (const row of rows) {
    const parts = row.sort((a, b) => a.box.x - b.box.x);
    const names = parts.filter(isName);
    if (names.length !== 2) continue;
    const [killer, victim] = names;
    // Das Kopfschuss-Symbol steht zwischen Täter und Opfer, dicht vor dem Opfer.
    const headshot = parts.some(
      (p) =>
        !isName(p) &&
        p.box.x > killer.box.x + killer.box.w &&
        p.box.x < victim.box.x &&
        victim.box.x - (p.box.x + p.box.w) < victim.box.h * 1.5,
    );
    out.push({ killer: killer.text.trim(), victim: victim.text.trim(), headshot });
  }
  return out;
}

export interface FeedFrame {
  seconds: number;
  lines: TextLine[];
}

/** So lange steht ein Eintrag im Valorant-Killfeed; danach ist dasselbe Paar ein neuer. */
const ENTRY_SECONDS = 8;

/**
 * Eigene Kills, Kopfschüsse und Tode aus den Killfeed-Lesungen eines Clips. Ein Eintrag zählt
 * einmal, solange er stehen bleibt; seine Zeit ist das erste Bild, auf dem er steht, `from`
 * das Bild davor.
 */
export function feedEvents(frames: FeedFrame[], names: readonly string[]): GameEvent[] {
  if (!names.length) return [];
  const own = (name: string) => names.some((n) => sameName(name, n));
  const found: GameEvent[] = [];
  const last = new Map<string, { seconds: number; event: GameEvent }>();
  const withHeadshot = new Set<GameEvent>();
  // Das Symbol fehlt in manchen Bildern; einmal gelesen, gilt es für den ganzen Eintrag.
  const markHeadshot = (kill: GameEvent) => {
    if (withHeadshot.has(kill)) return;
    withHeadshot.add(kill);
    found.push({ ...kill, kind: 'headshot' });
  };
  const ordered = [...frames].sort((a, b) => a.seconds - b.seconds);
  ordered.forEach((frame, index) => {
    for (const line of feedLines(frame.lines)) {
      const kill = own(line.killer) && !own(line.victim);
      const death = own(line.victim) && !own(line.killer);
      if (!kill && !death) continue;
      const other = kill ? line.victim : line.killer;
      const key = `${kill ? 'kill' : 'death'}:${plain(other)}`;
      const seen = last.get(key);
      if (seen && frame.seconds - seen.seconds <= ENTRY_SECONDS) {
        seen.seconds = frame.seconds;
        if (kill && line.headshot) markHeadshot(seen.event);
        continue;
      }
      const event: GameEvent = {
        kind: kill ? 'kill' : 'death',
        seconds: frame.seconds,
        from: ordered[index - 1]?.seconds ?? 0,
        text: `${line.killer} → ${line.victim}`,
        source: 'ocr',
        other,
      };
      found.push(event);
      last.set(key, { seconds: frame.seconds, event });
      if (kill && line.headshot) markHeadshot(event);
    }
  });
  const series = seriesOf(found, 'ocr');
  return [...found, ...(series ? [series] : [])].sort((a, b) => a.seconds! - b.seconds!);
}
