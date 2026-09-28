import { call, run } from '../api';
import type { FolderInfo, Language, Model, Switch } from '../api';
import { $ } from '../dom';
import { gameName } from '../format';
import { language, t } from '../i18n';
import { suggestGames } from '../names';
import { saved, state } from '../state';
import { openWizard } from '../wizard';
import { clearServerMessage, renderConnection } from './connection';
import { FORMS, refreshForm, settingsNames } from './forms';
import { locked, renderSettingsLock } from './lock';
import { controlOf, flashSaved, saveConfig } from './save';
import './sections';

/* ---------- Settings ---------- */

export { fillTokenPlaceholder } from './forms';

const select = (id: string) => $<HTMLSelectElement>(id);
const CHECKS: Record<string, Switch> = {
  analyze: 'analyze',
  'r6-texts': 'r6Texts',
  speech: 'speech',
  'fortnite-replays': 'fortniteReplays',
  'keep-r6-replays': 'keepR6Replays',
  'pause-while-gaming': 'pauseWhileGaming',
  'auto-start': 'autoStart',
  'open-at-login': 'openAtLogin',
  notify: 'notify',
  'include-existing': 'includeExisting',
};

function setSwitch(button: HTMLElement, on: boolean) {
  button.setAttribute('aria-checked', String(!!on));
}
for (const [id, key] of Object.entries(CHECKS)) {
  const button = $<HTMLButtonElement>(id);
  button.onclick = () =>
    run(async () => {
      const on = button.getAttribute('aria-checked') !== 'true';
      setSwitch(button, on);
      button.disabled = true;
      try {
        await saveConfig({ [key]: on });
        if (key === 'openAtLogin') await call('open-at-login', on);
        flashSaved(controlOf(button));
      } catch (e) {
        setSwitch(button, !on);
        throw e;
      } finally {
        button.disabled = locked;
        if (!locked) button.focus();
      }
    });
}
select('frames').onchange = () =>
  run(async () => {
    const frames = Number(select('frames').value) as 24 | 48 | 0;
    try {
      await saveConfig({ frames });
      flashSaved(controlOf(select('frames')));
    } catch (e) {
      select('frames').value = String(saved().frames);
      throw e;
    }
  });
select('title-language').onchange = () =>
  run(async () => {
    try {
      await saveConfig({ titleLanguage: select('title-language').value as Language });
      flashSaved(controlOf(select('title-language')));
    } catch (e) {
      select('title-language').value = saved().titleLanguage;
      throw e;
    }
  });
select('model').onchange = () =>
  run(async () => {
    try {
      await saveConfig({ model: select('model').value as Model });
      flashSaved(controlOf(select('model')));
    } catch (e) {
      select('model').value = saved().model;
      throw e;
    }
    // Whether the newly chosen model is already downloaded.
    await call('check', saved().model);
  });

export function fillFolder() {
  $('folder').textContent = saved().folder || t('folder.none');
  $('folder').title = saved().folder;
}
export function fillSettings() {
  const config = state.config;
  if (!config) return;
  for (const [name, form] of Object.entries(FORMS)) {
    form.fill();
    refreshForm(name as keyof typeof FORMS);
  }
  fillFolder();
  select('frames').value = String(config.frames);
  select('title-language').value = config.titleLanguage;
  select('model').value = config.model;
  select('language').value = language;
  for (const [id, key] of Object.entries(CHECKS)) setSwitch($(id), config[key]);
  clearServerMessage();
  renderConnection();
  void describeFolder();
  renderSettingsLock(state.status);
}
export async function describeFolder() {
  const info: FolderInfo = await call('folder-info').catch(() => ({ clips: 0, games: [] }));
  $('folder-info').textContent = info.clips
    ? t('folder.info', {
        clips: t('count.clips', { count: info.clips }),
        games: t('count.games', { count: info.games.length }),
        list: `${info.games
          .slice(0, 5)
          .map((g) => gameName(g.game))
          .join(', ')}${info.games.length > 5 ? ' …' : ''}`,
      })
    : state.config?.folder
      ? t('folder.empty')
      : '';
  suggestGames(info.games.map((g) => g.game));
  return info;
}
$('settings-pause').onclick = () => run(() => call('pause'));
$('pick-folder').onclick = () =>
  run(async () => {
    const folder = await call('folder');
    if (!folder) return;
    await saveConfig({ folder });
    fillFolder();
    flashSaved(controlOf($('pick-folder')));
    await describeFolder();
  });
$('add-name').onclick = () => settingsNames.add().focus();
$('check-model').onclick = () => run(() => call('check', saved().model));
$('install-ollama').onclick = () => run(() => call('ollama-install'));
$('download-model').onclick = () => run(() => call('download', saved().model));
$('cancel-download').onclick = () => run(() => call('cancel-download'));
$('rerun-setup').onclick = () => openWizard();
