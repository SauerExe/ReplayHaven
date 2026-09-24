import type { AnalysisResult } from '../domain/models';

export const DAY_MS = 86_400_000;

export type Confidence = AnalysisResult['confidence'];

/** Spieldauer als m:ss, ab einer Stunde als h:mm:ss. */
export function formatDuration(totalSeconds: number): string {
  const whole = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = String(whole % 60).padStart(2, '0');
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}

/** Restzeit aufgerundet, damit kurz vor Schluss nicht „noch 0:00“ dasteht. */
export function formatRemaining(seconds: number, duration: number): string {
  return `noch ${formatDuration(Math.ceil(Math.max(0, duration - seconds)))}`;
}

function startOfDay(time: number) {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Kalendertage statt 24-Stunden-Blöcken: um 0:30 ist ein Clip von 23:50 schon „Gestern“. */
export function calendarDaysAgo(time: number, now: number): number {
  return Math.round((startOfDay(now) - startOfDay(time)) / DAY_MS);
}

const clock = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const dayMonth = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' });
const dayMonthYear = new Intl.DateTimeFormat('de-DE', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** „Heute, 21:14“, „Gestern“, „Vor 3 Tagen“, danach das Datum. */
export function formatWhen(iso: string, now: number, withTime = true): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '';
  const days = calendarDaysAgo(time, now);
  if (days === 0) return withTime ? `Heute, ${clock.format(time)}` : 'Heute';
  if (days === 1) return 'Gestern';
  if (days > 1 && days < 7) return `Vor ${days} Tagen`;
  return new Date(time).getFullYear() === new Date(now).getFullYear()
    ? dayMonth.format(time)
    : dayMonthYear.format(time);
}

/** „Neu“ gilt 24 Stunden ab der Aufnahme, genau auf der Grenze nicht mehr. */
export function isNew(iso: string, now: number): boolean {
  const time = Date.parse(iso);
  return Number.isFinite(time) && now - time < DAY_MS;
}

const decimal = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function formatSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '';
  return size >= 1073741824
    ? `${decimal.format(size / 1073741824)} GB`
    : `${decimal.format(size / 1048576)} MB`;
}

/** Große Titel in Versalien: lange werden kleiner gesetzt, statt nach drei Zeilen abzuschneiden. */
export function titleSize(title: string): 'short' | 'long' | 'xlong' {
  return title.length > 32 ? 'xlong' : title.length > 18 ? 'long' : 'short';
}

export function countLabel(count: number): string {
  return `${count} ${count === 1 ? 'Clip' : 'Clips'}`;
}

/** „aktualisiert heute“, „aktualisiert vor 3 Tagen“, „aktualisiert am 21. Sept.“ */
export function formatUpdated(iso: string, now: number): string {
  const when = formatWhen(iso, now, false);
  if (!when) return '';
  return /^(Heute|Gestern|Vor )/.test(when)
    ? `aktualisiert ${when[0].toLocaleLowerCase('de')}${when.slice(1)}`
    : `aktualisiert am ${when}`;
}

/** Gesamtlänge mehrerer Clips: „45 Sek.“, „12 Min.“, „1 Std. 5 Min.“. */
export function formatTotal(totalSeconds: number): string {
  const whole = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.round(totalSeconds) : 0;
  if (whole < 60) return `${whole} Sek.`;
  const minutes = Math.round(whole / 60);
  if (minutes < 60) return `${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} Std. ${rest} Min.` : `${hours} Std.`;
}

export const confidenceLabel: Record<Confidence, string> = {
  high: 'hoch',
  medium: 'mittel',
  low: 'niedrig',
};

/** Wer analysiert hat: der Windows-Client auf dem Gaming-PC, die KI des Servers oder Gemini. */
export function providerLabel(provider: string): string {
  if (provider === 'client') return 'Auf deinem Gaming-PC';
  if (provider === 'local') return 'KI auf dem Server';
  if (provider === 'gemini') return 'Gemini (Google)';
  return provider;
}
