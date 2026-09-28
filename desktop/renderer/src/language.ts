import { call, run } from './api';
import type { PublicConfig } from './api';
import { $ } from './dom';
import { applyLanguage, language, selectLanguage } from './i18n';
import { renderConnection } from './settings/connection';
import { describeFolder, fillFolder, fillTokenPlaceholder } from './settings';
import { state } from './state';
import { render } from './status';
import { renderWizard } from './wizard';

/* ---------- Language ---------- */

/** Switches the window language; everything visible is redrawn without a restart. */
export function setLanguage(lang: string) {
  selectLanguage(lang);
  document.documentElement.lang = language;
  $<HTMLSelectElement>('language').value = language;
  applyLanguage();
  if (state.config) {
    fillTokenPlaceholder();
    fillFolder();
    if (!$('settings').hidden) void describeFolder();
  }
  if (state.status) render(state.status);
  renderConnection();
  if (!$('wizard').hidden) renderWizard();
}
/** Saves only the language, which the main process allows even while the client is running. */
export async function saveLanguage(lang: string) {
  setLanguage(lang);
  if (!state.config) return;
  const values: Partial<PublicConfig> = { ...state.config, token: '', language };
  delete values.hasToken;
  state.config = await call('save', values);
}
$('language').onchange = () => run(() => saveLanguage($<HTMLSelectElement>('language').value));
