import { z } from 'zod';
import { DEFAULT_MODEL, MODELS } from '../agent/ollama';
import { playerNamesSchema, savedPlayerNames, tidyPlayerNames } from '../agent/players';
import { TITLE_LANGUAGES } from '../agent/translate';

/*
 * The client's settings: schema, defaults, validation and loading of older saved files. Kept out of
 * main.ts, which needs Electron, so the rules can be tested on their own (config.test.ts).
 */

export const configSchema = z.object({
  folder: z.string().max(1000),
  server: z.string().url().max(500),
  token: z.string().max(1000).default(''),
  game: z.string().max(100),
  // Without your own name the AI may attribute kills and scores to the wrong side. One name per
  // game; an entry without a game applies everywhere (agent/players.ts).
  playerNames: playerNamesSchema.default([]),
  includeExisting: z.boolean(),
  analyze: z.boolean(),
  /** 0: whole clip, one frame every FRAME_SPACING seconds. */
  frames: z.union([z.literal(24), z.literal(48), z.literal(0)]),
  // Kills, weapon and distance from the Fortnite replays (agent/fortnite.ts). Off until measured.
  fortniteReplays: z.boolean().default(false),
  // Your own Epic account IDs; empty: the client detects the account from the replays itself.
  epicAccounts: z.array(z.string()).max(10).default([]),
  // Map and round result in R6 via text recognition (agent/r6.ts), about a minute of CPU per clip;
  // in Valorant the killfeed (agent/valorant.ts), provided a player name is entered.
  r6Texts: z.boolean().default(false),
  // Transcribe voice chat (agent/parakeet.ts): Parakeet on the CPU, models ~670 MB once.
  speech: z.boolean().default(false),
  // While a game runs full screen, analysis and upload wait (agent/gaming.ts).
  pauseWhileGaming: z.boolean().default(true),
  // Keep the R6 match for every R6 clip (agent/r6-replays.ts), about 30 MB per match.
  keepR6Replays: z.boolean().default(true),
  // Setup completed: afterwards the window shows the overview instead of the wizard.
  onboarded: z.boolean().default(false),
  // Resume work right away when the client opens instead of waiting for "Start".
  autoStart: z.boolean().default(true),
  // Start with Windows, in the notification area.
  openAtLogin: z.boolean().default(false),
  // Windows notification when a clip is archived (never during a game).
  notify: z.boolean().default(true),
  // Fixed ID of this PC for pairing with the server.
  deviceId: z.string().uuid().optional(),
  // Language of the client window (desktop/renderer/src/i18n). Main-process messages stay English.
  language: z.enum(['en', 'de']).default('en'),
  // Language of generated titles, descriptions and highlights (agent/translate.ts). Configurations
  // from before this option follow the window language, see the loader below.
  titleLanguage: z.enum(TITLE_LANGUAGES).default('en'),
  // The vision model; 4B for cards with 6 to 8 GB VRAM (agent/ollama.ts, MODELS).
  model: z.enum(MODELS).default(DEFAULT_MODEL),
});
export type ClientConfig = z.infer<typeof configSchema>;

export const DEFAULT_CONFIG: ClientConfig = {
  folder: '',
  server: 'http://localhost:8787',
  token: '',
  game: '',
  playerNames: [],
  includeExisting: false,
  analyze: true,
  frames: 24,
  fortniteReplays: false,
  epicAccounts: [],
  r6Texts: false,
  speech: false,
  pauseWhileGaming: true,
  keepR6Replays: true,
  onboarded: false,
  autoStart: true,
  openAtLogin: false,
  notify: true,
  language: 'en',
  titleLanguage: 'en',
  model: DEFAULT_MODEL,
};

export function validateServer(value: string) {
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Use a server address without embedded credentials.');
  return value.replace(/\/$/, '');
}

/**
 * A server address as typed: without a scheme, host names, IPs and addresses with a port usually
 * mean http in the home network, domains https.
 */
export function serverAddress(address: string) {
  const local = /^(?:localhost|\d+\.\d+\.\d+\.\d+|[^./:]+(?::\d+)?$|[^/]+:\d+)/.test(address);
  return validateServer(
    address.includes('://')
      ? address
      : `${local && !address.endsWith(':443') ? 'http' : 'https'}://${address}`,
  );
}

/** Settings from the window, checked and tidied; an empty token keeps the saved one. */
export function normalizeConfig(value: unknown, savedToken: string) {
  const input = configSchema.parse(value);
  input.server = validateServer(input.server);
  input.playerNames = tidyPlayerNames(input.playerNames);
  input.epicAccounts = [...new Set(input.epicAccounts.map((a) => a.trim().toLowerCase()))].filter(
    Boolean,
  );
  if (input.epicAccounts.some((a) => !/^[0-9a-f]{32}$/.test(a)))
    throw new Error(
      'An Epic account ID has 32 characters from 0–9 and a–f. You can find it on epicgames.com in your account settings.',
    );
  if (input.token === '') input.token = savedToken;
  return input;
}

/**
 * Settings from preferences.json. Files from older versions lack newer fields: a saved folder
 * means setup was done, and the titles follow the window language they were written in before.
 */
export function fromSaved(saved: Record<string, unknown>, token: string) {
  return configSchema.parse({
    onboarded: !!saved.folder,
    titleLanguage: saved.language,
    ...saved,
    playerNames: savedPlayerNames(saved),
    token,
  });
}
