import { call, errorText, run } from '../api';
import type { Language } from '../api';
import { el } from '../dom';
import { pairingMessage } from '../format';
import { language, t } from '../i18n';
import { saveLanguage } from '../language';
import { state } from '../state';
import { checkLine, draft, field, wizard } from './state';
import type { Step } from './state';

/* ---------- Setup wizard: welcome and server ---------- */

export const welcomeStep: Step = {
  key: 'welcome',
  next: true,
  render: () => {
    const choice = el(
      'select',
      {},
      el('option', { value: 'en', textContent: 'English' }),
      el('option', { value: 'de', textContent: 'Deutsch' }),
    );
    choice.value = language;
    choice.onchange = () =>
      run(async () => {
        draft.language = choice.value as Language;
        await saveLanguage(choice.value);
      });
    return el(
      'div',
      { className: 'wizard-content' },
      el(
        'div',
        { className: 'features' },
        ...[
          ['◉', 'recordings'],
          ['✦', 'ai'],
          ['▶', 'archive'],
        ].map(([icon, feature]) =>
          el(
            'div',
            { className: 'feature' },
            el('span', { className: 'feature-icon', textContent: icon }),
            el('b', { textContent: t(`w.feature.${feature}`) }),
            el('p', { textContent: t(`w.feature.${feature}Text`) }),
          ),
        ),
      ),
      el('label', { className: 'field language-field' }, t('field.language'), choice),
    );
  },
};

export const serverStep: Step = {
  key: 'server',
  render: () => {
    const box = el('div', { className: 'wizard-content' });
    const address = el('input', {
      type: 'text',
      value: draft.server,
      placeholder: t('w.server.placeholder'),
      spellcheck: false,
    });
    const token = el('input', {
      type: 'password',
      autocomplete: 'off',
      placeholder: t('w.server.tokenPlaceholder'),
    });
    const keyResult = el('div');
    address.oninput = () => (wizard.serverOk = false);
    const paint = () => {
      const p = state.status?.pairing;
      const children: HTMLElement[] = [field(t('field.server'), address)];
      if (wizard.useKey) {
        const test = el('button', {
          type: 'button',
          className: 'primary',
          textContent: t('w.server.check'),
        });
        test.onclick = async () => {
          draft.server = address.value.trim();
          draft.token = token.value;
          keyResult.replaceChildren(checkLine('', t('w.server.checking')));
          try {
            const info = await call('test-server', { server: draft.server, token: draft.token });
            wizard.serverOk = true;
            keyResult.replaceChildren(
              checkLine(
                'ok',
                t('result.connected', { clips: t('count.clips', { count: info.clips }) }),
              ),
            );
          } catch (e) {
            wizard.serverOk = false;
            keyResult.replaceChildren(checkLine('bad', errorText(e)));
          }
        };
        const back = el('button', {
          type: 'button',
          className: 'link',
          textContent: t('w.server.pairInstead'),
        });
        back.onclick = () => {
          wizard.useKey = false;
          paint();
        };
        children.push(
          field(t('field.token'), token),
          el('div', { className: 'row' }, test, back),
          keyResult,
        );
      } else if (p?.state === 'waiting') {
        const open = el('button', {
          type: 'button',
          className: 'primary',
          textContent: t('w.server.openDevices'),
        });
        open.onclick = () => run(() => call('open-devices'));
        const cancel = el('button', {
          type: 'button',
          className: 'ghost',
          textContent: t('btn.cancel'),
        });
        cancel.onclick = () => run(() => call('pair-cancel'));
        children.push(
          el(
            'div',
            { className: 'pair-card' },
            el('span', { className: 'eyebrow', textContent: t('w.server.code') }),
            el('strong', {
              className: 'pair-code',
              textContent: `${p.code.slice(0, 3)} ${p.code.slice(3)}`,
            }),
            el('p', { textContent: t('w.server.codeText') }),
            el('div', { className: 'row' }, open, cancel),
          ),
          checkLine('', pairingMessage(p)),
        );
      } else if (p?.state === 'approved' || wizard.serverOk) {
        if (p?.state === 'approved') draft.server = p.server;
        wizard.serverOk = true;
        children.push(
          checkLine('ok', p?.state === 'approved' ? pairingMessage(p) : t('w.server.paired')),
        );
      } else {
        const connect = el('button', {
          type: 'button',
          className: 'primary',
          textContent: t('w.server.connect'),
        });
        connect.onclick = () =>
          run(async () => {
            draft.server = address.value.trim();
            connect.disabled = true;
            try {
              await call('pair-start', draft.server);
            } finally {
              connect.disabled = false;
            }
          });
        const useKey = el('button', {
          type: 'button',
          className: 'link',
          textContent: t('w.server.useKey'),
        });
        useKey.onclick = () => {
          wizard.useKey = true;
          paint();
        };
        if (p) children.push(checkLine('bad', pairingMessage(p)));
        // Servers in the home network, searched once per wizard (desktop/discovery.ts).
        if (wizard.found === undefined) {
          wizard.found = null;
          void call('discover')
            .then(
              (found) => (wizard.found = found),
              () => (wizard.found = []),
            )
            .finally(() => serverStep.paint?.());
        }
        if (wizard.found === null) children.push(checkLine('', t('w.server.searching')));
        else if (wizard.found.length)
          children.push(
            el('p', { className: 'muted', textContent: t('w.server.found') }),
            el(
              'div',
              { className: 'row' },
              ...wizard.found.map((origin) => {
                const pick = el('button', {
                  type: 'button',
                  className: 'secondary',
                  textContent: new URL(origin).host,
                });
                pick.onclick = () =>
                  run(async () => {
                    address.value = origin;
                    draft.server = origin;
                    await call('pair-start', origin);
                  });
                return pick;
              }),
            ),
          );
        children.push(el('div', { className: 'row' }, connect, useKey));
      }
      box.replaceChildren(...children);
    };
    serverStep.paint = paint;
    paint();
    return box;
  },
  validate: () => {
    const pairing = state.status?.pairing;
    if (pairing?.state === 'approved') {
      draft.server = pairing.server;
      wizard.serverOk = true;
    }
    if (!wizard.serverOk) throw new Error(t('w.server.error'));
  },
};
