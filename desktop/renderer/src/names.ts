import type { PlayerName } from './api';
import { $, el } from './dom';
import { applyLanguage } from './i18n';

/* ---------- Player names ---------- */

/** Editable name rows in a container, used by the settings and the setup wizard. */
export interface NameRows {
  /** Adds a row and returns its name field. */
  add: (entry?: PlayerName) => HTMLInputElement;
  /** The entered names; rows without a name are left out. */
  read: () => PlayerName[];
}

export function nameRows(container: HTMLElement, entries: PlayerName[]): NameRows {
  const add = (entry: PlayerName = { name: '', game: '' }) => {
    // The texts come from data-i18n-* so a language switch also reaches existing rows.
    const name = el('input', {
      className: 'player-name',
      maxLength: 60,
      value: entry.name,
      dataset: { i18nPlaceholder: 'names.placeholder', i18nAriaLabel: 'names.aria' },
    });
    const game = el('input', {
      className: 'player-game',
      maxLength: 100,
      value: entry.game,
      dataset: { i18nPlaceholder: 'names.gamePlaceholder', i18nAriaLabel: 'names.gameAria' },
    });
    game.setAttribute('list', 'game-suggestions');
    const remove = el('button', {
      type: 'button',
      className: 'secondary remove-name',
      textContent: '×',
      dataset: { i18nTitle: 'names.remove', i18nAriaLabel: 'names.remove' },
    });
    const row = el('div', { className: 'name-row' }, name, game, remove);
    applyLanguage(row);
    remove.onclick = () => {
      row.remove();
      if (!container.children.length) add();
    };
    container.append(row);
    return name;
  };
  container.replaceChildren();
  for (const entry of entries) add(entry);
  if (!entries.length) add();
  return {
    add,
    read: () =>
      [...container.querySelectorAll('.name-row')]
        .map((row) => ({
          name: row.querySelector<HTMLInputElement>('.player-name')!.value.trim(),
          game: row.querySelector<HTMLInputElement>('.player-game')!.value.trim(),
        }))
        .filter((entry) => entry.name),
  };
}
export function suggestGames(games: string[]) {
  $('game-suggestions').replaceChildren(...games.map((game) => el('option', { value: game })));
}
