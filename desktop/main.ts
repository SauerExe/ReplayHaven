import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  safeStorage,
  shell,
  Tray,
  Menu,
  nativeImage,
  Notification,
} from 'electron';
import { execFile } from 'node:child_process';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { FolderUploader, gameLabel, listVideos, recordedGames } from '../agent/watcher';
import type { ActiveClip, ArchivedClip, QueueEntry } from '../agent/watcher';
import {
  LocalAnalyzer,
  checkOllama,
  pullModel,
  MODELS,
  FRAME_SPACING,
  OLLAMA_URL,
} from '../agent/ollama';
import { defaultDemosFolder, FortniteReplays } from '../agent/fortnite';
import { LATIN_KEYS, LATIN_REC, missingLibrary } from '../agent/ocr';
import { isR6, WorkerTexts } from '../agent/r6';
import { MediaProcessor } from '../server/media';
import { SPEECH_BYTES, speechFolder } from '../agent/parakeet';
import { SpeechProcess } from './speech';
import { GameWatch, gameTitle } from '../agent/gaming';
import { keepMatchForClip } from '../agent/r6-replays';
import { installOllama, OLLAMA_SETUP } from './ollama-setup';
import { linkIn, PAIRING_SCHEME, parsePairingLink } from './pairing-link';
import { discoverServers } from './discovery';
import { isNewer, releasePage } from './update';
import {
  backupFile,
  CodedError,
  configSchema,
  DEFAULT_CONFIG,
  normalizeConfig,
  parseSaved,
  serverAddress,
  validateServer,
} from './config';
import type { ClientConfig } from './config';

let config: ClientConfig = { ...DEFAULT_CONFIG };
// A separate profile (settings, queue, single instance) for tests next to a running client;
// preview mode shows sample data and starts nothing.
if (process.env.REPLAYHAVEN_PROFILE)
  app.setPath('userData', resolve(process.env.REPLAYHAVEN_PROFILE));
const PREVIEW = process.env.REPLAYHAVEN_PREVIEW || '';
let window: BrowserWindow;
let tray: Tray;
let quitting = false;
let agent: FolderUploader | undefined;
let loop: ReturnType<typeof setInterval> | undefined;
let working = false;
let starting = false;
let paused = true;
/** The game in the foreground while one is running; empty otherwise. */
let gaming = '';
let watch: GameWatch | undefined;
/** Whether queue and AI are waiting right now: paused by hand or while gaming. */
const waiting = () => paused || !!gaming;
let aborter = new AbortController();
let downloadAbort: AbortController | undefined;
/** Folder last chosen in the dialog, even if it is not saved yet. */
let pickedFolder = '';
let status = {
  running: false,
  paused: true,
  message: 'Choose your recordings folder and connect your archive server.',
  queued: 0,
  uploaded: 0,
  ollama: false,
  model: false,
  downloading: false,
  gaming: '',
  queue: [] as QueueEntry[],
  active: null as Activity | null,
  recent: [] as ArchivedClip[],
  pairing: null as Pairing | null,
  /** A newer release the server runs, for the update notice (desktop/update.ts); empty otherwise. */
  update: '',
  /**
   * The message as text code for the window's language (CodedError in desktop/config.ts), or
   * empty: then the window shows `message` as it is. Reset with every new message.
   */
  code: '',
  params: {} as Params,
};
type Params = Record<string, string | number>;
/** State of a pairing: the PC waits until someone approves it in the web interface. */
type Pairing = {
  state: 'waiting' | 'approved' | 'denied' | 'expired' | 'error';
  server: string;
  code: string;
  message: string;
  /** The message as text code for the window, see status.code. */
  text?: string;
  params?: Params;
};
/** Code and parameters of an error for the window; empty for errors without one. */
function coded(error: unknown): { code: string; params: Params } {
  return error instanceof CodedError
    ? { code: error.code, params: error.params }
    : { code: '', params: {} };
}
/** The recording in progress with step, progress and thumbnail for the window. */
type Activity = ActiveClip & {
  step: 'prepare' | 'view' | 'summary' | 'upload';
  current: number;
  total: number;
  thumbnail: string;
};
const root = () => app.getPath('userData');
function emit(patch: Partial<typeof status> = {}) {
  status = {
    ...status,
    // A new message without a code of its own is shown as it is.
    ...('message' in patch ? { code: '', params: {} } : {}),
    ...patch,
    paused,
    uploaded: agent?.state.uploaded || patch.uploaded || status.uploaded,
  };
  window?.webContents.send('vault:status', status);
  updateShell();
}
/** Taskbar progress, tray tooltip and tray menu follow the status. */
let trayState = '';
function updateShell() {
  if (!window || window.isDestroyed()) return;
  const a = status.active;
  const fraction = !a
    ? -1
    : a.step === 'prepare'
      ? 0.04
      : a.step === 'view'
        ? 0.05 + 0.8 * (a.total ? a.current / a.total : 0)
        : a.step === 'summary'
          ? 0.9
          : 0.97;
  window.setProgressBar(fraction, { mode: waiting() && status.running ? 'paused' : 'normal' });
  if (!tray) return;
  const state = !status.running ? 'off' : gaming ? 'gaming' : paused ? 'paused' : 'running';
  tray.setToolTip(
    `ReplayHaven · ${
      state === 'off'
        ? 'not started'
        : state === 'gaming'
          ? `waiting, ${gaming} is running`
          : state === 'paused'
            ? 'paused'
            : a
              ? `analyzing ${a.name}`
              : 'ready'
    }${status.queue.length ? ` · ${status.queue.length} in the queue` : ''}`,
  );
  if (state === trayState) return;
  trayState = state;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open ReplayHaven', click: () => showWindow() },
      state === 'running' || state === 'gaming'
        ? { label: 'Pause', click: pause }
        : {
            label: status.running ? 'Resume' : 'Start',
            enabled: config.onboarded,
            click: () =>
              void start().catch((e: Error) => emit({ message: e.message, ...coded(e) })),
          },
      { label: 'Open archive in browser', click: () => void openArchive() },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}
