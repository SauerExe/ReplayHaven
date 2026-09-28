import { $ } from '../dom';

/*
 * One section at a time (docs/SETTINGS-DESIGN.md). Switches, selects and the folder picker save
 * right away with the saved config plus the one change; text fields belong to a form group
 * (data-form) whose Save/Cancel appear as soon as a value differs from the saved one.
 */
const SECTIONS = ['connection', 'recordings', 'names', 'ai', 'recognition', 'behavior', 'language'];
let section = 'connection';
try {
  const remembered = localStorage.getItem('settings.section');
  if (remembered && SECTIONS.includes(remembered)) section = remembered;
} catch {
  /* Without storage the first section opens. */
}
function showSection(name: string, focus = false) {
  section = name;
  try {
    localStorage.setItem('settings.section', name);
  } catch {
    /* Only a convenience. */
  }
  for (const item of document.querySelectorAll<HTMLElement>('.set-nav-item')) {
    if (item.dataset.section === name) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }
  for (const page of document.querySelectorAll<HTMLElement>('.set-section'))
    page.hidden = page.dataset.section !== name;
  $('settings-scroll').scrollTop = 0;
  if (focus) $(`sec-${name}`).focus();
}
for (const item of document.querySelectorAll<HTMLElement>('.set-nav-item')) {
  item.onclick = () => showSection(item.dataset.section!, true);
  // Arrow keys move through the section list.
  item.onkeydown = (event) => {
    const step = ({ ArrowDown: 1, ArrowUp: -1 } as Record<string, number>)[event.key];
    if (!step) return;
    event.preventDefault();
    const items = [...document.querySelectorAll<HTMLElement>('.set-nav-item')];
    const next = items[(items.indexOf(item) + step + items.length) % items.length];
    next.focus();
    showSection(next.dataset.section!);
  };
}
showSection(section);
