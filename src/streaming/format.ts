import type { AnalysisResult } from '../domain/models';
import { perLanguage, t, tp } from '../i18n';

export const DAY_MS = 86_400_000;

export type Confidence = AnalysisResult['confidence'];

/** Playback length as m:ss, from one hour on as h:mm:ss. */
export function formatDuration(totalSeconds: number): string {
  const whole = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = String(whole % 60).padStart(2, '0');
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}

/** Remaining time rounded up, so it never reads "0:00 left" just before the end. */
export function formatRemaining(seconds: number, duration: number): string {
  return t('stream.format.remaining', {
    time: formatDuration(Math.ceil(Math.max(0, duration - seconds))),
  });
}

function startOfDay(time: number) {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Calendar days instead of 24-hour blocks: at 0:30 a clip from 23:50 is already "Yesterday". */
export function calendarDaysAgo(time: number, now: number): number {
  return Math.round((startOfDay(now) - startOfDay(time)) / DAY_MS);
}

// German writes 09:05, English 9:05 PM.
const clock = perLanguage(
  (tag) =>
    new Intl.DateTimeFormat(tag, {
      hour: tag.startsWith('de') ? '2-digit' : 'numeric',
      minute: '2-digit',
    }),
);
const dayMonth = perLanguage(
  (tag) => new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short' }),
);
const dayMonthYear = perLanguage(
  (tag) => new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short', year: 'numeric' }),
);

type Relative = { kind: 'today' | 'yesterday' | 'days'; days: number } | { kind: 'date' };

function relativeDay(time: number, now: number): Relative {
  const days = calendarDaysAgo(time, now);
  if (days === 0) return { kind: 'today', days };
  if (days === 1) return { kind: 'yesterday', days };
  if (days > 1 && days < 7) return { kind: 'days', days };
  return { kind: 'date' };
}

function formatDate(time: number, now: number) {
  return new Date(time).getFullYear() === new Date(now).getFullYear()
    ? dayMonth().format(time)
    : dayMonthYear().format(time);
}

/** "Today, 9:14 PM", "Yesterday", "3 days ago", then the date. */
export function formatWhen(iso: string, now: number, withTime = true): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '';
  const day = relativeDay(time, now);
  if (day.kind === 'today')
    return withTime
      ? t('stream.format.todayAt', { time: clock().format(time) })
      : t('stream.format.today');
  if (day.kind === 'yesterday') return t('stream.format.yesterday');
  if (day.kind === 'days') return tp('stream.format.daysAgo', day.days);
  return formatDate(time, now);
}

/** "New" lasts 24 hours from recording, and no longer exactly at the boundary. */
export function isNew(iso: string, now: number): boolean {
  const time = Date.parse(iso);
  return Number.isFinite(time) && now - time < DAY_MS;
}

const decimal = perLanguage(
  (tag) => new Intl.NumberFormat(tag, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
);

export function formatSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '';
  return size >= 1073741824
    ? `${decimal().format(size / 1073741824)} GB`
    : `${decimal().format(size / 1048576)} MB`;
}

/** Big titles in caps: long ones are set smaller instead of being cut off after three lines. */
export function titleSize(title: string): 'short' | 'long' | 'xlong' {
  return title.length > 32 ? 'xlong' : title.length > 18 ? 'long' : 'short';
}

export function countLabel(count: number): string {
  return tp('common.clips', count);
}

/** "updated today", "updated 3 days ago", "updated on Sep 21" */
export function formatUpdated(iso: string, now: number): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '';
  const day = relativeDay(time, now);
  if (day.kind === 'today') return t('stream.format.updatedToday');
  if (day.kind === 'yesterday') return t('stream.format.updatedYesterday');
  if (day.kind === 'days') return tp('stream.format.updatedDaysAgo', day.days);
  return t('stream.format.updatedOn', { date: formatDate(time, now) });
}

/** Total length of several clips: "45 sec", "12 min", "1 hr 5 min". */
export function formatTotal(totalSeconds: number): string {
  const whole = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.round(totalSeconds) : 0;
  if (whole < 60) return t('stream.format.seconds', { count: whole });
  const minutes = Math.round(whole / 60);
  if (minutes < 60) return t('stream.format.minutes', { count: minutes });
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest
    ? t('stream.format.hoursMinutes', { hours, minutes: rest })
    : t('stream.format.hours', { count: hours });
}

export function confidenceLabel(confidence: Confidence): string {
  return t(`stream.confidence.${confidence}`);
}

/** Who analyzed: the Windows client on the gaming PC, the server's AI or Gemini. */
export function providerLabel(provider: string): string {
  if (provider === 'client') return t('stream.provider.client');
  if (provider === 'local') return t('stream.provider.local');
  if (provider === 'gemini') return t('stream.provider.gemini');
  return provider;
}
