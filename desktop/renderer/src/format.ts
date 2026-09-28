import type { Activity, ArchivedClip, Pairing, Status } from './api';
import { el } from './dom';
import { coded, locale, t } from './i18n';

/* ---------- Progress messages ---------- */

/**
 * Progress messages come from the analysis in the main process (agent/ollama.ts). Older builds
 * wrote them in German, newer ones in English; both are recognized and shown in the window
 * language. Anything unknown is shown as is.
 */
const PROGRESS: [RegExp, string][] = [
  [/(?:Abschnitt|section|part|batch) (\d+) (?:von|of) (\d+)/i, 'progress.section'],
  [/(?:Modell wird geladen|downloading model|pulling model)\D*(\d+)\s*%/i, 'progress.download'],
  [/Aufnahme werden vorbereitet|preparing (?:the )?frames/i, 'progress.prepare'],
  [/Texterkennung liest|text recognition is reading/i, 'progress.texts'],
  [/Spracherkennung schreibt|speech recognition is transcribing/i, 'progress.speech'],
  [/zusammengefasst|summari[sz]ing|writing (?:the )?title, description/i, 'progress.summary'],
  [/Titel wird überarbeitet|revising the title/i, 'progress.revise'],
  [/translating (?:the )?title/i, 'progress.translate'],
  [/downloading ollama\D*(\d+)\s*%/i, 'progress.ollamaDownload'],
  [/installing ollama/i, 'progress.ollamaInstall'],
  [/starting ollama/i, 'progress.ollamaStart'],
];
export function localizeMessage(message: string) {
  for (const [pattern, key] of PROGRESS) {
    const match = pattern.exec(message || '');
    if (!match) continue;
    return key === 'progress.section'
      ? t(key, { current: match[1], total: match[2] })
      : key === 'progress.download' || key === 'progress.ollamaDownload'
        ? t(key, { percent: match[1] })
        : t(key);
  }
  return message;
}

/** The status message in the window language: by its code if it has one, else as above. */
export function statusMessage(s: Pick<Status, 'message' | 'code' | 'params'>) {
  return s.code ? coded(s.code, s.params, s.message) : localizeMessage(s.message);
}
/** The message of a pairing state in the window language. */
export function pairingMessage(p: Pairing) {
  return coded(p.text, p.params, p.message);
}

/* ---------- Display helpers ---------- */

/** "Valorant 2026.09.25 - 21.14.02.03.DVR.mp4" → "Sep 25, 2026 · 9:14 PM" */
export function clipName(file: string) {
  const m = /(\d{4})\.(\d{2})\.(\d{2}) - (\d{2})\.(\d{2})/.exec(file);
  if (!m) return file.replace(/\.[^.]+$/, '');
  const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return t('clip.when', {
    date: at.toLocaleDateString(locale(), { dateStyle: 'medium' }),
    time: at.toLocaleTimeString(locale(), { timeStyle: 'short' }),
  });
}
const SHORT: [RegExp, string][] = [
  [/rainbow six/i, 'R6'],
  [/valorant/i, 'VAL'],
  [/fortnite/i, 'FN'],
  [/call of duty/i, 'COD'],
  [/counter-?strike/i, 'CS'],
  [/minecraft/i, 'MC'],
  [/arc raiders/i, 'ARC'],
  [/^desktop$/i, 'PC'],
];
export function gameShort(game: string) {
  const known = SHORT.find(([pattern]) => pattern.test(game));
  if (known) return known[1];
  const words = game
    .replace(/tom clancy's/i, '')
    .split(/\s+/)
    .filter(Boolean);
  return (
    words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2)
  ).toUpperCase();
}
function gameHue(game: string) {
  let hash = 0;
  for (const c of game.toLowerCase()) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return 200 + (hash % 140);
}
export function gameName(game: string) {
  return game.replace(/^Tom Clancy's\s+/i, '').replace(/\s+/g, ' ');
}
export function badge(game: string) {
  const node = el('span', { className: 'game-badge', textContent: gameShort(game), title: game });
  node.style.setProperty('--hue', String(gameHue(game)));
  return node;
}
export function duration(seconds: number) {
  seconds = Math.max(0, Math.round(seconds));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}:${String(seconds % 60).padStart(2, '0')} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
export function ago(at: number) {
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return t('ago.now');
  if (minutes < 60) return t('ago.minutes', { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('ago.hours', { count: hours });
  const date = new Date(at);
  return date.toLocaleDateString(locale(), { day: '2-digit', month: '2-digit' });
}
export function megabytes(bytes: number) {
  return bytes >= 1e9
    ? `${(bytes / 1e9).toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} GB`
    : `${Math.round(bytes / 1e6)} MB`;
}
/** Median of the latest processing times, for the remaining time and the key figure. */
export function averageSeconds(recent: ArchivedClip[]) {
  const times = recent
    .slice(0, 10)
    .map((r) => r.seconds)
    .filter((s) => s > 0)
    .sort((a, b) => a - b);
  return times.length ? times[Math.floor(times.length / 2)] : 0;
}
export function fraction(active: Activity | null) {
  if (!active) return 0;
  if (active.step === 'prepare') return 0.04;
  if (active.step === 'view')
    return 0.05 + 0.8 * (active.total ? active.current / active.total : 0);
  if (active.step === 'summary') return 0.9;
  if (active.sent !== undefined && active.size) return 0.9 + 0.1 * (active.sent / active.size);
  return 0.97;
}
