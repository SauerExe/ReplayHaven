import type { Status } from './api';
import { $ } from './dom';
import { renderOverview } from './overview';
import { renderSettingsPairing } from './settings/connection';
import { renderSettingsLock } from './settings/lock';
import { state } from './state';
import { STEPS, step } from './wizard';

/* ---------- Status ---------- */

let lastPairing = 'null';
/** Draws a status from the main process everywhere it shows. */
export function render(s: Status) {
  state.status = s;
  renderOverview(s);
  renderSettingsLock(s);
  if (!$('wizard').hidden && step === 3) STEPS[3].paint?.();
  const pairing = JSON.stringify(s.pairing);
  if (pairing !== lastPairing) {
    lastPairing = pairing;
    if (!$('wizard').hidden && step === 1) STEPS[1].paint?.();
    renderSettingsPairing(s.pairing);
  }
}
