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
  // Ohne eigenen Namen kann die KI Kills und Punktestände der falschen Seite zuordnen. Je Spiel
  // ein eigener Name; ein Eintrag ohne Spiel gilt überall (agent/players.ts).
  playerNames: playerNamesSchema.default([]),
  includeExisting: z.boolean(),
  analyze: z.boolean(),
  /** 0: ganzer Clip, ein Bild alle FRAME_SPACING Sekunden. */
  frames: z.union([z.literal(24), z.literal(48), z.literal(0)]),
  // Kills, Waffe und Entfernung aus den Fortnite-Replays (agent/fortnite.ts). Aus, bis gemessen.
  fortniteReplays: z.boolean().default(false),
  // Eigene Epic-Konto-IDs; leer: Der Client erkennt das Konto aus den Replays selbst.
  epicAccounts: z.array(z.string()).max(10).default([]),
  // Karte und Rundenausgang in R6 per Texterkennung (agent/r6.ts), etwa eine Minute CPU je Clip;
  // in Valorant der Killfeed (agent/valorant.ts), sofern ein eigener Name eingetragen ist.
  r6Texts: z.boolean().default(false),
  // Voice-Chat mitschreiben (agent/parakeet.ts): Parakeet auf der CPU, Modelle einmalig ~670 MB.
  speech: z.boolean().default(false),
  // Solange ein Spiel im Vollbild läuft, warten Analyse und Upload (agent/gaming.ts).
  pauseWhileGaming: z.boolean().default(true),
  // Das R6-Match zu jedem R6-Clip sichern (agent/r6-replays.ts), rund 30 MB je Match.
  keepR6Replays: z.boolean().default(true),
  // Einrichtung abgeschlossen: danach zeigt das Fenster die Übersicht statt des Assistenten.
  onboarded: z.boolean().default(false),
  // Beim Öffnen des Clients gleich weiterarbeiten, statt auf „Starten“ zu warten.
  autoStart: z.boolean().default(true),
  // Mit Windows starten, im Infobereich.
  openAtLogin: z.boolean().default(false),
  // Windows-Mitteilung, wenn ein Clip archiviert ist (nie während eines Spiels).
  notify: z.boolean().default(true),
  // Feste Kennung dieses PCs für die Kopplung mit dem Server.
  deviceId: z.string().uuid().optional(),
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
};
// Ein eigenes Profil (Einstellungen, Warteschlange, Einzelinstanz) für Tests neben einem
// laufenden Client; der Vorschau-Modus zeigt Beispieldaten und startet nichts.
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
/** Das Spiel im Vordergrund, solange eins läuft; leer sonst. */
let gaming = '';
let watch: GameWatch | undefined;
/** Ob Warteschlange und KI gerade warten: von Hand pausiert oder beim Spielen. */
const waiting = () => paused || !!gaming;
let aborter = new AbortController();
let downloadAbort: AbortController | undefined;
/** Zuletzt im Dialog gewählter Ordner, auch wenn er noch nicht gespeichert ist. */
let pickedFolder = '';
let status = {
  running: false,
  paused: true,
  message: 'Wähle deinen Aufnahmeordner und verbinde deinen Archiv-Server.',
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
/** Stand einer Kopplung: Der PC wartet, bis jemand in der Web-Oberfläche freigibt. */
type Pairing = {
  state: 'waiting' | 'approved' | 'denied' | 'expired' | 'error';
  server: string;
  code: string;
  message: string;
};
/** Die Aufnahme in Arbeit mit Schritt, Fortschritt und Vorschaubild für das Fenster. */
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
/** Taskleisten-Fortschritt, Tray-Hinweis und Tray-Menü folgen dem Status. */
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
  const state = !status.running ? 'aus' : gaming ? 'spiel' : paused ? 'pause' : 'läuft';
  tray.setToolTip(
    `ReplayHaven · ${
      state === 'aus'
        ? 'nicht gestartet'
        : state === 'spiel'
          ? `wartet, ${gaming} läuft`
          : state === 'pause'
            ? 'pausiert'
            : a
              ? `analysiert ${a.name}`
              : 'bereit'
    }${status.queue.length ? ` · ${status.queue.length} in der Warteschlange` : ''}`,
  );
  if (state === trayState) return;
  trayState = state;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'ReplayHaven öffnen', click: () => showWindow() },
      state === 'läuft' || state === 'spiel'
        ? { label: 'Pausieren', click: pause }
        : {
            label: status.running ? 'Fortsetzen' : 'Starten',
            enabled: config.onboarded,
            click: () => void start().catch((e: Error) => emit({ message: e.message })),
          },
      { label: 'Archiv im Browser öffnen', click: () => void openArchive() },
      { type: 'separator' },
      {
        label: 'Beenden',
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
/** Ein kleines Standbild aus dem Clip, als data-URL für das Fenster; leer, wenn es scheitert. */
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
        // Kürzere Clips haben bei drei Sekunden kein Bild mehr.
        if (seconds > 0) return void thumbnail(path, 0).then(done);
        done('');
      },
    ),
  );
}
/** Übernimmt Warteschlange und aktuelle Aufnahme vom Watcher. */
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
/** Liest aus den Meldungen der Analyse, wie weit sie ist. */
function showProgress(message: string) {
  const a = status.active;
  if (!a) return emit({ message });
  const view = /Abschnitt (\d+) von (\d+)/.exec(message);
  const step = view
    ? 'view'
    : /zusammengefasst|überarbeitet/.test(message)
      ? 'summary'
      : /vorbereitet/.test(message)
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
    throw new Error('Verwende eine Serveradresse ohne eingebettete Zugangsdaten.');
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
      'Eine Epic-Konto-ID hat 32 Zeichen aus 0–9 und a–f. Du findest sie auf epicgames.com in deinen Kontoeinstellungen.',
    );
  if (working)
    throw new Error('Pausiere den Client und warte, bis der laufende Schritt beendet ist.');
  if (status.running && !paused)
    throw new Error('Pausiere den Client, bevor du Einstellungen änderst.');
  if (input.token === '') input.token = config.token;
  if (input.token && !safeStorage.isEncryptionAvailable())
    throw new Error('Windows kann den Zugangsschlüssel gerade nicht verschlüsselt speichern.');
  config = input;
  if (app.isPackaged && !PREVIEW)
    app.setLoginItemSettings({ openAtLogin: config.openAtLogin, args: ['--hidden'] });
  if (PREVIEW) {
    emit({ message: 'Vorschau: Einstellungen übernommen, nicht gespeichert.' });
    return publicConfig();
  }
  await persist();
  emit({ message: 'Einstellungen gespeichert. Bereit zum Starten.' });
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
 * Koppelt diesen PC mit einem Server: Er fragt an, zeigt den Code und wartet, bis jemand in
 * der Web-Oberfläche freigibt; dann speichert er seinen eigenen Zugang (server/auth-routes.ts).
 */
