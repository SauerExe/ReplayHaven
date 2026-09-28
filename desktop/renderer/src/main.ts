/*
 * Entry of the client window, bundled by scripts/build-client.mjs into renderer/app.js. The
 * modules wire their controls when they load; this one starts the window once the main process
 * answers with config and status.
 */
import { call, run } from './api';
import { setLanguage } from './language';
import './overview';
import './settings';
import { state } from './state';
import { render } from './status';
import './tabs';
import { openWizard } from './wizard';

/* ---------- Start ---------- */

window.vault.onStatus(render);
void run(async () => {
  const loaded = await call('load');
  state.config = loaded.config;
  setLanguage(loaded.config.language);
  render(loaded.status);
  if (!loaded.config.onboarded) openWizard();
});
