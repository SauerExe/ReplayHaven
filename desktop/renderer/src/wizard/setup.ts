import { call, errorText, MODELS, run } from '../api';
import type { Model } from '../api';
import { el } from '../dom';
import { gameName, localizeMessage } from '../format';
import { t } from '../i18n';
import { nameRows, suggestGames } from '../names';
import { state } from '../state';
import { checkLine, draft, field, recommendedChip, syncNext, wizard } from './state';
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

/** Ollama answers and has the chosen model. */
const aiReady = () => !!wizard.ai?.running && !!wizard.ai.installed;

export const aiStep: Step = {
  key: 'ai',
  render: () => {
    const box = el('div', { className: 'wizard-content' });
    const recheck = async () => {
      wizard.ai = await call('check', draft.model).catch(() => ({
        running: false,
        installed: false,
      }));
      aiStep.paint?.();
    };
    let cancelled = false;
    // One click: install Ollama if needed, then download the chosen model.
    const setUp = async () => {
      cancelled = false;
      wizard.aiFailed = '';
      try {
        if (!wizard.ai?.running) {
          wizard.aiBusy = 'ollama';
          aiStep.paint?.();
          await call('ollama-install');
          await recheck();
          if (!wizard.ai?.running && !cancelled) throw new Error(t('w.ai.noStart'));
        }
        if (!wizard.ai?.installed && !cancelled) {
          wizard.aiBusy = 'model';
          aiStep.paint?.();
          await call('download', draft.model);
        }
      } catch (e) {
        if (!cancelled) wizard.aiFailed = errorText(e);
      } finally {
        // "Checking" until the answer is in, never a stale "not set up yet".
        wizard.aiBusy = undefined;
        wizard.ai = null;
        await recheck();
      }
    };
    const choose = (choice: 'none' | 'local') => {
      wizard.aiChoice = choice;
      if (choice === 'local' && !wizard.ai) void recheck();
      aiStep.paint?.();
    };

    // The two choices are built once, so the keyboard focus stays on them while the rest repaints.
    const card = (choice: 'none' | 'local', title: string, text: string, extra?: HTMLElement) => {
      const input = el('input', { type: 'radio', name: 'ai-choice', value: choice });
      input.onchange = () => input.checked && choose(choice);
      const chip = recommendedChip();
      const label = el(
        'label',
        { className: 'option choice' },
        input,
        el('span', {}, el('b', {}, title, chip), el('small', { textContent: text }), extra),
      );
      return { label, input, chip };
    };
    const gpuLine = el('small', { className: 'choice-gpu' });
    const none = card('none', t('w.ai.none'), t('w.ai.noneText'));
    const local = card('local', t('w.ai.local'), t('w.ai.localText'), gpuLine);
    const choices = el(
      'div',
      { className: 'option-grid', role: 'radiogroup', ariaLabel: t('w.ai.name') },
      none.label,
      local.label,
    );

    const model = el(
      'select',
      {},
      ...MODELS.map((id) =>
        el('option', { value: id, textContent: t(id.endsWith('4b') ? 'model.4b' : 'model.9b') }),
      ),
    );
    model.onchange = () => {
      draft.model = model.value as Model;
      wizard.ai = null;
      void recheck();
    };
    const localPart = el(
      'div',
      { className: 'wizard-content' },
      field(t('field.model'), model),
      box,
    );

    const paintChoices = () => {
      const advice = wizard.advice;
      const suggested = advice ? (advice.model ? 'local' : 'none') : undefined;
      none.chip.hidden = suggested !== 'none';
      local.chip.hidden = suggested !== 'local';
      none.input.checked = wizard.aiChoice === 'none';
      local.input.checked = wizard.aiChoice === 'local';
      const gpu = advice?.gpu;
      gpuLine.textContent = !advice
        ? t('w.ai.detecting')
        : !gpu
          ? t('w.ai.noGpu')
          : t(advice.model ? 'w.ai.gpu' : 'w.ai.gpuSmall', {
              name: gpu.name,
              memory: gpu.memoryGb,
            });
      gpuLine.dataset.tone = advice?.model ? 'ok' : '';
      model.value = draft.model;
      model.disabled = !!wizard.aiBusy || !!state.status?.downloading;
      localPart.hidden = wizard.aiChoice !== 'local';
    };

    const paint = () => {
      paintChoices();
      syncNext(aiStep);
      if (wizard.aiChoice !== 'local') return box.replaceChildren();
      const s = state.status!;
      const button = (className: string, text: string, onclick: () => unknown) => {
        const b = el('button', { type: 'button', className, textContent: text });
        b.onclick = () => void onclick();
        return b;
      };
      if (wizard.aiBusy || s.downloading) {
        // Neutral while it works: what happens now, and how far it got.
        const percent = s.downloading ? /(\d+)\s*%/.exec(s.message)?.[1] : undefined;
        const known = s.downloading ? localizeMessage(s.message) : '';
        const text =
          known && known !== s.message
            ? known
            : t(wizard.aiBusy === 'ollama' ? 'w.ai.busyOllama' : 'w.ai.busyModel');
        const bar = el('div', {
          className: `progress${percent ? '' : ' indeterminate'}`,
          role: 'progressbar',
          ariaLabel: text,
          ...(percent ? { ariaValueNow: percent, ariaValueMin: '0', ariaValueMax: '100' } : {}),
        });
        const fill = el('span');
        if (percent) fill.style.width = `${percent}%`;
        bar.append(fill);
        return box.replaceChildren(
          checkLine('busy', text),
          bar,
          el('small', { textContent: t('w.ai.busyNote') }),
          el(
            'div',
            { className: 'row' },
            button('secondary', t('btn.cancel'), () => {
              cancelled = true;
              return run(() => call('cancel-download'));
            }),
          ),
        );
      }
      if (wizard.aiFailed)
        return box.replaceChildren(
          checkLine('bad', t('w.ai.failed')),
          el('small', { textContent: t('w.ai.failedNote', { detail: wizard.aiFailed }) }),
          el(
            'div',
            { className: 'row' },
            button('primary', t('w.ai.retry'), setUp),
            button('secondary', t('w.ai.withoutAi'), () => {
              wizard.aiFailed = '';
              choose('none');
            }),
          ),
        );
      if (!wizard.ai) return box.replaceChildren(checkLine('busy', t('w.ai.checking')));
      if (aiReady()) return box.replaceChildren(checkLine('ok', t('w.ai.ready')));
      return box.replaceChildren(
        el('small', {
          textContent: t(wizard.ai.running ? 'w.ai.onlyModel' : 'w.ai.whatHappens'),
        }),
        el(
          'div',
          { className: 'row' },
          button('primary', t('w.ai.setUp'), setUp),
          button('ghost', t('w.ai.again'), () => {
            wizard.ai = null;
            aiStep.paint?.();
            return recheck();
          }),
        ),
        el('small', { textContent: t('w.ai.hint') }),
      );
    };
    aiStep.paint = paint;

    if (!wizard.advice)
      void call('gpu')
        .catch(() => ({ gpu: null, model: null }))
        .then((advice) => {
          wizard.advice = advice;
          // Suggest only on the first setup and only until the user chose personally.
          if (!wizard.aiChoice) {
            wizard.aiChoice = advice.model ? 'local' : 'none';
            if (advice.model) draft.model = advice.model;
          }
          if (wizard.aiChoice === 'local' && !wizard.ai) void recheck();
          aiStep.paint?.();
        });
    else if (!wizard.aiChoice) wizard.aiChoice = wizard.advice.model ? 'local' : 'none';
    if (wizard.aiChoice === 'local') void recheck();
    paint();
    return el('div', { className: 'wizard-content' }, choices, localPart);
  },
  blocked: () =>
    !wizard.aiChoice || (wizard.aiChoice === 'local' && (!aiReady() || !!wizard.aiBusy)),
  validate: () => {
    if (wizard.aiChoice === 'local' && !aiReady()) throw new Error(t('w.ai.hint'));
    draft.analyze = wizard.aiChoice === 'local';
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
