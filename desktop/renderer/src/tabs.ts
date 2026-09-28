import { $ } from './dom';
import { fillSettings } from './settings';

/* ---------- Tabs ---------- */

export function showView(view: string) {
  for (const tab of document.querySelectorAll<HTMLElement>('.tab'))
    tab.setAttribute('aria-selected', String(tab.dataset.view === view));
  $('overview').hidden = view !== 'overview';
  $('settings').hidden = view !== 'settings';
  if (view === 'settings') fillSettings();
}
for (const tab of document.querySelectorAll<HTMLElement>('.tab'))
  tab.onclick = () => showView(tab.dataset.view!);