let pairingAbort: AbortController | undefined;
async function startPairing(address: string) {
  // Ohne Schema: Rechnernamen, IPs und Adressen mit Port meist per http, Domains per https.
  const local = /^(?:localhost|\d+\.\d+\.\d+\.\d+|[^./:]+(?::\d+)?$|[^/]+:\d+)/.test(address);
  const server = validateServer(
    address.includes('://')
      ? address
      : `${local && !address.endsWith(':443') ? 'http' : 'https'}://${address}`,
  );
  if (working || (status.running && !paused))
    throw new Error('Pausiere den Client, bevor du ihn neu koppelst.');
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
    throw new Error('Keine Antwort. Prüfe die Adresse und ob der Server läuft.');
  }
  if (response.status === 404)
    throw new Error(
      'Dieser Server kennt die Kopplung noch nicht. Aktualisiere ihn oder verbinde mit dem Zugangsschlüssel.',
    );
  const body = (await response.json().catch(() => ({}))) as {
    id?: string;
    secret?: string;
    code?: string;
    error?: string;
  };
  if (!response.ok || !body.id || !body.secret || !body.code)
    throw new Error(body.error || `Der Server antwortet mit HTTP ${response.status}.`);
  const show = (state: Pairing['state'], message: string) =>
    emit({ pairing: { state, server, code: body.code!, message } });
  show('waiting', 'Wartet auf Freigabe in der Web-Oberfläche …');
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
          return show('approved', `Gekoppelt mit ${new URL(server).host}.`);
        }
        if (result.status === 'denied') return show('denied', 'Die Kopplung wurde abgelehnt.');
        if (result.status === 'expired')
          return show('expired', 'Die Anfrage ist abgelaufen. Starte die Kopplung neu.');
      } catch {
        // Kurz nicht erreichbar: weiter fragen, bis die Anfrage abläuft.
      }
    }
    if (!abort.signal.aborted)
      show('expired', 'Die Anfrage ist abgelaufen. Starte die Kopplung neu.');
  })();
  return { code: body.code, server };
}
/** Mitgelieferte Dateien neben dem App-Archiv: FFmpeg, ONNX Runtime, Texterkennungsmodelle. */
function resource(name: string) {
  return app.isPackaged ? join(process.resourcesPath, name) : resolve('desktop-bundle', name);
}
const ocrModels = () => ({
  det: join(resource('ocr'), 'ch_PP-OCRv4_det_infer.onnx'),
  // Lesen mit PP-OCRv5 lateinisch (agent/ocr-models.json), vom Build geladen und geprüft.
  rec: join(resource('ocr'), LATIN_REC.file!),
  keys: join(resource('ocr'), LATIN_KEYS.file!),
});
/** Die Texterkennung läuft in einem eigenen Thread und bleibt über Starts hinweg geladen. */
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
/** Beendet den Worker der Texterkennung, ohne ihn mitten in einem Bild abzubrechen. */
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
 * Lädt die Texterkennung einmal zur Probe: vor dem Start mit R6-Option und im Rauchtest des
 * fertigen Clients. Gibt nichts zurück, wenn sie bereit ist, sonst einen Hinweis zum Beheben.
 */
