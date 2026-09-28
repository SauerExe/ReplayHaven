import { run } from '../api';
import type { ClientConfig, PlayerName } from '../api';
import { $ } from '../dom';
import { t } from '../i18n';
import { nameRows } from '../names';
import type { NameRows } from '../names';
import { saved, state } from '../state';
import { renderConnection } from './connection';
import { applyLock, locked } from './lock';
import { flashSaved, saveConfig } from './save';

/* ---------- Settings: text field groups ---------- */

const input = (id: string) => $<HTMLInputElement>(id);
export let settingsNames: NameRows;

export function fillTokenPlaceholder() {
  input('token').placeholder = saved().hasToken ? t('token.saved') : t('token.new');
}
function epicList() {
  return input('epic-accounts')
    .value.split(/[\s,;]+/)
    .filter(Boolean);
}
const namesKey = (names: PlayerName[]) =>
  JSON.stringify(names.map(({ name, game }) => ({ name, game })));

type FormName = 'server' | 'token' | 'game' | 'epic' | 'names';
interface Form {
  fill: () => void;
  read: () => Partial<ClientConfig>;
  dirty: () => boolean;
}
/** The text field groups: fill from the saved config, read the changes, compare. */
export const FORMS: Record<FormName, Form> = {
  server: {
    fill: () => (input('server').value = saved().server),
    read: () => ({ server: input('server').value.trim() }),
    dirty: () => input('server').value.trim() !== saved().server,
  },
  token: {
    fill: () => {
      input('token').value = '';
      fillTokenPlaceholder();
    },
    read: () => ({ token: input('token').value }),
    dirty: () => input('token').value !== '',
  },
  game: {
    fill: () => (input('game').value = saved().game),
    read: () => ({ game: input('game').value.trim() }),
    dirty: () => input('game').value.trim() !== saved().game,
  },
  epic: {
    fill: () => (input('epic-accounts').value = saved().epicAccounts.join(', ')),
    read: () => ({ epicAccounts: epicList() }),
    dirty: () => epicList().join() !== saved().epicAccounts.join(),
  },
  names: {
    fill: () => {
      settingsNames = nameRows($('player-names'), saved().playerNames);
      applyLock();
    },
    read: () => ({ playerNames: settingsNames.read() }),
    dirty: () => namesKey(settingsNames.read()) !== namesKey(saved().playerNames),
  },
};
function formGroup(name: FormName) {
  return document.querySelector<HTMLElement>(`[data-form="${name}"]`)!;
}
/** Shows Save/Cancel only while the group differs from the saved values. */
export function refreshForm(name: FormName) {
  const group = formGroup(name);
  const dirty = !!state.config && FORMS[name].dirty();
  const foot = group.querySelector<HTMLElement>('.group-foot')!;
  group.querySelector<HTMLElement>('.foot-actions')!.hidden = !dirty;
  group.dataset.dirty = String(dirty);
  foot.hidden = !dirty && !foot.querySelector('.foot-note, .saved');
}
async function saveForm(name: FormName) {
  const group = formGroup(name);
  const button = group.querySelector<HTMLButtonElement>('[data-save]')!;
  button.disabled = true;
  try {
    await saveConfig(FORMS[name].read());
    FORMS[name].fill();
    if (name === 'server' || name === 'token') renderConnection();
    const foot = group.querySelector<HTMLElement>('.group-foot')!;
    foot.hidden = false;
    flashSaved(foot, () => refreshForm(name));
  } finally {
    button.disabled = locked;
    refreshForm(name);
  }
}
for (const group of document.querySelectorAll<HTMLElement>('[data-form]')) {
  const name = group.dataset.form as FormName;
  const update = () => queueMicrotask(() => state.config && refreshForm(name));
  group.addEventListener('input', update);
  group.addEventListener('click', update);
  group.querySelector<HTMLElement>('[data-save]')!.onclick = () => run(() => saveForm(name));
  group.querySelector<HTMLElement>('[data-cancel]')!.onclick = () => {
    FORMS[name].fill();
    refreshForm(name);
  };
  // Enter saves the group, Escape discards its changes.
  group.addEventListener('keydown', (event) => {
    if ((event.target as HTMLElement).tagName !== 'INPUT') return;
    if (event.key === 'Enter' && !locked && FORMS[name].dirty()) {
      event.preventDefault();
      void run(() => saveForm(name));
    } else if (event.key === 'Escape' && FORMS[name].dirty()) {
      FORMS[name].fill();
      refreshForm(name);
    }
  });
}
