import type { PublicConfig, Status } from './api';

/** What the main process last sent: the saved config and the status. Both arrive after `load`. */
export const state: { config: PublicConfig | null; status: Status | null } = {
  config: null,
  status: null,
};

/** The saved config, for code that only runs once it is loaded. */
export function saved(): PublicConfig {
  if (!state.config) throw new Error('The settings are not loaded yet.');
  return state.config;
}
