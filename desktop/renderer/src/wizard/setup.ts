import { call, MODELS, run } from '../api';
import type { Model } from '../api';
import { el } from '../dom';
import { gameName, localizeMessage } from '../format';
import { t } from '../i18n';
import { nameRows, suggestGames } from '../names';
import { state } from '../state';
import { checkLine, draft, wizard } from './state';
import type { Step } from './state';

/* ---------- Setup wizard: recordings, local AI and player names ---------- */

export const recordingsStep: Step = {
  key: 'rec',
  render: () => {
    const folder = el('input', {
      readOnly: true,
      value: draft.folder,
      placeholder: t('w.rec.placeholder'),
    });
    const pick = el('button', {
      type: 'button',
      className: 'secondary',
      textContent: t('w.rec.pick'),
    });
    const info = el('div', { className: 'wizard-content' });
    const existing = el('input', { type: 'checkbox', checked: draft.includeExisting });
    existing.onchange = () => (draft.includeExisting = existing.checked);
    const existingLabel = el('small');
    const describe = async () => {
      const result = await call('folder-info');
      wizard.clips = result.clips;
      wizard.games = result.games;
      suggestGames(result.games.map((g) => g.game));
      existingLabel.textContent = t('w.rec.existingNote', { count: result.clips });
      info.replaceChildren(
        checkLine(
          result.clips ? 'ok' : 'warn',
          result.clips
            ? t('w.rec.found', {
                clips: t('count.clips', { count: result.clips }),
                games: t('count.games', { count: result.games.length }),
              })
            : t('w.rec.none'),
        ),
        el(
          'div',
          { className: 'game-chips' },
          ...result.games
            .slice(0, 10)
            .map((g) =>
              el('span', { className: 'chip', textContent: `${gameName(g.game)} · ${g.clips}` }),
            ),
        ),
      );
    };
    pick.onclick = () =>
      run(async () => {
        const chosen = await call('folder');
        if (!chosen) return;
        draft.folder = chosen;
        folder.value = chosen;
        await describe();
      });
    if (draft.folder) void describe();
    return el(
      'div',
      { className: 'wizard-content' },
      el('div', { className: 'input-row' }, folder, pick),
      info,
      el(
        'label',
        { className: 'option toggle' },
        existing,
        el('span', {}, el('b', { textContent: t('w.rec.existing') }), existingLabel),
      ),
    );
  },
  validate: () => {
    if (!draft.folder) throw new Error(t('w.rec.error'));
  },
};

export const aiStep: Step = {
  key: 'ai',
  render: () => {
    const box = el('div', { className: 'wizard-content' });
    const paint = () => {
      const s = state.status!;
      const ai = wizard.ai;
      const lines: HTMLElement[] = [];
      if (!ai) lines.push(checkLine('', t('w.ai.checking')));
      else {
        lines.push(
          checkLine(
            ai.running ? 'ok' : 'bad',
            ai.running ? t('w.ai.running') : t('w.ai.notRunning'),
          ),
        );
        if (ai.running)
          lines.push(
            checkLine(
              ai.installed ? 'ok' : s.downloading ? '' : 'warn',
              ai.installed
                ? t('w.ai.ready')
                : s.downloading
                  ? localizeMessage(s.message)
                  : t('w.ai.missing'),
            ),
          );
      }
      const buttons: HTMLElement[] = [];
      if (ai && !ai.running && !s.downloading) {
        const install = el('button', {
          type: 'button',
          className: 'primary',
          textContent: t('w.ai.downloadOllama'),
        });
        // One click: install Ollama, then download the chosen model right away.
        install.onclick = () =>
          run(async () => {
            await call('ollama-install');
            await recheck();
            if (wizard.ai?.running && !wizard.ai.installed) {
              await call('download', draft.model);
              await recheck();
            }
          });
        buttons.push(install);
      }
      if (ai && ai.running && !ai.installed && !s.downloading) {
        const download = el('button', {
          type: 'button',
          className: 'primary',
          textContent: t('btn.downloadModel'),
        });
        download.onclick = () =>
          run(async () => {
            await call('download', draft.model);
            await recheck();
          });
        buttons.push(download);
      }
      if (s.downloading) {
        const cancel = el('button', {
          type: 'button',
          className: 'secondary',
          textContent: t('btn.cancel'),
        });
        cancel.onclick = () => run(() => call('cancel-download'));
        buttons.push(cancel);
      }
      const again = el('button', {
        type: 'button',
        className: 'ghost',
        textContent: t('w.ai.again'),
      });
      again.onclick = () => recheck();
      buttons.push(again);
      const percent = s.downloading ? /(\d+)\s*%/.exec(s.message)?.[1] : undefined;
      const bar = el('div', { className: 'progress' }, el('span'));
      if (percent) (bar.firstElementChild as HTMLElement).style.width = `${percent}%`;
      box.replaceChildren(
        ...lines,
        ...(s.downloading ? [bar] : []),
        el('div', { className: 'row' }, ...buttons),
      );
    };
    const recheck = async () => {
      wizard.ai = await call('check', draft.model).catch(() => ({
        running: false,
        installed: false,
      }));
      paint();
    };
    // Built once, outside the repainted part, so the choice keeps its focus.
    const model = el(
      'select',
      {},
      ...MODELS.map((id) =>
        el('option', { value: id, textContent: t(id.endsWith('4b') ? 'model.4b' : 'model.9b') }),
      ),
    );
    model.value = draft.model;
    model.onchange = () => {
      draft.model = model.value as Model;
      void recheck();
    };
    aiStep.paint = paint;
    paint();
    void recheck();
    return el('div', {}, el('label', { className: 'field' }, t('field.model'), model), box);
  },
  skip: true,
  onSkip: () => (draft.analyze = false),
  validate: () => {
    if (!wizard.ai?.installed) throw new Error(t('w.ai.error'));
    draft.analyze = true;
  },
};

export const namesStep: Step = {
  key: 'names',
  render: () => {
    const container = el('div', { className: 'name-rows' });
    const known = new Set(draft.playerNames.map((n) => n.game.toLowerCase()));
    const games = wizard.games
      .map((g) => g.game)
      .filter((g) => !/^(desktop|base profile)$/i.test(g) && !known.has(g.toLowerCase()))
      .slice(0, 5);
    const names = nameRows(container, [
      ...draft.playerNames,
      ...games.map((game) => ({ name: '', game })),
    ]);
    wizard.names = names;
    const add = el('button', {
      type: 'button',
      className: 'link',
      textContent: t('names.add'),
    });
    add.onclick = () => names.add().focus();
    return el('div', { className: 'wizard-content' }, container, el('div', {}, add));
  },
  validate: () => {
    draft.playerNames = wizard.names!.read();
  },
};