function showWindow() {
  window.show();
  window.focus();
}
function openArchive(path = '') {
  return shell.openExternal(`${validateServer(config.server)}${path}`);
}
/** A small still image from the clip, as a data URL for the window; empty if that fails. */
function thumbnail(path: string, seconds = 3): Promise<string> {
  return new Promise((done) =>
    execFile(
      join(resource('binaries'), 'ffmpeg.exe'),
      [
        '-v',
        'error',
        '-ss',
        String(seconds),
        '-i',
        path,
        '-frames:v',
        '1',
        '-vf',
        'scale=480:-2',
        '-f',
        'image2',
        '-c:v',
        'mjpeg',
        '-q:v',
        '5',
        'pipe:1',
      ],
      { encoding: 'buffer', maxBuffer: 5e6, windowsHide: true, timeout: 15000 },
      (error, out) => {
        if (!error && out.length) return done(`data:image/jpeg;base64,${out.toString('base64')}`);
        // Shorter clips have no frame left at three seconds.
        if (seconds > 0) return void thumbnail(path, 0).then(done);
        done('');
      },
    ),
  );
}
/** Takes over the queue and the current recording from the watcher. */
function showQueue(queue: QueueEntry[], active: ActiveClip | undefined) {
  const previous = status.active;
  const next: Activity | null = active
    ? previous?.path === active.path
      ? {
          ...previous,
          ...active,
          ...(active.stage === 'uploading' ? { step: 'upload' as const } : {}),
        }
      : { ...active, step: 'prepare', current: 0, total: 0, thumbnail: '' }
    : null;
  emit({ queue: queue.slice(0, 200), active: next });
  if (next && previous?.path !== next.path)
    void thumbnail(next.path).then((image) => {
      if (status.active?.path === next.path)
        emit({ active: { ...status.active, thumbnail: image } });
    });
}
/**
 * Reads from the analysis messages (agent/ollama.ts) how far it is. The messages used to be
 * German and are English now; both wordings are recognized.
 */
function showProgress(message: string) {
  const a = status.active;
  if (!a) return emit({ message });
  const view = /(?:Abschnitt|section|part|batch) (\d+) (?:von|of) (\d+)/i.exec(message);
  const step = view
    ? 'view'
    : /zusammengefasst|überarbeitet|summari[sz]|writing (?:the )?title|revising/i.test(message)
      ? 'summary'
      : /vorbereitet|preparing|prepared/i.test(message)
        ? 'prepare'
        : a.step;
  emit({
    message,
    active: {
      ...a,
      step,
      ...(view ? { current: Number(view[1]), total: Number(view[2]) } : {}),
    },
  });
}
function publicConfig() {
  return { ...config, token: '', hasToken: !!config.token };
}
async function saveConfig(value: unknown) {
  const input = normalizeConfig(value, config.token);
  // Switching only the language is allowed at any time, even while the client is running.
  const keys = Object.keys(configSchema.shape) as (keyof ClientConfig)[];
  if (
    keys.every(
      (key) => key === 'language' || JSON.stringify(input[key]) === JSON.stringify(config[key]),
    )
  ) {
    config = { ...config, language: input.language };
    await persist();
    return publicConfig();
  }
  if (working)
    throw new CodedError(
      'save.working',
      'Pause the client and wait until the current step has finished.',
    );
  if (status.running && !paused)
    throw new CodedError('save.running', 'Pause the client before changing settings.');
  if (input.token && !safeStorage.isEncryptionAvailable())
    throw new CodedError(
      'save.encryption',
      'Windows cannot store the access key encrypted right now.',
    );
  config = input;
  if (app.isPackaged && !PREVIEW)
    app.setLoginItemSettings({ openAtLogin: config.openAtLogin, args: ['--hidden'] });
  if (PREVIEW) {
    emit({ message: 'Preview: settings applied, not saved.' });
    return publicConfig();
  }
  await persist();
  emit({ message: 'Settings saved. Ready to start.' });
  return publicConfig();
}
/**
 * Set when preferences.json could not be read completely (a broken field, an access key another
 * Windows account encrypted): before it is first overwritten, it is kept as preferences.json.bak.
 */
let backupBeforeSave = false;
async function persist() {
  if (PREVIEW) return;
  await mkdir(root(), { recursive: true });
  if (backupBeforeSave) {
    await backupFile(join(root(), 'preferences.json'));
    backupBeforeSave = false;
  }
  const encryptedToken = config.token
    ? safeStorage.encryptString(config.token).toString('base64')
    : '';
  await writeFile(
    join(root(), 'preferences.json'),
    JSON.stringify({ ...config, token: undefined, encryptedToken }, null, 2),
  );
}
/**
 * Reads preferences.json. Whatever cannot be read falls back on its own: a broken field to its
 * default, an access key this Windows account cannot decrypt to none (pair again), a damaged file
 * to the defaults. The file is then kept as a backup before the first save overwrites it.
 */
