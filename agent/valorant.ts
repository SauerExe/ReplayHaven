import { seriesOf } from './events';
import type { GameEvent } from './events';
import type { Box, TextLine } from './ocr';
import { sameGame } from './players';

/**
 * Kills and deaths in Valorant from the killfeed at the top right, via text recognition
 * (agent/ocr.ts). A line reads "killer [weapon] [headshot] victim". If one of the player's own
 * names is on the left, it is an own kill; on the right, the player's own death. PaddleOCR reads
 * the headshot icon as a single character like "小" just before the victim (measured on
 * 2026-09-24, VAL-B2).
 */

export function isValorant(game: string) {
  return sameGame('Valorant', game);
}

/** Position of the killfeed as a fraction of the frame: right quarter, top third without the HUD bar. */
export const KILLFEED: Box = { x: 0.72, y: 0.06, w: 0.28, h: 0.3 };

/**
 * A killfeed entry names players with at least three characters, as Valorant requires.
 * Recognition reads icons as one or two characters: PP-OCRv4 reads the headshot icon as "小",
 * the Latin PP-OCRv5 as "2" or "as".
 */
function isName(line: TextLine) {
  return line.score >= 0.8 && line.text.replace(/[^\p{L}\p{N}]/gu, '').length >= 3;
}

/** Lower case without spaces; typical recognition mix-ups become equal. */
function plain(name: string) {
  // Only letters and digits: recognition likes to append punctuation ("leavingtonight)").
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

/** Whether a read name is one of the player's own; from five characters on, one misread is forgiven. */
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

/** Groups the read pieces of a killfeed region into lines "killer → victim". */
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
    // The headshot icon sits between killer and victim, right before the victim.
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

/** How long an entry stays in the Valorant killfeed; after that, the same pair is a new entry. */
const ENTRY_SECONDS = 8;

/**
 * Own kills, headshots and deaths from a clip's killfeed readings. An entry counts once while it
 * stays visible; its time is the first frame showing it, `from` the frame before.
 */
export function feedEvents(frames: FeedFrame[], names: readonly string[]): GameEvent[] {
  if (!names.length) return [];
  const own = (name: string) => names.some((n) => sameName(name, n));
  const found: GameEvent[] = [];
  const last = new Map<string, { seconds: number; event: GameEvent }>();
  const withHeadshot = new Set<GameEvent>();
  // The icon is missing in some frames; once read, it applies to the whole entry.
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
