import { call } from '../api';
import type { ClientConfig, PublicConfig } from '../api';
import { el } from '../dom';
import { language, t } from '../i18n';
import { state } from '../state';

/** Saves the stored config with only the given changes; an empty token keeps the saved key. */
export async function saveConfig(changes: Partial<ClientConfig>) {
  const values: Partial<PublicConfig> = { ...state.config, token: '', language, ...changes };
  delete values.hasToken;
  state.config = await call('save', values);
  return state.config;
}
/** A short "Saved" next to the control that was saved; calls done when it disappears. */
export function flashSaved(host: HTMLElement, done?: () => void) {
  host.querySelector('.saved')?.remove();
  const note = el('span', { className: 'saved', textContent: t('result.saved') });
  note.setAttribute('role', 'status');
  // In a row it sits left of the control, in a group footer at the right end.
  if (host.classList.contains('group-foot')) host.append(note);
  else host.prepend(note);
  setTimeout(() => {
    note.remove();
    done?.();
  }, 2200);
}
export function controlOf(node: HTMLElement) {
  return node.closest<HTMLElement>('.row-control') || node.parentElement!;
}