async function loadConfig() {
  let text: string;
  try {
    text = await readFile(join(root(), 'preferences.json'), 'utf8');
  } catch {
    return; // First start.
  }
  const loaded = parseSaved(text, (encrypted) =>
    safeStorage.decryptString(Buffer.from(encrypted, 'base64')),
  );
  config = loaded.config;
  if (loaded.repaired.length) {
    backupBeforeSave = true;
    console.error(
      `preferences.json only partly readable (${loaded.repaired.join(', ')}); defaults used, a backup follows on the next save.`,
    );
  }
}
/**
 * Pairs this PC with a server: it sends a request, shows the code and waits until someone
 * approves it in the web interface; then it stores its own access (server/auth-routes.ts).
 */
let pairingAbort: AbortController | undefined;
/** Refused while the client works: pairing changes the server and key it works with. */
const pairBusy = () => new CodedError('pair.busy', 'Pause the client before pairing it again.');
/** An error answer of the server: its own message if it sent one, otherwise the status code. */
const serverRefused = (response: Response, message?: string) =>
  message
    ? new Error(message)
    : new CodedError('server.http', `The server responds with HTTP ${response.status}.`, {
        status: response.status,
      });
async function startPairing(address: string) {
  // A copied pairing link pasted as the address pairs right away.
  if (address.startsWith(`${PAIRING_SCHEME}:`)) return pairByLink(address);
  const server = serverAddress(address);
  if (working || (status.running && !paused)) throw pairBusy();
  pairingAbort?.abort();
  const abort = new AbortController();
  pairingAbort = abort;
  if (!config.deviceId) {
    config = { ...config, deviceId: randomUUID() };
    await persist();
  }
  let response: Response;
  try {
    response = await fetch(`${server}/api/pair/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: config.deviceId, name: hostname() }),
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]),
    });
  } catch {
    throw new CodedError(
      'pair.noResponse',
      'No response. Check the address and whether the server is running.',
    );
  }
  if (response.status === 404)
    throw new CodedError(
      'pair.unsupported',
      'This server does not support pairing yet. Update it or connect with the access key.',
    );
  const body = (await response.json().catch(() => ({}))) as {
    id?: string;
    secret?: string;
    code?: string;
    error?: string;
  };
  if (!response.ok || !body.id || !body.secret || !body.code)
    throw serverRefused(response, body.error);
  const show = (state: Pairing['state'], error: CodedError) =>
    emit({
      pairing: {
        state,
        server,
        code: body.code!,
        message: error.message,
        text: error.code,
        params: error.params,
      },
    });
  const expired = () =>
    new CodedError('pair.expired', 'The request has expired. Start pairing again.');
  show('waiting', new CodedError('pair.waiting', 'Waiting for approval in the web interface …'));
  void (async () => {
    const until = Date.now() + 10 * 60000;
    while (!abort.signal.aborted && Date.now() < until) {
      await new Promise((done) => setTimeout(done, 2000));
      if (abort.signal.aborted) return;
      try {
        const reply = await fetch(`${server}/api/pair/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: body.id, secret: body.secret }),
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]),
        });
        const result = (await reply.json()) as { status: string; token?: string };
        if (result.status === 'approved' && result.token) {
          config = { ...config, server, token: result.token };
          await persist();
          const host = new URL(server).host;
          show('approved', new CodedError('pair.approved', `Paired with ${host}.`, { host }));
          // Resumed while the approval was pending: the uploader still has the old access.
          void restartWithNewAccess();
          return;
        }
        if (result.status === 'denied')
          return show('denied', new CodedError('pair.denied', 'The pairing was denied.'));
        if (result.status === 'expired') return show('expired', expired());
      } catch {
        // Briefly unreachable: keep asking until the request expires.
      }
    }
    if (!abort.signal.aborted) show('expired', expired());
  })();
  return { code: body.code, server };
}
/**
 * After a new pairing: a running client restarts its uploader so it uses the new server and
 * access key. A paused one picks them up when it resumes.
 */
async function restartWithNewAccess() {
  if (!status.running || paused || PREVIEW) return;
  pause();
  // Let the step in progress see the pause and finish first.
  for (let i = 0; working && i < 600; i++) await new Promise((done) => setTimeout(done, 100));
  await start().catch((error: Error) => emit({ message: error.message, ...coded(error) }));
}
/**
 * Pairs with the server a link names. A link that Windows hands over came from some web page,
 * not necessarily the user's own server, so it is only used after the user confirms the host:
 * otherwise any site could redirect this PC's uploads to itself.
 */
