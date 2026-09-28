import type { Status } from '../api';
import { $ } from '../dom';
import { localizeMessage } from '../format';
import { t } from '../i18n';

/* ---------- Settings: what follows the status ---------- */

/** Whether the settings are locked because the client is working. */
export let locked = false;

/** Everything that changes the config waits while the client is working (except the language). */
export function applyLock() {
  for (const node of document.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
    '#settings [data-lock], #player-names input, #player-names button',
  ))
    node.disabled = locked;
}
export function renderSettingsLock(s: Status | null) {
  if (!s) return;
  const wasLocked = locked;
  locked = s.running && !s.paused;
  $('settings-lock').hidden = !locked;
  if (locked !== wasLocked) applyLock();
  $('model-state').textContent = s.model
    ? t('model.ready')
    : s.ollama
      ? t('model.missing')
      : t('model.unchecked');
  $('model-state').dataset.tone = s.model ? 'ok' : s.ollama ? 'warn' : '';
  $('ollama-state').hidden = !s.ollama;
  $('install-ollama').hidden = !!s.ollama || s.downloading;
  $('model-installed').hidden = !s.model;
  $('download-model').hidden = s.model || s.downloading;
  $('cancel-download').hidden = !s.downloading;
  const percent = s.downloading ? /(\d+)\s*%/.exec(s.message)?.[1] : undefined;
  $('model-progress').hidden = !s.downloading;
  $('download-text').textContent = s.downloading
    ? localizeMessage(s.message)
    : t('row.downloadText');
  if (percent) ($('model-progress').firstElementChild as HTMLElement).style.width = `${percent}%`;
}
