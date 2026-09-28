import { copyFile } from 'node:fs/promises';
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

/**
 * An error the window shows in its own language: `code` names the text (err.<code> in
 * desktop/renderer/src/i18n), `params` fill it, and the English message is the fallback for
 * codes a window does not know.
 */
export class CodedError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly params: Record<string, string | number> = {},
  ) {
    super(message);
  }
}

export function validateServer(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CodedError('server.invalid', 'Enter a valid server address.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new CodedError(
      'server.credentials',
      'Use a server address without embedded credentials.',
    );
  return value.replace(/\/$/, '');
}

/**
 * Whether a host is in the home network: localhost, an IP address, a name without dots (a PC or
 * NAS on the LAN) or one of the names routers and mDNS hand out there.
 */
function lanHost(host: string) {
  const name = host.toLowerCase().replace(/\.$/, '');
  return (
    name === 'localhost' ||
    /^\d+\.\d+\.\d+\.\d+$/.test(name) ||
    name.startsWith('[') ||
    !name.includes('.') ||
    /\.(?:local|lan|home|internal|localdomain|home\.arpa|fritz\.box)$/.test(name)
  );
}

/**
 * A server address as typed: without a scheme, hosts in the home network mean http, every other
 * domain https — also with a port, so a public server is never contacted unencrypted by accident.
 */
export function serverAddress(address: string) {
  if (address.includes('://')) return validateServer(address);
  const host = /^(\[[^\]]*\]|[^/:]*)(?::(\d+))?/.exec(address);
  const http = !!host && lanHost(host[1]) && host[2] !== '443';
  return validateServer(`${http ? 'http' : 'https'}://${address}`);
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
    throw new CodedError(
      'config.epic',
      'An Epic account ID has 32 characters from 0–9 and a–f. You can find it on epicgames.com in your account settings.',
    );
  if (input.token === '') input.token = savedToken;
  return input;
}

/**
 * Settings from preferences.json. Files from older versions lack newer fields: a saved folder
 * means setup was done, and the titles follow the window language they were written in before.
 * A field that does not fit the schema (edited by hand, written by a newer version) falls back to
 * its default on its own, so one bad value never costs the other settings; `repaired` names them.
 */
export function readSaved(saved: unknown, token: string) {
  const isRecord = !!saved && typeof saved === 'object' && !Array.isArray(saved);
  const record = (isRecord ? saved : {}) as Record<string, unknown>;
  const repaired: string[] = isRecord ? [] : ['*'];
  let playerNames: unknown = [];
  try {
    playerNames = savedPlayerNames(record);
  } catch {
    repaired.push('playerNames');
  }
  const input: Record<string, unknown> = {
    onboarded: !!record.folder,
    titleLanguage: record.language,
    ...record,
    playerNames,
    token,
  };
  const output: Record<string, unknown> = {};
  const shape = configSchema.shape;
  for (const key of Object.keys(shape) as (keyof typeof shape)[]) {
    const field = shape[key].safeParse(input[key]);
    if (field.success) {
      if (field.data !== undefined) output[key] = field.data;
      continue;
    }
    // Missing values are expected in older files; only a saved but broken one counts.
    if (record[key] !== undefined) repaired.push(key);
    if (DEFAULT_CONFIG[key] !== undefined) output[key] = DEFAULT_CONFIG[key];
  }
  return { config: configSchema.parse(output), repaired };
}

export function fromSaved(saved: Record<string, unknown>, token: string) {
  return readSaved(saved, token).config;
}

/**
 * preferences.json as read from disk. Whatever cannot be read falls back on its own: a damaged
 * file to the defaults ('*'), a broken field to its default, an access key this Windows account
 * cannot decrypt to none ('token', pair again) while all other settings stay.
 */
export function parseSaved(text: string, decrypt: (encrypted: string) => string) {
  let saved: unknown;
  try {
    saved = JSON.parse(text);
  } catch {
    saved = undefined;
  }
  const encrypted = (saved as { encryptedToken?: unknown } | undefined)?.encryptedToken;
  let token = '';
  let lost = false;
  if (typeof encrypted === 'string' && encrypted)
    try {
      token = decrypt(encrypted);
    } catch {
      lost = true;
    }
  const { config, repaired } = readSaved(saved, token);
  return { config, repaired: lost ? [...repaired, 'token'] : repaired };
}

/** Copies a file to <file>.bak before it is overwritten; a missing file needs none. */
export async function backupFile(file: string) {
  await copyFile(file, `${file}.bak`).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
}
