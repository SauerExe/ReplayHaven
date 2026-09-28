import { errorText } from '../api';
import type { PublicConfig } from '../api';
import { $, el } from '../dom';
import { t } from '../i18n';
import { saved, state } from '../state';
import { showView } from '../tabs';
import { serverStep, welcomeStep } from './connect';
import { detectStep, doneStep } from './finish';
import { aiStep, namesStep, recordingsStep } from './setup';
import { setDraft, syncNext, wizard } from './state';
import type { Step } from './state';

/* ---------- Setup wizard ---------- */

/** The wizard steps in order; status.ts repaints the server (1) and AI (3) step in place. */
export const STEPS: Step[] = [
  welcomeStep,
  serverStep,
  recordingsStep,
  aiStep,
  namesStep,
  detectStep,
  doneStep,
];
export let step = 0;

export function openWizard() {
  const config = saved();
  const draft: PublicConfig = { ...config, token: '' };
  if (!config.onboarded) {
    // Recommendations for the first setup.
    Object.assign(draft, {
      frames: 0,
      r6Texts: true,
      pauseWhileGaming: true,
      keepR6Replays: true,
      autoStart: true,
      notify: true,
      analyze: true,
    } satisfies Partial<PublicConfig>);
  }
  setDraft(draft);
  wizard.serverOk = !!config.hasToken;
  wizard.useKey = false;
  // A first setup suggests the AI choice from the graphics card (aiStep); later runs keep it.
  wizard.aiChoice = config.onboarded ? (config.analyze ? 'local' : 'none') : undefined;
  wizard.aiFailed = '';
  step = 0;
  $('wizard').hidden = false;
  $('app').inert = true;
  renderWizard();
}
function closeWizard() {
  $('wizard').hidden = true;
  $('app').inert = false;
}
export function renderWizard() {
  const current = STEPS[step];
  const text = (part: string) => t(`w.${current.key}.${part}`);
  $('wizard-steps').replaceChildren(
    ...STEPS.map((s, i) =>
      el('li', {
        textContent: t(`w.${s.key}.name`),
        dataset: { state: i < step ? 'done' : i === step ? 'current' : 'todo' },
      }),
    ),
  );
  $('wizard-eyebrow').textContent = text('eyebrow');
  $('wizard-title').textContent = text('title');
  $('wizard-lead').textContent = text('lead');
  $('wizard-error').textContent = '';
  const content = current.render();
  $('wizard-content').replaceChildren(content);
  $('wizard-back').hidden = step === 0;
  $('wizard-back').textContent = t('btn.back');
  $('wizard-next').textContent = current.next ? text('next') : t('btn.next');
  $('wizard-skip').hidden = !current.skip;
  $('wizard-skip').textContent = current.skip ? text('skip') : '';
  syncNext(current);
  $('wizard-title').focus();
}
async function advance(skip = false) {
  const current = STEPS[step];
  const next = $<HTMLButtonElement>('wizard-next');
  next.disabled = true;
  $('wizard-error').textContent = '';
  try {
    if (skip) current.onSkip?.();
    else await current.validate?.();
    if (step === STEPS.length - 1) {
      closeWizard();
      showView('overview');
    } else {
      step++;
      renderWizard();
    }
  } catch (e) {
    $('wizard-error').textContent = errorText(e);
  } finally {
    syncNext(STEPS[step]);
  }
}
$('wizard-next').onclick = () => advance();
$('wizard-skip').onclick = () => advance(true);
$('wizard-back').onclick = () => {
  if (step > 0) step--;
  renderWizard();
};
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('wizard').hidden && state.config?.onboarded) closeWizard();
});
