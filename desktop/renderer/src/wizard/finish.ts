import { call } from '../api';
import type { PublicConfig } from '../api';
import { el } from '../dom';
import { language, t } from '../i18n';
import { saved, state } from '../state';
import { draft, hasGame, option, recommendedChip, wizard } from './state';
import type { Step } from './state';

/* ---------- Setup wizard: detection and summary ---------- */

export const detectStep: Step = {
  key: 'detect',
  render: () => {
    const whole = el('input', { type: 'checkbox', checked: draft.frames === 0 });
    whole.onchange = () => (draft.frames = whole.checked ? 0 : 24);
    const r6 = hasGame(/rainbow six|r6/i);
    return el(
      'div',
      { className: 'option-grid' },
      el(
        'label',
        { className: 'option toggle' },
        whole,
        el(
          'span',
          {},
          el('b', {}, t('w.detect.whole'), recommendedChip()),
          el('small', { textContent: t('w.detect.wholeNote') }),
        ),
      ),
      option('r6Texts', t('opt.texts'), t('w.detect.textsNote'), {
        recommended: r6 || hasGame(/valorant/i),
      }),
      option('pauseWhileGaming', t('opt.pauseGaming'), t('w.detect.pauseNote'), {
        recommended: true,
      }),
      option('speech', t('opt.speech'), t('w.detect.speechNote')),
      option('keepR6Replays', t('w.detect.keepR6'), t('w.detect.keepR6Note'), {
        recommended: r6,
      }),
      option('fortniteReplays', t('opt.fortnite'), t('w.detect.fortniteNote'), {
        recommended: hasGame(/fortnite/i),
      }),
      option('autoStart', t('w.detect.autoStart'), t('w.detect.autoStartNote'), {
        recommended: true,
      }),
      option('openAtLogin', t('opt.openAtLogin'), t('w.detect.openAtLoginNote')),
      option('notify', t('w.detect.notify'), t('w.detect.notifyNote')),
    );
  },
};

export const doneStep: Step = {
  key: 'done',
  next: true,
  render: () => {
    const on = (value: boolean) => (value ? t('w.done.on') : t('w.done.off'));
    const items = [
      [t('w.server.name'), draft.server],
      [
        t('w.rec.name'),
        `${draft.folder}${wizard.clips ? ` · ${t('count.clips', { count: wizard.clips })}` : ''}`,
      ],
      [
        t('w.ai.name'),
        draft.analyze
          ? t('w.done.ai', {
              scope:
                draft.frames === 0
                  ? t('w.done.whole')
                  : t('w.done.frames', { count: draft.frames }),
            })
          : t('w.done.noAi'),
      ],
      [
        t('w.names.name'),
        draft.playerNames.length
          ? draft.playerNames.map((n) => n.name).join(', ')
          : t('w.done.noNames'),
      ],
      [
        t('w.detect.name'),
        t('w.done.detection', {
          texts: on(draft.r6Texts),
          speech: on(draft.speech),
          replays: on(draft.keepR6Replays || draft.fortniteReplays),
        }),
      ],
      [
        t('card.behavior'),
        t('w.done.behavior', {
          pause: on(draft.pauseWhileGaming),
          login: on(draft.openAtLogin),
        }),
      ],
    ];
    return el(
      'ul',
      { className: 'summary' },
      ...items.map(([label, value]) => el('li', {}, el('span', { textContent: label }), value)),
    );
  },
  validate: async () => {
    // On first setup the titles follow the window language chosen in the welcome step.
    const values: Partial<PublicConfig> = {
      ...draft,
      language,
      titleLanguage: saved().onboarded ? draft.titleLanguage : language,
      onboarded: true,
    };
    delete values.hasToken;
    const config = await call('save', values);
    state.config = config;
    await call('open-at-login', config.openAtLogin);
    await call('start');
  },
};