async function textsProblem() {
  const error = await textsWorker().problem();
  if (!error) return undefined;
  const message = error.message.trim() || 'unbekannt';
  return missingLibrary(error)
    ? `Die R6-Texterkennung braucht die „Microsoft Visual C++ Redistributable“ (x64) in einer aktuellen Fassung. Installiere sie von Microsoft oder schalte die Option aus. (${message})`
    : `Die R6-Texterkennung lässt sich nicht laden: ${message}`;
}
/** Die Spracherkennung läuft in einem eigenen Prozess und behält ihre Modelle über Starts. */
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
/** R6-Clips, deren Match beim Sichern womöglich noch lief; sie werden später vervollständigt. */
const runningMatches = new Set<number>();
let lastMatchSync = 0;
async function keepR6Match(savedAt: number) {
  try {
    const kept = await keepMatchForClip(savedAt);
    if (kept?.running) runningMatches.add(savedAt);
    else runningMatches.delete(savedAt);
  } catch (error) {
    // Das Sichern ist eine Zugabe; der Clip ist hochgeladen.
    runningMatches.delete(savedAt);
    console.error('R6-Match nicht gesichert:', error instanceof Error ? error.message : error);
  }
}
let lastScan = 0;
async function tick() {
  if (!waiting() && runningMatches.size && Date.now() - lastMatchSync > 60_000) {
    lastMatchSync = Date.now();
    for (const savedAt of runningMatches) await keepR6Match(savedAt);
  }
  if (working || !agent) return;
  // Beim Spielen oder in der Pause genügt ein Blick alle 30 Sekunden: Neue Clips kommen in die
  // Warteschlange, ohne im Spiel Platte und Leitung alle 3 Sekunden zu beschäftigen.
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
          : 'Server oder Ordner nicht erreichbar. Nächster Versuch folgt automatisch.',
    });
  } finally {
    working = false;
  }
}
async function start() {
  if (PREVIEW) {
    paused = false;
    return emit({ running: true, message: 'Vorschau: läuft.' });
  }
  // Die Prüfungen vor dem Start dauern; ein zweiter Klick startete sonst eine zweite Verarbeitung.
  if (starting) throw new Error('Der Start läuft bereits.');
  starting = true;
  try {
    await launch();
  } finally {
    starting = false;
  }
}
async function launch() {
  if (!config.folder) throw new Error('Wähle zuerst deinen NVIDIA-Aufnahmeordner.');
  if (working) throw new Error('Der laufende Schritt wird noch beendet.');
  const response = await fetch(`${config.server}/api/status`, {
    headers: config.token ? { Authorization: `Bearer ${config.token}` } : {},
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('Server nicht erreichbar oder Zugangsschlüssel falsch.');
  if (config.analyze) {
    const ai = await checkOllama();
    if (!ai.installed) throw new Error('Installiere zuerst Ollama und lade das lokale Modell.');
    // Sonst liefe die Option still ins Leere: Jeder Clip käme ohne Karte zurück.
    const problem = config.r6Texts ? await textsProblem() : undefined;
    if (problem) throw new Error(problem);
    // Beim ersten Mal lädt das die Sprachmodelle; ohne sie liefe die Option still ins Leere.
    if (config.speech)
      await speechProcess()
        .prepare((file) =>
          emit({
            message: `Sprachmodell wird geladen (${file}, zusammen rund ${Math.round(SPEECH_BYTES / 1e6)} MB) …`,
          }),
        )
        .catch((error: unknown) => {
          throw new Error(
            `Die Spracherkennung lässt sich nicht laden: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
  }
  aborter = new AbortController();
  paused = false;
  // Der Vordergrund wird immer beobachtet: Er nennt auch das Spiel von Clips aus "Desktop".
  watchGames();
  const processor = media();
  const replays =
    config.analyze && config.fortniteReplays && defaultDemosFolder()
      ? new FortniteReplays({ folder: defaultDemosFolder(), accounts: config.epicAccounts })
      : undefined;
  const reading = config.analyze && config.r6Texts ? textsWorker() : undefined;
  // Ohne die Option gibt der Worker seine Modelle frei.
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
          title: 'Clip archiviert',
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
    message: 'Bereit. Neue Aufnahmen werden nach 10 Sekunden ohne Änderungen verarbeitet.',
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
        ? `Spiel läuft (${gaming}). Analyse und Upload warten, bis du eine Minute nicht mehr spielst.`
        : 'Kein Spiel mehr im Vordergrund. Die Warteschlange läuft weiter.',
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
  if (PREVIEW) return emit({ message: 'Vorschau: pausiert.' });
  stopWatchingGames();
  aborter.abort();
  emit({
    message:
      'Pausiert. Neue Clips bleiben in der Warteschlange; laufende KI-Anfragen werden abgebrochen.',
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
 * Beispieldaten für Oberflächentests (REPLAYHAVEN_PREVIEW=1, "wizard" für den Assistenten).
 * Startet weder Watcher noch KI, fasst keinen Ordner und keinen Server an.
 */
function startPreview() {
  const now = Date.now();
  const clip = (
    name: string,
    game: string,
    minutes: number,
    extra: Partial<QueueEntry> = {},
  ): QueueEntry => ({
    path: `C:/Vorschau/${game}/${name}`,
    name,
    game,
    size: 180e6 + minutes * 3e6,
    savedAt: now - minutes * 60000,
    state: 'waiting',
    ...extra,
  });
  if (PREVIEW === 'wizard') config.onboarded = false;
  else config = { ...config, onboarded: true, folder: 'C:/Vorschau', token: 'vorschau' };
  const queue = [
    clip(
      "Tom Clancy's Rainbow Six Siege 2026.09.25 - 21.14.02.03.DVR.mp4",
      "Tom Clancy's Rainbow Six Siege",
      12,
    ),
    clip('Valorant 2026.09.25 - 21.20.44.01.DVR.mp4', 'Valorant', 6),
    clip('Fortnite 2026.09.25 - 21.31.09.02.DVR.mp4', 'Fortnite', 2, {
      state: 'deferred',
      note: 'Das Match läuft noch; das Replay kommt danach.',
    }),
    clip('Desktop 2026.09.25 - 21.33.50.01.DVR.mp4', 'Desktop', 1, { state: 'settling' }),
  ];
  const recent: ArchivedClip[] = [
    {
      name: 'a.mp4',
      game: "Tom Clancy's Rainbow Six Siege",
      title: 'Dreifach-Kill auf Oregon',
      tags: ['Kill', 'Multikill', 'Headshot'],
      clipId: 'vorschau-1',
      at: now - 4 * 60000,
      seconds: 71,
    },
    {
      name: 'b.mp4',
      game: 'Valorant',
      title: 'Zwei Kopfschüsse, dann getötet',
      tags: ['Kill', 'Multikill', 'Headshot', 'Tod'],
      clipId: 'vorschau-2',
      at: now - 19 * 60000,
      seconds: 80,
    },
    {
      name: 'c.mp4',
      game: 'Fortnite',
      title: 'Wer ist Obi-Wan Kenobi?',
      tags: [],
      clipId: 'vorschau-3',
      at: now - 3600_000,
      seconds: 96,
    },
    {
      name: 'd.mp4',
      game: 'Chained Together',
      title: 'Entschuldigung für den Falschschuss',
      tags: [],
      clipId: 'vorschau-4',
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
    message: 'Lokale KI sichtet Abschnitt 7 von 11 …',
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
          if (event.sender !== window.webContents) throw new Error('Ungültiger Aufrufer.');
          try {
            return { ok: true, value: await fn(value) };
          } catch (error) {
            return {
              ok: false,
              error: error instanceof Error ? error.message : 'Aktion fehlgeschlagen.',
            };
          }
        });
      // Der Rauchtest prüft, ob ONNX Runtime und die Modelle im fertigen Client laden.
      const texts = process.env.REPLAYHAVEN_SMOKE
        ? textsProblem().then((problem) => problem ?? 'bereit')
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
          title: 'NVIDIA-Aufnahmeordner auswählen',
        });
        if (result.canceled) return null;
        pickedFolder = result.filePaths[0];
        return pickedFolder;
      });
      // Nur Ordner, die der Nutzer selbst gewählt hat — keine Pfade aus dem Fenster.
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
            ? 'Lokales KI-Modell ist bereit.'
            : 'Ollama läuft. Lade jetzt das Modell.',
        });
        return result;
      });
      handle('vault:download', async () => {
        if (status.downloading) throw new Error('Der Modell-Download läuft bereits.');
        if (working) throw new Error('Pausiere zuerst die Verarbeitung.');
        downloadAbort = new AbortController();
        emit({ downloading: true });
        try {
          await pullModel((message) => emit({ message }), downloadAbort.signal);
          emit({
            model: true,
            ollama: true,
            message: 'Lokales Modell installiert. Du kannst jetzt starten.',
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
        if (typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id))
          throw new Error('Ungültiger Clip.');
        return openArchive(`/clips/${id}`);
      });
      // Nur Aufnahmen, die der Client selbst anzeigt — keine beliebigen Pfade aus dem Fenster.
      handle('vault:reveal', (path) => {
        const known = [...status.queue.map((e) => e.path), status.active?.path];
        if (typeof path !== 'string' || !known.includes(path))
          throw new Error('Unbekannte Aufnahme.');
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
          throw new Error('Keine Antwort. Prüfe Adresse und Port und ob der Server läuft.');
        }
        if (response.status === 401 || response.status === 403)
          throw new Error('Der Server antwortet, lehnt den Zugangsschlüssel aber ab.');
        if (!response.ok) throw new Error(`Der Server antwortet mit HTTP ${response.status}.`);
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
          throw new Error('Gib die Serveradresse ein.');
        return startPairing(value.trim());
      });
      handle('vault:pair-cancel', () => {
        pairingAbort?.abort();
        emit({ pairing: null });
      });
      // Öffnet die Geräteseite des Servers, auf dem die Freigabe wartet.
      handle('vault:open-devices', () => {
        const server = status.pairing?.server ?? config.server;
        return shell.openExternal(`${validateServer(server)}/devices`);
      });
      handle('vault:open-at-login', (value) => {
        if (app.isPackaged)
          app.setLoginItemSettings({ openAtLogin: value === true, args: ['--hidden'] });
      });
      // Die Vorschau setzt ihre Daten, bevor das Fenster sie abfragt.
      if (PREVIEW) startPreview();
      await createWindow();
      if (PREVIEW) emit();
      else if (config.onboarded && config.autoStart)
        void start().catch((error: Error) =>
          emit({ message: `Automatischer Start nicht möglich: ${error.message}` }),
        );
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
    // Mitten in einem Bild beendet, risse ONNX Runtime den ganzen Prozess mit: erst den Worker
    // anhalten lassen, dann beenden.
    closeSpeech();
    const closing = closeTexts();
    if (closing) {
      event.preventDefault();
      void closing.finally(() => app.quit());
    }
  });
}
