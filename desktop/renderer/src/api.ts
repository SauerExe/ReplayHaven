import { $ } from './dom';
import { coded } from './i18n';

/*
 * The bridge from desktop/preload.ts and the data behind it. The shapes mirror configSchema, the
 * status object and the ipcMain handlers in desktop/main.ts; that file pulls in Electron and
 * Node, so its types are restated here instead of imported.
 */

export type Language = 'en' | 'de';
/** The models the client offers (MODELS in agent/ollama.ts). */
export const MODELS = ['qwen3.5:9b', 'qwen3.5:4b'] as const;
export type Model = (typeof MODELS)[number];
export interface PlayerName {
  name: string;
  game: string;
}
/** The saved settings (configSchema in desktop/main.ts). */
export interface ClientConfig {
  folder: string;
  server: string;
  token: string;
  game: string;
  playerNames: PlayerName[];
  includeExisting: boolean;
  analyze: boolean;
  /** 0: whole clip. */
  frames: 24 | 48 | 0;
  fortniteReplays: boolean;
  epicAccounts: string[];
  r6Texts: boolean;
  speech: boolean;
  pauseWhileGaming: boolean;
  keepR6Replays: boolean;
  onboarded: boolean;
  autoStart: boolean;
  openAtLogin: boolean;
  notify: boolean;
  deviceId?: string;
  language: Language;
  titleLanguage: Language;
  model: Model;
}
/** The config as the window gets it: the key itself never, only whether one is saved. */
export interface PublicConfig extends ClientConfig {
  hasToken: boolean;
}
/** The settings that are switched on and off. */
export type Switch = {
  [K in keyof ClientConfig]-?: ClientConfig[K] extends boolean ? K : never;
}[keyof ClientConfig];

export interface QueueEntry {
  path: string;
  name: string;
  game: string;
  size: number;
  savedAt: number;
  state: 'waiting' | 'settling' | 'retry' | 'deferred';
  note?: string;
}
/** The recording in progress with step, progress and thumbnail. */
export interface Activity extends Omit<QueueEntry, 'state' | 'note'> {
  stage: 'analyzing' | 'uploading';
  since: number;
  step: 'prepare' | 'view' | 'summary' | 'upload';
  current: number;
  total: number;
  thumbnail: string;
}
export interface ArchivedClip {
  name: string;
  game: string;
  title?: string;
  tags?: string[];
  clipId: string;
  at: number;
  /** Time spent on analysis and upload. */
  seconds: number;
}
export type Params = Record<string, string | number>;
export interface Pairing {
  state: 'waiting' | 'approved' | 'denied' | 'expired' | 'error';
  server: string;
  code: string;
  message: string;
  /** The message as text code (err.<text> in i18n); without one, message is shown. */
  text?: string;
  params?: Params;
}
export interface Status {
  running: boolean;
  paused: boolean;
  message: string;
  queued: number;
  uploaded: number;
  ollama: boolean;
  model: boolean;
  downloading: boolean;
  /** The game in the foreground while one is running; empty otherwise. */
  gaming: string;
  queue: QueueEntry[];
  active: Activity | null;
  recent: ArchivedClip[];
  pairing: Pairing | null;
  /** A newer release the server runs (desktop/update.ts); empty otherwise. */
  update: string;
  /** The message as text code (err.<code> in i18n); empty: message is shown as it is. */
  code?: string;
  params?: Params;
}
export interface FolderInfo {
  clips: number;
  games: { game: string; clips: number }[];
}
export interface OllamaCheck {
  running: boolean;
  installed: boolean;
  models?: string[];
}

/** Every action of the bridge: what it takes and what it answers. */
interface Actions {
  load: [undefined, { config: PublicConfig; status: Status; texts?: string }];
  save: [Partial<PublicConfig>, PublicConfig];
  folder: [undefined, string | null];
  games: [undefined, string[]];
  start: [undefined, unknown];
  pause: [undefined, unknown];
  /** Without a model, the saved one. */
  check: [Model | undefined, OllamaCheck];
  download: [Model | undefined, unknown];
  'cancel-download': [undefined, unknown];
  'ollama-install': [undefined, unknown];
  archive: [undefined, unknown];
  'open-clip': [string, unknown];
  reveal: [string | undefined, unknown];
  'test-server': [{ server: string; token: string }, { clips: number }];
  'folder-info': [undefined, FolderInfo];
  'open-at-login': [boolean, unknown];
  'pair-start': [string, unknown];
  'pair-cancel': [undefined, unknown];
  'open-devices': [undefined, unknown];
  /** ReplayHaven servers in the home network (desktop/discovery.ts). */
  discover: [undefined, string[]];
  'download-update': [undefined, unknown];
}
export type Action = keyof Actions;
type Input<A extends Action> = Actions[A][0] extends undefined ? [] : [Actions[A][0]];
type Response =
  { ok: true; value: unknown } | { ok: false; error: string; code?: string; params?: Params };

declare global {
  interface Window {
    vault: {
      call: (action: Action, value?: unknown) => Promise<Response>;
      onStatus: (callback: (status: Status) => void) => () => void;
    };
  }
}

export async function call<A extends Action>(
  action: A,
  ...value: Input<A>
): Promise<Actions[A][1]> {
  const response = await window.vault.call(action, value[0]);
  // Coded errors of the main process appear in the window language.
  if (!response.ok) throw new Error(coded(response.code, response.params, response.error));
  return response.value as Actions[A][1];
}

/** The message of a caught error; everything the bridge and the window throw is an Error. */
export const errorText = (e: unknown) => (e as Error).message;

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(message: string) {
  const box = $('toast');
  box.textContent = message;
  box.hidden = !message;
  clearTimeout(toastTimer);
  if (message) toastTimer = setTimeout(() => (box.hidden = true), 7000);
}
export async function run<T>(action: () => Promise<T> | T) {
  try {
    return await action();
  } catch (e) {
    toast(errorText(e));
  }
}
