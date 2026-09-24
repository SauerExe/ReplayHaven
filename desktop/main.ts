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
} from 'electron';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { FolderUploader, recordedGames } from '../agent/watcher';
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
import { WorkerTexts } from '../agent/r6';
import { MediaProcessor } from '../server/media';

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
};
let window: BrowserWindow;
let tray: Tray;
let quitting = false;
let agent: FolderUploader | undefined;
let loop: ReturnType<typeof setInterval> | undefined;
let working = false;
let starting = false;
let paused = true;
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
};
const root = () => app.getPath('userData');
function emit(patch: Partial<typeof status> = {}) {
  status = { ...status, ...patch, paused, uploaded: agent?.state.uploaded || status.uploaded };
  window?.webContents.send('vault:status', status);
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
  await mkdir(root(), { recursive: true });
  const encryptedToken = config.token
    ? safeStorage.encryptString(config.token).toString('base64')
    : '';
  await writeFile(
    join(root(), 'preferences.json'),
    JSON.stringify({ ...config, token: undefined, encryptedToken }, null, 2),
  );
  emit({ message: 'Einstellungen gespeichert. Bereit zum Starten.' });
  return publicConfig();
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
function media() {
  const binaries = resource('binaries');
  return new MediaProcessor({
    ffmpeg: join(binaries, 'ffmpeg.exe'),
    ffprobe: join(binaries, 'ffprobe.exe'),
  });
}
async function tick() {
  if (working || !agent) return;
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
  }
  aborter = new AbortController();
  paused = false;
  const processor = media();
  const replays =
    config.analyze && config.fortniteReplays && defaultDemosFolder()
      ? new FortniteReplays({ folder: defaultDemosFolder(), accounts: config.epicAccounts })
      : undefined;
  const reading = config.analyze && config.r6Texts ? textsWorker() : undefined;
  // Ohne die Option gibt der Worker seine Modelle frei.
  if (!reading) void closeTexts();
  const analyzer = new LocalAnalyzer({
    url: OLLAMA_URL,
    model: DEFAULT_MODEL,
    frames: config.frames || 24,
    ...(config.frames === 0 ? { spacing: FRAME_SPACING } : {}),
    cacheDir: join(root(), 'cache'),
    media: processor,
    isPaused: () => paused,
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
    onProgress: (message) => emit({ message }),
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
    isPaused: () => paused,
    signal: aborter.signal,
    onStatus: (message) => emit({ message }),
    onQueued: (queued) => emit({ queued }),
  });
  await agent.initialize();
  if (loop) clearInterval(loop);
  loop = setInterval(() => void tick(), 3000);
  emit({
    running: true,
    message: 'Bereit. Neue Aufnahmen werden nach 10 Sekunden ohne Änderungen verarbeitet.',
  });
  void tick();
}
function pause() {
  paused = true;
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
  if (!process.env.REPLAYHAVEN_SMOKE) window.show();
  window.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      window.hide();
    }
  });
  tray = new Tray(nativeImage.createFromPath(join(__dirname, 'icon.png')));
  tray.setToolTip('ReplayHaven · Aufnahme-Client');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'ReplayHaven öffnen', click: () => window.show() },
      { label: 'Analyse pausieren', click: pause },
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
  tray.on('double-click', () => window.show());
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    window?.show();
    window?.focus();
  });
  app
    .whenReady()
    .then(async () => {
      try {
        const saved = JSON.parse(await readFile(join(root(), 'preferences.json'), 'utf8'));
        config = configSchema.parse({
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
      handle('vault:archive', () => shell.openExternal(validateServer(config.server)));
      await createWindow();
    })
    .catch((error) => {
      console.error(error.message);
      app.quit();
    });
  app.on('before-quit', (event) => {
    quitting = true;
    paused = true;
    aborter.abort();
    downloadAbort?.abort();
    if (loop) clearInterval(loop);
    // Mitten in einem Bild beendet, risse ONNX Runtime den ganzen Prozess mit: erst den Worker
    // anhalten lassen, dann beenden.
    const closing = closeTexts();
    if (closing) {
      event.preventDefault();
      void closing.finally(() => app.quit());
    }
  });
}
