import { call, run } from './api';
import type { Activity, ArchivedClip, QueueEntry, Status } from './api';
import { $, el } from './dom';
import {
  ago,
  averageSeconds,
  badge,
  clipName,
  duration,
  fraction,
  gameName,
  gameShort,
  megabytes,
  statusMessage,
} from './format';
import { t } from './i18n';
import { state } from './state';
import { openWizard } from './wizard';

/* ---------- Overview ---------- */

type Mode = 'setup' | 'off' | 'gaming' | 'paused' | 'working' | 'running';
function mode(s: Status): Mode {
  if (!state.config?.onboarded) return 'setup';
  if (!s.running) return 'off';
  if (s.gaming) return 'gaming';
  if (s.paused) return 'paused';
  return s.active ? 'working' : 'running';
}
/** Pill, eyebrow, title and button label per mode, from the dictionary (mode.<mode>.<part>). */
function modeText(m: Mode) {
  const text = (part: string) => t(`mode.${m}.${part}`);
  return {
    pill: text('pill'),
    eyebrow: text('eyebrow'),
    title: text('title'),
    action: text('action'),
  };
}

export function renderOverview(s: Status) {
  $('update-notice').hidden = !s.update;
  $('update-text').textContent = s.update ? t('update.text', { version: s.update }) : '';
  const m = mode(s);
  const text = modeText(m);
  const pill = $('pill');
  pill.dataset.state = m === 'setup' ? 'off' : m;
  pill.lastElementChild!.textContent =
    m === 'gaming' ? t('pill.gaming', { game: gameName(s.gaming) }) : text.pill;
  $('hero-orb').dataset.state = m === 'setup' ? 'off' : m;
  $('hero-eyebrow').textContent = text.eyebrow;
  $('hero-title').textContent = text.title;
  $('hero-message').textContent =
    m === 'setup'
      ? t('hero.setup')
      : m === 'gaming'
        ? s.queue.length
          ? t('hero.gamingQueue', { game: gameName(s.gaming), count: s.queue.length })
          : t('hero.gamingNone', { game: gameName(s.gaming) })
        : statusMessage(s);
  const action = $<HTMLButtonElement>('primary-action');
  action.textContent = text.action;
  action.className = ['running', 'working', 'gaming'].includes(m)
    ? 'secondary large'
    : 'primary large';
  action.disabled = s.downloading;

  const open = s.queue.length + (s.active ? 1 : 0);
  const average = averageSeconds(s.recent);
  $('stat-queue').textContent = String(open);
  $('stat-queue-eta').textContent =
    s.gaming && open
      ? t('stat.afterGaming')
      : open
        ? average
          ? t('stat.eta', { time: duration(open * average) })
          : t('stat.open', { count: open })
        : t('stat.none');
  const midnight = new Date().setHours(0, 0, 0, 0);
  const today = s.recent.filter((r) => r.at >= midnight);
  $('stat-today').textContent = String(today.length);
  $('stat-today-note').textContent = today[0] ? t('stat.last', { ago: ago(today[0].at) }) : ' ';
  $('stat-total').textContent = String(s.uploaded);
  $('stat-average').textContent = average ? t('stat.average', { time: duration(average) }) : ' ';

  renderActive(s.active);
  // What waits because a game is running or the client is paused is told by the marker.
  const hold = s.gaming
    ? t('queue.afterGaming')
    : s.running && s.paused
      ? t('mode.paused.pill')
      : '';
  renderQueue(s.queue, average, !!s.active, hold);
  renderRecent(s.recent);
}

