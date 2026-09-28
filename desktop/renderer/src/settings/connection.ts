import { call, errorText, run } from '../api';
import type { Pairing } from '../api';
import { $ } from '../dom';
import { t } from '../i18n';
import { state } from '../state';
import { fillTokenPlaceholder, FORMS, refreshForm } from './forms';

/* ---------- Pairing in the settings ---------- */

/** The result of the last connection test; a new pairing state replaces it. */
let serverMessage: { text: string; tone: string } | null = null;
export function clearServerMessage() {
  serverMessage = null;
}

/** Status row of the connection: badge, message (pairing or test result) and the pair button. */
export function renderConnection() {
  const config = state.config;
  if (!config) return;
  const pairing = state.status?.pairing;
  const waiting = pairing?.state === 'waiting';
  const [key, tone] = waiting
    ? ['conn.waiting', 'accent']
    : config.hasToken
      ? ['conn.paired', 'ok']
      : ['conn.none', 'warn'];
  $('conn-state').textContent = t(key);
  $('conn-state').dataset.tone = tone;
  const message =
    serverMessage ||
    (pairing && {
      text: waiting
        ? t('pair.settings', { code: `${pairing.code.slice(0, 3)} ${pairing.code.slice(3)}` })
        : pairing.message,
      tone: pairing.state === 'approved' ? 'ok' : waiting ? '' : 'bad',
    });
  const result = $('server-result');
  result.textContent = message
    ? message.text
    : config.hasToken
      ? t('conn.pairedText')
      : t('conn.noneText');
  result.dataset.tone = message?.tone ?? '';
  $('pair-server').textContent = waiting ? t('btn.cancel') : t('btn.pair');
  $('open-devices').hidden = !waiting;
}
export function renderSettingsPairing(pairing: Pairing | null) {
  // A new pairing state replaces an older test result.
  if (pairing) serverMessage = null;
  if (pairing?.state === 'approved' && state.config) {
    state.config.server = pairing.server;
    state.config.hasToken = true;
    FORMS.server.fill();
    refreshForm('server');
    fillTokenPlaceholder();
  }
  renderConnection();
}

$('test-server').onclick = () =>
  run(async () => {
    serverMessage = { text: t('result.checking'), tone: '' };
    renderConnection();
    try {
      const result = await call('test-server', {
        server: $<HTMLInputElement>('server').value.trim(),
        token: $<HTMLInputElement>('token').value,
      });
      serverMessage = {
        text: t('result.connected', { clips: t('count.clips', { count: result.clips }) }),
        tone: 'ok',
      };
    } catch (e) {
      serverMessage = { text: errorText(e), tone: 'bad' };
    }
    renderConnection();
  });
$('pair-server').onclick = () =>
  run(() =>
    state.status?.pairing?.state === 'waiting'
      ? call('pair-cancel')
      : call('pair-start', $<HTMLInputElement>('server').value.trim()),
  );
$('open-devices').onclick = () => run(() => call('open-devices'));
