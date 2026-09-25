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
  DEFAULT_MODEL,
  FRAME_SPACING,
  OLLAMA_URL,
} from '../agent/ollama';
import { playerNamesSchema, savedPlayerNames, tidyPlayerNames } from '../agent/players';
import { defaultDemosFolder, FortniteReplays } from '../agent/fortnite';
import { LATIN_KEYS, LATIN_REC, missingLibrary } from '../agent/ocr';
import { isR6, WorkerTexts } from '../agent/r6';
import { MediaProcessor } from '../server/media';
import { SPEECH_BYTES, speechFolder } from '../agent/parakeet';
import { SpeechProcess } from './speech';
import { GameWatch, gameTitle } from '../agent/gaming';
import { keepMatchForClip } from '../agent/r6-replays';

const configSchema = z.object({
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
  // Language of the client window (desktop/renderer/i18n.js). Main-process messages stay English.
  language: z.enum(['en', 'de']).default('en'),
});
type ClientConfig = z.infer<typeof configSchema>;
let config: ClientConfig = {
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
};
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
};
/** State of a pairing: the PC waits until someone approves it in the web interface. */
type Pairing = {
  state: 'waiting' | 'approved' | 'denied' | 'expired' | 'error';
  server: string;
  code: string;
  message: string;
};
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
            click: () => void start().catch((e: Error) => emit({ message: e.message })),
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
function validateServer(value: string) {
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
async function saveConfig(value: unknown) {
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
  if (input.token === '') input.token = config.token;
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
  if (working) throw new Error('Pause the client and wait until the current step has finished.');
  if (status.running && !paused) throw new Error('Pause the client before changing settings.');
  if (input.token && !safeStorage.isEncryptionAvailable())
    throw new Error('Windows cannot store the access key encrypted right now.');
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
async function persist() {
  if (PREVIEW) return;
  await mkdir(root(), { recursive: true });
  const encryptedToken = config.token
    ? safeStorage.encryptString(config.token).toString('base64')
    : '';
  await writeFile(
    join(root(), 'preferences.json'),
    JSON.stringify({ ...config, token: undefined, encryptedToken }, null, 2),
  );
}
/**
 * Pairs this PC with a server: it sends a request, shows the code and waits until someone
 * approves it in the web interface; then it stores its own access (server/auth-routes.ts).
 */
let pairingAbort: AbortController | undefined;
async function startPairing(address: string) {
  // Without a scheme: host names, IPs and addresses with a port usually via http, domains via https.
  const local = /^(?:localhost|\d+\.\d+\.\d+\.\d+|[^./:]+(?::\d+)?$|[^/]+:\d+)/.test(address);
  const server = validateServer(
    address.includes('://')
      ? address
      : `${local && !address.endsWith(':443') ? 'http' : 'https'}://${address}`,
  );
  if (working || (status.running && !paused))
    throw new Error('Pause the client before pairing it again.');
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
    throw new Error('No response. Check the address and whether the server is running.');
  }
  if (response.status === 404)
    throw new Error(
      'This server does not support pairing yet. Update it or connect with the access key.',
    );
  const body = (await response.json().catch(() => ({}))) as {
    id?: string;
    secret?: string;
    code?: string;
    error?: string;
  };
  if (!response.ok || !body.id || !body.secret || !body.code)
    throw new Error(body.error || `The server responds with HTTP ${response.status}.`);
  const show = (state: Pairing['state'], message: string) =>
    emit({ pairing: { state, server, code: body.code!, message } });
  show('waiting', 'Waiting for approval in the web interface …');
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
          return show('approved', `Paired with ${new URL(server).host}.`);
        }
        if (result.status === 'denied') return show('denied', 'The pairing was denied.');
        if (result.status === 'expired')
          return show('expired', 'The request has expired. Start pairing again.');
      } catch {
        // Briefly unreachable: keep asking until the request expires.
      }
    }
    if (!abort.signal.aborted) show('expired', 'The request has expired. Start pairing again.');
  })();
  return { code: body.code, server };
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
  const message = error.message.trim() || 'unknown';
  return missingLibrary(error)
    ? `R6 text recognition needs a current version of the "Microsoft Visual C++ Redistributable" (x64). Install it from Microsoft or turn the option off. (${message})`
    : `R6 text recognition cannot be loaded: ${message}`;
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
  if (starting) throw new Error('Already starting.');
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
    emit({
      message: `Automatic start not possible yet: ${(error as Error).message} Retrying in 30 seconds.`,
    });
    autoStartTimer = setTimeout(() => void autoStart(), 30_000);
  }
}
async function launch() {
  clearTimeout(autoStartTimer);
  if (!config.folder) throw new Error('Choose your NVIDIA recording folder first.');
  if (working) throw new Error('The current step is still finishing.');
  const response = await fetch(`${config.server}/api/status`, {
    headers: config.token ? { Authorization: `Bearer ${config.token}` } : {},
    signal: AbortSignal.timeout(10000),
  }).catch(() => {
    throw new Error(`The archive server at ${new URL(config.server).host} is not reachable.`);
  });
  if (!response.ok)
    throw new Error(
      response.status === 401 || response.status === 403
        ? 'The server rejected this PC. Pair it again under Settings.'
        : `The archive server answered with HTTP ${response.status}.`,
    );
  if (config.analyze) {
    const ai = await checkOllama();
    if (!ai.installed) throw new Error('Install Ollama and download the local model first.');
    // Otherwise the option would silently do nothing: every clip would come back without a map.
    const problem = config.r6Texts ? await textsProblem() : undefined;
    if (problem) throw new Error(problem);
    // The first time, this downloads the speech models; without them the option would do nothing.
    if (config.speech)
      await speechProcess()
        .prepare((file) =>
          emit({
            message: `Downloading speech model (${file}, about ${Math.round(SPEECH_BYTES / 1e6)} MB in total) …`,
          }),
        )
        .catch((error: unknown) => {
          throw new Error(
            `Speech recognition cannot be loaded: ${error instanceof Error ? error.message : String(error)}`,
          );
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
    model: DEFAULT_MODEL,
    frames: config.frames || 24,
    ...(config.frames === 0 ? { spacing: FRAME_SPACING } : {}),
    cacheDir: join(root(), 'cache'),
    media: processor,
    isPaused: waiting,
    signal: aborter.signal,
    playerNames: config.playerNames,
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
  app.on('second-instance', () => {
    if (window) showWindow();
  });
  app
    .whenReady()
    .then(async () => {
      try {
        const saved = JSON.parse(await readFile(join(root(), 'preferences.json'), 'utf8'));
        config = configSchema.parse({
          onboarded: !!saved.folder,
          ...saved,
          playerNames: savedPlayerNames(saved),
          token: saved.encryptedToken
            ? safeStorage.decryptString(Buffer.from(saved.encryptedToken, 'base64'))
            : '',
        });
      } catch {
        /* First start, or a configuration belonging to another Windows account. */
      }
      const handle = (name: string, fn: (value: unknown) => unknown) =>
        ipcMain.handle(name, async (event, value) => {
          if (event.sender !== window.webContents) throw new Error('Invalid caller.');
          try {
            return { ok: true, value: await fn(value) };
          } catch (error) {
            return {
              ok: false,
              error: error instanceof Error ? error.message : 'Action failed.',
            };
          }
        });
      // The smoke test checks whether ONNX Runtime and the models load in the built client.
      const texts = process.env.REPLAYHAVEN_SMOKE
        ? textsProblem().then((problem) => problem ?? 'ready')
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
      handle('vault:check', async () => {
        const result = await checkOllama();
        emit({
          ollama: true,
          model: result.installed,
          message: result.installed
            ? 'Local AI model is ready.'
            : 'Ollama is running. Now download the model.',
        });
        return result;
      });
      handle('vault:download', async () => {
        if (status.downloading) throw new Error('The model download is already running.');
        if (working) throw new Error('Pause processing first.');
        downloadAbort = new AbortController();
        emit({ downloading: true });
        try {
          await pullModel((message) => emit({ message }), downloadAbort.signal);
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
      handle('vault:ollama-install', () =>
        shell.openExternal('https://ollama.com/download/windows'),
      );
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
          throw new Error('No response. Check address and port and whether the server is running.');
        }
        if (response.status === 401 || response.status === 403)
          throw new Error('The server responds but rejects the access key.');
        if (!response.ok) throw new Error(`The server responds with HTTP ${response.status}.`);
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
          throw new Error('Enter the server address.');
        return startPairing(value.trim());
      });
      handle('vault:pair-cancel', () => {
        pairingAbort?.abort();
        emit({ pairing: null });
      });
      // Opens the devices page of the server where the approval is waiting.
      handle('vault:open-devices', () => {
        const server = status.pairing?.server ?? config.server;
        return shell.openExternal(`${validateServer(server)}/devices`);
      });
      handle('vault:open-at-login', (value) => {
        if (app.isPackaged)
          app.setLoginItemSettings({ openAtLogin: value === true, args: ['--hidden'] });
      });
      // The preview sets its data before the window asks for it.
      if (PREVIEW) startPreview();
      await createWindow();
      if (PREVIEW) emit();
      else if (config.onboarded && config.autoStart) void autoStart();
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