let activePath = '';
function renderActive(active: Activity | null) {
  $('now-empty').hidden = !!active;
  $('now-clip').hidden = !active;
  if (!active) {
    activePath = '';
    $('now-elapsed').textContent = '';
    return;
  }
  const thumb = $<HTMLImageElement>('now-thumb');
  if (active.path !== activePath) {
    activePath = active.path;
    thumb.hidden = true;
    $('now-thumb-fallback').textContent = gameShort(active.game);
  }
  if (active.thumbnail && thumb.src !== active.thumbnail) {
    thumb.src = active.thumbnail;
    thumb.hidden = false;
  }
  $('now-game').textContent = gameName(active.game);
  $('now-name').textContent = t('clip.from', { when: clipName(active.name) });
  $('now-name').title = active.name;
  const order = ['prepare', 'view', 'summary', 'upload'];
  const current = order.indexOf(active.step);
  for (const item of $('stepper').children as HTMLCollectionOf<HTMLElement>) {
    const index = order.indexOf(item.dataset.step!);
    item.dataset.state = index < current ? 'done' : index === current ? 'current' : 'todo';
  }
  const percent = Math.round(fraction(active) * 100);
  $('now-bar').style.width = `${percent}%`;
  $('now-bar').parentElement!.setAttribute('aria-valuenow', String(percent));
  $('now-detail').textContent =
    active.step === 'prepare'
      ? t('detail.prepare')
      : active.step === 'view'
        ? active.total
          ? t('detail.viewOf', { current: active.current, total: active.total })
          : t('detail.view')
        : active.step === 'summary'
          ? t('detail.summary')
          : t('detail.upload');
  tickElapsed();
}
function tickElapsed() {
  const active = state.status?.active;
  $('now-elapsed').textContent = active ? duration((Date.now() - active.since) / 1000) : '';
}
setInterval(tickElapsed, 1000);

/** Queue entry state → dictionary key and chip tone. */
const STATES: Record<QueueEntry['state'], [string, string]> = {
  waiting: ['state.waiting', ''],
  settling: ['state.settling', 'accent'],
  retry: ['state.retry', 'bad'],
  deferred: ['state.deferred', 'warn'],
};
function renderQueue(queue: QueueEntry[], average: number, busy: boolean, hold: string) {
  $('queue-count').textContent = String(queue.length);
  $('queue-empty').hidden = queue.length > 0;
  $('queue-list').replaceChildren(
    ...queue.slice(0, 100).map((entry, i) => {
      const [key, color] = STATES[entry.state] || STATES.waiting;
      const [label, tone] = hold && entry.state === 'waiting' ? [hold, 'warn'] : [t(key), color];
      const eta =
        average && !hold && entry.state === 'waiting'
          ? t('queue.eta', { time: duration((i + (busy ? 1 : 0)) * average) })
          : '';
      const chip = el('span', { className: 'chip', textContent: label });
      if (tone) chip.dataset.tone = tone;
      if (entry.note) chip.title = entry.note;
      return el(
        'li',
        { title: entry.note || entry.name },
        el('span', { className: 'position', textContent: String(i + 1) }),
        el(
          'span',
          { className: 'item-main' },
          el('span', {
            className: 'item-title',
            textContent: `${gameName(entry.game)} · ${clipName(entry.name)}`,
          }),
          el('span', { className: 'item-sub', textContent: `${megabytes(entry.size)}${eta}` }),
        ),
        el('span', { className: 'item-end' }, chip),
      );
    }),
  );
}
function renderRecent(recent: ArchivedClip[]) {
  $('recent-empty').hidden = recent.length > 0;
  $('recent-list').replaceChildren(
    ...recent.slice(0, 20).map((clip) => {
      const item = el(
        'li',
        { className: 'clickable', tabIndex: 0, title: t('recent.open') },
        badge(clip.game),
        el(
          'span',
          { className: 'item-main' },
          el('span', { className: 'item-title', textContent: clip.title || clipName(clip.name) }),
          el('span', {
            className: 'item-sub',
            textContent: `${gameName(clip.game)} · ${ago(clip.at)}`,
          }),
        ),
        el(
          'span',
          { className: 'item-end' },
          ...(clip.tags || [])
            .slice(0, 2)
            .map((tag) => el('span', { className: 'tag', textContent: tag })),
        ),
      );
      const open = () => run(() => call('open-clip', clip.clipId));
      item.onclick = open;
      item.onkeydown = (event) => event.key === 'Enter' && open();
      return item;
    }),
  );
}

$('primary-action').onclick = () =>
  run(async () => {
    const m = mode(state.status!);
    if (m === 'setup') return openWizard();
    if (['running', 'working', 'gaming'].includes(m)) return call('pause');
    await call('start');
  });
$('now-reveal').onclick = () => run(() => call('reveal', state.status!.active?.path));
$('archive').onclick = () => run(() => call('archive'));
$('recent-all').onclick = () => run(() => call('archive'));

// The installer for the server's newer release (desktop/update.ts).
$('update-download').onclick = () => run(() => call('download-update'));
