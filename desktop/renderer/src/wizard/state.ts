import type { FolderInfo, OllamaCheck, PublicConfig, Switch } from '../api';
import { el } from '../dom';
import { t } from '../i18n';
import type { NameRows } from '../names';

/* ---------- Setup wizard: shared state and building blocks ---------- */

/**
 * A wizard step. Name, eyebrow, title and lead come from the dictionary under w.<key>.*;
 * `next` and `skip` mark steps with their own button labels (w.<key>.next, w.<key>.skip).
 */
export interface Step {
  key: string;
  next?: boolean;
  skip?: boolean;
  render: () => HTMLElement;
  /** Throws with the message to show when the step is not complete yet. */
  validate?: () => void | Promise<void>;
  onSkip?: () => void;
  /** Redraws the open step when the status changes. */
  paint?: () => void;
}

/** The settings as the wizard edits them; saved only in the last step. */
export let draft: PublicConfig;
export function setDraft(values: PublicConfig) {
  draft = values;
}
export const wizard: {
  serverOk: boolean;
  useKey: boolean;
  /** Servers found in the home network; null while the search runs, undefined before. */
  found?: string[] | null;
  clips: number;
  games: FolderInfo['games'];
  ai: OllamaCheck | null;
  names: NameRows | null;
} = { serverOk: false, useKey: false, clips: 0, games: [], ai: null, names: null };

export function recommendedChip() {
  return el('span', {
    className: 'chip',
    textContent: t('recommended'),
    dataset: { tone: 'accent' },
  });
}
export function option(
  key: Switch,
  title: string,
  text: string,
  { recommended = false, checked }: { recommended?: boolean; checked?: boolean } = {},
) {
  const input = el('input', { type: 'checkbox', checked: checked ?? !!draft[key] });
  input.onchange = () => (draft[key] = input.checked);
  return el(
    'label',
    { className: 'option toggle' },
    input,
    el(
      'span',
      {},
      el('b', {}, title, recommended ? recommendedChip() : null),
      el('small', { textContent: text }),
    ),
  );
}
export function field(label: string, input: HTMLElement) {
  return el('label', { className: 'field' }, label, input);
}
export function checkLine(tone: string, text: string) {
  return el(
    'div',
    { className: 'check-line', dataset: { tone } },
    el('span', { className: 'dot' }),
    el('span', { textContent: text }),
  );
}
export function hasGame(pattern: RegExp) {
  return wizard.games.some((g) => pattern.test(g.game));
}