async function pairByLink(link: string, { confirm = false } = {}) {
  const parsed = parsePairingLink(link);
  const server = validateServer(parsed.server);
  const { ticket } = parsed;
  const show = (state: Pairing['state'], error: Error) =>
    emit({
      pairing: {
        state,
        server,
        code: '',
        message: error.message,
        ...(error instanceof CodedError ? { text: error.code, params: error.params } : {}),
      },
    });
  if (working || (status.running && !paused)) {
    const error = pairBusy();
    show('error', error);
    throw error;
  }
  if (confirm) {
    const host = new URL(server).host;
    const german = config.language === 'de';
    const { response } = await dialog.showMessageBox(window, {
      type: 'question',
      buttons: german ? ['Verbinden', 'Abbrechen'] : ['Connect', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      message: german ? `Diesen PC mit ${host} verbinden?` : `Connect this PC to ${host}?`,
      detail: german
        ? `Deine Clips werden dann zu ${server} hochgeladen. Fahre nur fort, wenn du gerade in deinem eigenen ReplayHaven auf „Diesen PC verbinden“ geklickt hast.`
        : `Your clips will then be uploaded to ${server}. Only continue if you just clicked “Connect this PC” in your own ReplayHaven.`,
    });
    if (response !== 0) return { code: '', server: config.server };
  }
  pairingAbort?.abort();
  let response: Response;
  try {
    response = await fetch(`${server}/api/pair/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket, name: hostname() }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    const error = new CodedError(
      'pair.serverDown',
      'The server does not respond. Is it running and reachable from this PC?',
    );
    show('error', error);
    throw error;
  }
  const body = (await response.json().catch(() => ({}))) as { token?: string; error?: string };
  if (!response.ok || !body.token) {
    const error = serverRefused(response, body.error);
    show(response.status === 410 ? 'expired' : 'error', error);
    throw error;
  }
  config = { ...config, server, token: body.token };
  await persist();
  const host = new URL(server).host;
  show('approved', new CodedError('pair.approved', `Paired with ${host}.`, { host }));
  // A PC that was already set up resumes its work with the new server.
  if (config.onboarded && config.autoStart) void autoStart();
  return { code: '', server };
}
/** Bundled files next to the app archive: FFmpeg, ONNX Runtime, text recognition models. */
function resource(name: string) {
  return app.isPackaged ? join(process.resourcesPath, name) : resolve('desktop-bundle', name);
}
const ocrModels = () => ({
  det: join(resource('ocr'), 'ch_PP-OCRv4_det_infer.onnx'),
  // Reading with PP-OCRv5 Latin (agent/ocr-models.json), downloaded and verified by the build.
  rec: join(resource('ocr'), LATIN_REC.file!),
  keys: join(resource('ocr'), LATIN_KEYS.file!),
});
/** Text recognition runs in its own thread and stays loaded across starts. */
let texts: WorkerTexts | undefined;
function textsWorker() {
  const binaries = resource('binaries');
  texts ??= new WorkerTexts({
    script: resource('r6-worker.cjs'),
    data: {
      models: ocrModels(),
      runtime: resource('onnxruntime'),
      ffmpeg: join(binaries, 'ffmpeg.exe'),
      ffprobe: join(binaries, 'ffprobe.exe'),
    },
  });
  return texts;
}
/** Ends the text recognition worker without interrupting it in the middle of a frame. */
let textsClosing: Promise<void> | undefined;
function closeTexts() {
  const closing = texts;
  texts = undefined;
  if (closing) {
    const done: Promise<void> = Promise.all([textsClosing, closing.close()]).then(() => {
      if (textsClosing === done) textsClosing = undefined;
    });
    textsClosing = done;
  }
  return textsClosing;
}
/**
 * Loads text recognition once as a trial: before starting with the R6 option and in the smoke
 * test of the built client. Returns nothing when it is ready, otherwise a hint on how to fix it.
 */
async function textsProblem() {
  const error = await textsWorker().problem();
  if (!error) return undefined;
  const detail = error.message.trim() || 'unknown';
  return missingLibrary(error)
    ? new CodedError(
        'launch.vcRedist',
        `R6 text recognition needs a current version of the "Microsoft Visual C++ Redistributable" (x64). Install it from Microsoft or turn the option off. (${detail})`,
        { detail },
      )
    : new CodedError('launch.texts', `R6 text recognition cannot be loaded: ${detail}`, {
        detail,
      });
}
/** Speech recognition runs in its own process and keeps its models across starts. */
let speech: SpeechProcess | undefined;
function speechProcess() {
  const binaries = resource('binaries');
  speech ??= new SpeechProcess({
    script: resource('speech-worker.cjs'),
    data: {
      folder: speechFolder(),
      runtime: join(resource('sherpa'), 'sherpa-onnx-node'),
      ffmpeg: join(binaries, 'ffmpeg.exe'),
      ffprobe: join(binaries, 'ffprobe.exe'),
    },
  });
  return speech;
}
function closeSpeech() {
  speech?.close();
  speech = undefined;
}
function media() {
  const binaries = resource('binaries');
  return new MediaProcessor({
    ffmpeg: join(binaries, 'ffmpeg.exe'),
    ffprobe: join(binaries, 'ffprobe.exe'),
  });
}
/** R6 clips whose match may still have been running when saved; they are completed later. */
const runningMatches = new Set<number>();
let lastMatchSync = 0;
async function keepR6Match(savedAt: number) {
  try {
    const kept = await keepMatchForClip(savedAt);
    if (kept?.running) runningMatches.add(savedAt);
    else runningMatches.delete(savedAt);
  } catch (error) {
    // Keeping the match is a bonus; the clip is uploaded.
    runningMatches.delete(savedAt);
    console.error('R6 match not kept:', error instanceof Error ? error.message : error);
  }
}
let lastScan = 0;
let lastUpdateCheck = 0;
/** Looks at the server's release every few hours; a newer one is offered in the window. */
async function checkServerVersion(known?: { version?: string }) {
  lastUpdateCheck = Date.now();
  const info =
    known ??
    ((await fetch(`${config.server}/api/status`, {
      headers: config.token ? { Authorization: `Bearer ${config.token}` } : {},
      signal: AbortSignal.timeout(10000),
    })
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}))) as { version?: string });
  const update = isNewer(info.version, app.getVersion()) ? (info.version ?? '') : '';
  if (update !== status.update) emit({ update });
}
async function tick() {
  if (!waiting() && runningMatches.size && Date.now() - lastMatchSync > 60_000) {
    lastMatchSync = Date.now();
    for (const savedAt of runningMatches) await keepR6Match(savedAt);
  }
  if (working || !agent) return;
  // While gaming or paused, a look every 30 seconds is enough: new clips enter the queue
  // without keeping disk and connection busy every 3 seconds during the game.
  if (waiting() && Date.now() - lastScan < 30_000) return;
  lastScan = Date.now();
  working = true;
  try {
    await agent.scan();
    await agent.heartbeat();
    if (Date.now() - lastUpdateCheck > 6 * 3600_000) await checkServerVersion();
    emit();
  } catch (error) {
    emit({
      message:
        error instanceof Error
          ? error.message
          : 'Server or folder not reachable. The next attempt follows automatically.',
    });
  } finally {
    working = false;
  }
}
async function start() {
  if (PREVIEW) {
    paused = false;
    return emit({ running: true, message: 'Preview: running.' });
  }
  // The checks before starting take a while; a second click would otherwise start a second run.
  if (starting) throw new CodedError('launch.starting', 'Already starting.');
  starting = true;
  try {
    await launch();
  } finally {
    starting = false;
  }
}
/**
 * Starts on its own when the client opens. Right after Windows starts, the server (e.g. in
 * Docker) or Ollama are often not up yet, so a failed attempt is retried every 30 seconds
 * until it works, the user starts or pauses by hand, or auto-start is turned off.
 */
let autoStartTimer: ReturnType<typeof setTimeout> | undefined;
async function autoStart() {
  clearTimeout(autoStartTimer);
  if (!config.onboarded || !config.autoStart || status.running || quitting) return;
  try {
    await start();
  } catch (error) {
    const reason = (error as Error).message;
    const { code, params } = coded(error);
    // The window puts the reason, in its language, into its own sentence (err.autoStart).
    emit({
      message: `Automatic start not possible yet: ${reason} Retrying in 30 seconds.`,
      code: 'autoStart',
      params: { ...params, cause: code, reason },
    });
    autoStartTimer = setTimeout(() => void autoStart(), 30_000);
  }
}
async function launch() {
  clearTimeout(autoStartTimer);
  if (!config.folder)
    throw new CodedError('launch.noFolder', 'Choose your NVIDIA recording folder first.');
  if (working) throw new CodedError('launch.working', 'The current step is still finishing.');
  const response = await fetch(`${config.server}/api/status`, {
    headers: config.token ? { Authorization: `Bearer ${config.token}` } : {},
    signal: AbortSignal.timeout(10000),
  }).catch(() => {
    const host = new URL(config.server).host;
    throw new CodedError('launch.unreachable', `The archive server at ${host} is not reachable.`, {
      host,
    });
  });
  if (response.status === 401 || response.status === 403)
    throw new CodedError(
      'launch.rejected',
      'The server rejected this PC. Pair it again under Settings.',
    );
  if (!response.ok)
    throw new CodedError(
      'server.http',
      `The archive server answered with HTTP ${response.status}.`,
      { status: response.status },
    );
  await checkServerVersion((await response.json().catch(() => ({}))) as { version?: string });
  if (config.analyze) {
    const ai = await checkOllama(OLLAMA_URL, config.model);
    if (!ai.supported)
      throw new CodedError(
        'launch.ollamaBroken',
        `Ollama ${ai.version} gives unusable answers. Click Install Ollama under Settings → Local AI to install ${OLLAMA_SETUP.version}.`,
        { version: String(ai.version), pinned: OLLAMA_SETUP.version },
      );
    if (!ai.installed)
      throw new CodedError('launch.noModel', 'Install Ollama and download the local model first.');
    // Otherwise the option would silently do nothing: every clip would come back without a map.
    const problem = config.r6Texts ? await textsProblem() : undefined;
    if (problem) throw problem;
    // The first time, this downloads the speech models; without them the option would do nothing.
    if (config.speech)
      await speechProcess()
        .prepare((file) =>
          emit({
            message: `Downloading speech model (${file}, about ${Math.round(SPEECH_BYTES / 1e6)} MB in total) …`,
          }),
        )
        .catch((error: unknown) => {
          const detail = error instanceof Error ? error.message : String(error);
          throw new CodedError('launch.speech', `Speech recognition cannot be loaded: ${detail}`, {
            detail,
          });
        });
  }
  aborter = new AbortController();
  paused = false;
  // The foreground is always watched: it also names the game of clips from "Desktop".
  watchGames();
  const processor = media();
  const replays =
    config.analyze && config.fortniteReplays && defaultDemosFolder()
      ? new FortniteReplays({ folder: defaultDemosFolder(), accounts: config.epicAccounts })
      : undefined;
  const reading = config.analyze && config.r6Texts ? textsWorker() : undefined;
  // Without the option the worker frees its models.
  if (!reading) void closeTexts();
  const listening = config.analyze && config.speech ? speechProcess() : undefined;
  if (!listening) closeSpeech();
  const analyzer = new LocalAnalyzer({
    url: OLLAMA_URL,
    model: config.model,
    frames: config.frames || 24,
    ...(config.frames === 0 ? { spacing: FRAME_SPACING } : {}),
    cacheDir: join(root(), 'cache'),
    media: processor,
    isPaused: waiting,
    signal: aborter.signal,
    playerNames: config.playerNames,
    language: config.titleLanguage,
    ...(replays
      ? {
          replays: (path: string, game: string, duration: number) =>
            replays.forClip(path, game, duration),
        }
      : {}),
    ...(reading
      ? {
          texts: (path: string, game: string, signal: AbortSignal, names: readonly string[]) =>
            reading.forClip(path, game, signal, names),
        }
      : {}),
    ...(listening
      ? {
          speech: (path: string, signal: AbortSignal) => listening.transcribe(path, signal),
        }
      : {}),
    onProgress: showProgress,
  });
  const stateName = createHash('sha256')
    .update(`${resolve(config.folder)}:${config.server}`)
    .digest('hex')
    .slice(0, 20);
  agent = new FolderUploader({
    folder: config.folder,
    server: config.server,
    token: config.token,
    statePath: join(root(), 'queues', `${stateName}.json`),
    game: config.game,
    includeExisting: config.includeExisting,
    stableMs: 10000,
    probe: (path) => processor.probe(path),
    ...(config.analyze
      ? { analyze: (path: string, game: string) => analyzer.analyze(path, game) }
      : {}),
    isPaused: waiting,
    signal: aborter.signal,
    onStatus: (message) => emit({ message }),
    onQueued: (queued) => emit({ queued }),
    gameFor: (_path, savedAt) => watch?.gameAt(savedAt),
    onQueue: showQueue,
    onUploaded: (_path, game, savedAt) => {
      if (config.keepR6Replays && isR6(game)) void keepR6Match(savedAt);
      const clip = agent?.recent[0];
      emit({ recent: agent?.recent ?? [] });
      if (clip && config.notify && !gaming && Notification.isSupported()) {
        const note = new Notification({
          title: 'Clip archived',
          body: `${clip.title ?? clip.name} · ${clip.game}`,
          icon: join(__dirname, 'icon.png'),
          silent: true,
        });
        note.on('click', () => void openArchive(`/clips/${clip.clipId}`));
        note.show();
      }
    },
  });
  await agent.initialize();
  emit({ recent: agent.recent });
  if (loop) clearInterval(loop);
  loop = setInterval(() => void tick(), 3000);
  emit({
    running: true,
    message: 'Ready. New recordings are processed after 10 seconds without changes.',
  });
  void tick();
}
function watchGames() {
  watch ??= new GameWatch((game) => {
    if (!config.pauseWhileGaming && !gaming) return;
    gaming = config.pauseWhileGaming ? gameTitle(game) : '';
    emit({
      gaming,
      message: game
        ? `Game running (${gaming}). Analysis and upload wait until you have stopped playing for a minute.`
        : 'No game in the foreground anymore. The queue continues.',
    });
    if (!game) void tick();
  });
  watch.start();
}
function stopWatchingGames() {
  watch?.stop();
  watch = undefined;
  gaming = '';
}
function pause() {
  paused = true;
  // A pause by hand also ends waiting for an automatic start.
  clearTimeout(autoStartTimer);
  if (PREVIEW) return emit({ message: 'Preview: paused.' });
  stopWatchingGames();
  aborter.abort();
  emit({
    message: 'Paused. New clips stay in the queue; running AI requests are cancelled.',
  });
}
async function createWindow() {
  window = new BrowserWindow({
    width: 1040,
    height: 790,
    minWidth: 800,
    minHeight: 680,
    backgroundColor: '#0e1015',
    show: false,
    title: 'ReplayHaven Client',
    icon: join(__dirname, 'icon.png'),
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  await window.loadFile(join(__dirname, 'renderer', 'index.html'));
  if (!process.env.REPLAYHAVEN_SMOKE && !process.argv.includes('--hidden')) window.show();
  window.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      window.hide();
    }
  });
  tray = new Tray(nativeImage.createFromPath(join(__dirname, 'icon.png')));
  updateShell();
  tray.on('double-click', () => showWindow());
}
/**
 * Sample data for UI tests (REPLAYHAVEN_PREVIEW=1, "wizard" for the setup wizard).
 * Starts neither watcher nor AI and touches no folder and no server.
 */
function startPreview() {
  const now = Date.now();
  const clip = (
    name: string,
    game: string,
    minutes: number,
    extra: Partial<QueueEntry> = {},
  ): QueueEntry => ({
    path: `C:/Preview/${game}/${name}`,
    name,
    game,
    size: 180e6 + minutes * 3e6,
    savedAt: now - minutes * 60000,
    state: 'waiting',
    ...extra,
  });
  if (PREVIEW === 'wizard') config.onboarded = false;
  else config = { ...config, onboarded: true, folder: 'C:/Preview', token: 'preview' };
  const queue = [
    clip(
      "Tom Clancy's Rainbow Six Siege 2026.09.25 - 21.14.02.03.DVR.mp4",
      "Tom Clancy's Rainbow Six Siege",
      12,
    ),
    clip('Valorant 2026.09.25 - 21.20.44.01.DVR.mp4', 'Valorant', 6),
    clip('Fortnite 2026.09.25 - 21.31.09.02.DVR.mp4', 'Fortnite', 2, {
      state: 'deferred',
      note: 'The match is still running; the replay comes afterwards.',
    }),
    clip('Desktop 2026.09.25 - 21.33.50.01.DVR.mp4', 'Desktop', 1, { state: 'settling' }),
  ];
  const recent: ArchivedClip[] = [
    {
      name: 'a.mp4',
      game: "Tom Clancy's Rainbow Six Siege",
      title: 'Triple kill on Oregon',
      tags: ['Kill', 'Multikill', 'Headshot'],
      clipId: 'preview-1',
      at: now - 4 * 60000,
      seconds: 71,
    },
    {
      name: 'b.mp4',
      game: 'Valorant',
      title: 'Two headshots, then killed',
      tags: ['Kill', 'Multikill', 'Headshot', 'Death'],
      clipId: 'preview-2',
      at: now - 19 * 60000,
      seconds: 80,
    },
    {
      name: 'c.mp4',
      game: 'Fortnite',
      title: 'Who is Obi-Wan Kenobi?',
      tags: [],
      clipId: 'preview-3',
      at: now - 3600_000,
      seconds: 96,
    },
    {
      name: 'd.mp4',
      game: 'Chained Together',
      title: 'Sorry for the friendly fire',
      tags: [],
      clipId: 'preview-4',
      at: now - 26 * 3600_000,
      seconds: 74,
    },
  ];
  paused = PREVIEW === 'paused';
  emit({
    running: PREVIEW !== 'wizard',
    ollama: true,
    model: true,
    uploaded: 214,
    queued: queue.length + 1,
    queue,
    recent,
    message: 'Local AI is reviewing section 7 of 11 …',
    active: {
      ...clip(
        "Tom Clancy's Rainbow Six Siege 2026.09.25 - 21.02.17.02.DVR.mp4",
        "Tom Clancy's Rainbow Six Siege",
        25,
      ),
      stage: 'analyzing',
      since: now - 38000,
      step: 'view',
      current: 7,
      total: 11,
      thumbnail: '',
    },
    ...(PREVIEW === 'gaming' ? { gaming: 'RainbowSix' } : {}),
  });
  if (PREVIEW === 'gaming') gaming = 'RainbowSix';
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_event, argv) => {
    if (window) showWindow();
    const link = linkIn(argv);
    if (link) void pairByLink(link, { confirm: true }).catch(() => {});
  });
  app
    .whenReady()
    .then(async () => {
      await loadConfig();
      const handle = (name: string, fn: (value: unknown) => unknown) =>
        ipcMain.handle(name, async (event, value) => {
          if (event.sender !== window.webContents) throw new Error('Invalid caller.');
          try {
            return { ok: true, value: await fn(value) };
          } catch (error) {
            return {
              ok: false,
              error: error instanceof Error ? error.message : 'Action failed.',
              // The window translates coded errors and falls back to the message.
              ...(error instanceof CodedError ? { code: error.code, params: error.params } : {}),
            };
          }
        });
      // The smoke test checks whether ONNX Runtime and the models load in the built client.
      const texts = process.env.REPLAYHAVEN_SMOKE
        ? textsProblem().then((problem) => problem?.message ?? 'ready')
        : undefined;
      handle('vault:load', async () => ({
        config: publicConfig(),
        status,
        ...(texts ? { texts: await texts } : {}),
      }));
      handle('vault:save', saveConfig);
      handle('vault:folder', async () => {
        const result = await dialog.showOpenDialog(window, {
          properties: ['openDirectory'],
          title: 'Choose NVIDIA recordings folder',
        });
        if (result.canceled) return null;
        pickedFolder = result.filePaths[0];
        return pickedFolder;
      });
      // Only folders the user chose personally — no paths from the window.
      handle('vault:games', async () => {
        const folder = pickedFolder || config.folder;
        return folder ? await recordedGames(folder).catch(() => []) : [];
      });
      handle('vault:start', () => start());
      handle('vault:pause', () => pause());
      // The wizard asks about the model it shows before the settings are saved.
      const modelOf = (value: unknown) => z.enum(MODELS).catch(config.model).parse(value);
      handle('vault:check', async (value) => {
        const result = await checkOllama(OLLAMA_URL, modelOf(value));
        // A broken version counts as missing, so the window offers to install the pinned one.
        if (!result.supported) {
          emit({
            ollama: false,
            model: false,
            message: `Ollama ${result.version} gives unusable answers. Install Ollama ${OLLAMA_SETUP.version} instead.`,
          });
          return { ...result, running: false };
        }
        emit({
          ollama: true,
          model: result.installed,
          message: result.installed
            ? 'Local AI model is ready.'
            : 'Ollama is running. Now download the model.',
        });
        return result;
      });
      handle('vault:download', async (value) => {
        if (status.downloading) throw new Error('The model download is already running.');
        if (working) throw new Error('Pause processing first.');
        downloadAbort = new AbortController();
        emit({ downloading: true });
        try {
          await pullModel((message) => emit({ message }), downloadAbort.signal, modelOf(value));
          emit({
            model: true,
            ollama: true,
            message: 'Local model installed. You can start now.',
          });
        } finally {
          emit({ downloading: false });
        }
      });
      handle('vault:cancel-download', () => downloadAbort?.abort());
      handle('vault:ollama-install', async () => {
        if (status.downloading) throw new Error('A download is already running.');
        downloadAbort = new AbortController();
        emit({ downloading: true });
        try {
          await installOllama(
            join(root(), 'cache'),
            (message) => emit({ message }),
            downloadAbort.signal,
          );
          emit({ ollama: true, message: 'Ollama is installed. Now download the model.' });
        } finally {
          emit({ downloading: false });
        }
      });
      handle('vault:archive', () => openArchive());
      handle('vault:open-clip', (id) => {
        if (typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id)) throw new Error('Invalid clip.');
        return openArchive(`/clips/${id}`);
      });
      // Only recordings the client shows itself — no arbitrary paths from the window.
      handle('vault:reveal', (path) => {
        const known = [...status.queue.map((e) => e.path), status.active?.path];
        if (typeof path !== 'string' || !known.includes(path))
          throw new Error('Unknown recording.');
        shell.showItemInFolder(path);
      });
      handle('vault:test-server', async (value) => {
        const { server, token } = z.object({ server: z.string(), token: z.string() }).parse(value);
        const url = validateServer(server);
        const key = token || (url === config.server ? config.token : '');
        const headers = key ? { Authorization: `Bearer ${key}` } : undefined;
        let response: Response;
        try {
          response = await fetch(`${url}/api/status`, {
            headers,
            signal: AbortSignal.timeout(8000),
          });
        } catch {
          throw new CodedError(
            'test.noResponse',
            'No response. Check address and port and whether the server is running.',
          );
        }
        if (response.status === 401 || response.status === 403)
          throw new CodedError('test.rejected', 'The server responds but rejects the access key.');
        if (!response.ok)
          throw new CodedError('server.http', `The server responds with HTTP ${response.status}.`, {
            status: response.status,
          });
        const clips = await fetch(`${url}/api/clips`, {
          headers,
          signal: AbortSignal.timeout(8000),
        })
          .then((r) => (r.ok ? r.json() : []))
          .catch(() => []);
        const list = Array.isArray(clips) ? clips : ((clips as { clips?: unknown[] }).clips ?? []);
        return { clips: list.length };
      });
      handle('vault:folder-info', async () => {
        const folder = pickedFolder || config.folder;
        if (!folder) return { clips: 0, games: [] };
        const videos = await listVideos(folder).catch(() => [] as string[]);
        const games = new Map<string, number>();
        for (const video of videos) {
          const game = gameLabel('', video);
          games.set(game, (games.get(game) ?? 0) + 1);
        }
        return {
          clips: videos.length,
          games: [...games]
            .map(([game, clips]) => ({ game, clips }))
            .sort((a, b) => b.clips - a.clips),
        };
      });
      handle('vault:pair-start', (value) => {
        if (typeof value !== 'string' || !value.trim())
          throw new CodedError('pair.noAddress', 'Enter the server address.');
        return startPairing(value.trim());
      });
      handle('vault:pair-cancel', () => {
        pairingAbort?.abort();
        emit({ pairing: null });
      });
      // The update comes from the project's release page for the version the server runs, never
      // from an address the server names: a compromised server could otherwise hand out any
      // program (desktop/update.ts). The page lists SHA256SUMS.txt and the build attestation.
      handle('vault:download-update', () => shell.openExternal(releasePage(status.update)));
      // Opens the devices page of the server where the approval is waiting.
      handle('vault:open-devices', () => {
        const server = status.pairing?.server ?? config.server;
        return shell.openExternal(`${validateServer(server)}/settings/pcs`);
      });
      handle('vault:discover', () => discoverServers());
      handle('vault:open-at-login', (value) => {
        if (app.isPackaged)
          app.setLoginItemSettings({ openAtLogin: value === true, args: ['--hidden'] });
      });
      // The preview sets its data before the window asks for it.
      if (PREVIEW) startPreview();
      await createWindow();
      // Windows opens replayhaven:// links with this app (per user, no admin rights needed).
      if (!PREVIEW && !process.env.REPLAYHAVEN_PROFILE)
        app.setAsDefaultProtocolClient(
          PAIRING_SCHEME,
          process.execPath,
          app.isPackaged ? [] : [resolve(process.argv[1] ?? '.')],
        );
      const link = linkIn(process.argv);
      if (PREVIEW) emit();
      else if (link) {
        showWindow();
        void pairByLink(link, { confirm: true }).catch(() => {});
      } else if (config.onboarded && config.autoStart) void autoStart();
    })
    .catch((error) => {
      console.error(error.message);
      app.quit();
    });
  app.on('before-quit', (event) => {
    quitting = true;
    paused = true;
    stopWatchingGames();
    aborter.abort();
    downloadAbort?.abort();
    if (loop) clearInterval(loop);
    // Ended in the middle of a frame, ONNX Runtime would take the whole process down: let the
    // worker stop first, then quit.
    closeSpeech();
    const closing = closeTexts();
    if (closing) {
      event.preventDefault();
      void closing.finally(() => app.quit());
    }
  });
}
