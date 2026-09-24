import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import ffmpeg from 'ffmpeg-static';
import sharp from 'sharp';

/**
 * Erzeugt die Bilder der README in docs/images: die Web-Bibliothek mit Beispieldaten und einem
 * nachgestellten Server, den Windows-Client und aus docs/images/src Banner, Social-Preview und
 * Architekturgrafik. Nach Änderungen an der Oberfläche einfach neu laufen lassen:
 * npm run readme:images
 */

const root = resolve(import.meta.dirname, '..');
const out = join(root, 'docs', 'images');
const port = 5199;
const base = `http://localhost:${port}`;
const now = Date.now();
const HOUR = 3600000;

function run(command, args) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let log = '';
    child.stderr.on('data', (text) => (log += text));
    child.on('error', fail);
    child.on('close', (code) =>
      code === 0 ? done() : fail(new Error(`${command} endete mit ${code}: ${log}`)),
    );
  });
}

/** Vite liefert App, Vorschau und die Vorlagen unter docs/images/src aus. */
async function startVite() {
  const vite = spawn(
    process.execPath,
    [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(port), '--strictPort'],
    { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] },
  );
  for (let i = 0; i < 120; i++) {
    if (
      await fetch(base).then(
        (r) => r.ok,
        () => false,
      )
    )
      return vite;
    await new Promise((r) => setTimeout(r, 250));
  }
  vite.kill();
  throw new Error(`Vite antwortet nicht auf ${base}.`);
}

/** Ein ruhiges Standbild als VP9-Video: Screenshots brauchen ein ladbares Video, keine Bewegung. */
async function demoVideo(folder) {
  const file = join(folder, 'demo.webm');
  await run(ffmpeg, [
    '-v',
    'error',
    '-y',
    '-loop',
    '1',
    '-i',
    join(root, 'public', 'media', 'cs2-4.webp'),
    '-t',
    '54',
    '-r',
    '6',
    '-vf',
    'scale=1280:720,format=yuv420p',
    '-c:v',
    'libvpx-vp9',
    '-deadline',
    'realtime',
    '-cpu-used',
    '8',
    '-b:v',
    '0',
    '-crf',
    '45',
    file,
  ]);
  return file;
}

const iso = (hoursAgo) => new Date(now - hoursAgo * HOUR).toISOString();

/** Beispiel-Clips, wie sie der Server nach Upload und Analyse durch den Client ausliefert. */
function demoClips() {
  const clip = (id, gameName, image, title, hoursAgo, duration, extra = {}) => {
    const tags = extra.tags ?? [];
    const description = extra.description ?? '';
    return {
      id,
      title,
      gameId: 'recording',
      gameName,
      thumbnail: `/media/${image}.webp`,
      videoSource: '/demo/clip.webm',
      duration,
      recordedAt: iso(hoursAgo),
      size: Math.round(duration * 0.82 * 1024 * 1024),
      resolution: '1080p',
      tags,
      favorite: !!extra.favorite,
      status: 'ready',
      note: '',
      server: true,
      description,
      deviceName: 'Gaming-PC',
      originalName: `${gameName} ${new Date(now - hoursAgo * HOUR).toISOString().slice(0, 10)}.mp4`,
      analysis: {
        status: 'ready',
        provider: 'client',
        model: 'qwen3-vl:8b',
        input: 'frames',
        updatedAt: iso(hoursAgo - 0.02),
        result: {
          title,
          description: description || `${title}.`,
          game: gameName,
          tags,
          confidence: extra.confidence ?? 'high',
          uncertainty: '',
          highlights: extra.highlights ?? [],
        },
      },
    };
  };
  return [
    clip('ace-inferno', 'Counter-Strike 2', 'cs2-4', 'Ace auf Inferno', 1.5, 54, {
      tags: ['Ace', 'Rundensieg', 'Inferno'],
      favorite: true,
      description:
        'Fünf Gegner in einer Runde, der letzte hinter den Fässern in der Gasse. Die Runde endet mit dem Rundensieg.',
      highlights: [
        { seconds: 12, title: 'Erster Kill', description: 'Am Eingang der Gasse.' },
        { seconds: 21, title: 'Doppel-Kill', description: 'Zwei Gegner kurz hintereinander.' },
        { seconds: 38, title: 'Triple Kill', description: 'Hinter den Fässern.' },
        { seconds: 47, title: 'Ace', description: 'Der fünfte Gegner der Runde.' },
        { seconds: 51, title: 'Rundensieg', description: 'Die Runde ist gewonnen.' },
      ],
    }),
    clip('apex-final', 'Apex Legends', 'apex-2', 'Champion mit dem letzten Schuss', 3, 51, {
      tags: ['Sieg', 'Teamplay'],
      description:
        'Der letzte Trupp fällt am Kraterrand, danach erscheint der Champion-Bildschirm.',
    }),
    clip('elden-boss', 'ELDEN RING', 'elden-1', 'Dieser Boss hatte andere Pläne', 5, 66, {
      tags: ['Bosskampf'],
      favorite: true,
      description: 'Ein langer Bosskampf mit knappem Ende.',
    }),
    clip('mirage-triple', 'Counter-Strike 2', 'cs2-2', 'Triple Kill auf Mirage', 7, 47, {
      tags: ['Triple Kill', 'Mirage'],
    }),
    clip('forza-drift', 'Forza Horizon 5', 'forza-2', 'Der sauberste Drift bisher', 26, 31, {
      tags: ['Drift'],
      favorite: true,
    }),
    clip('night-city', 'Cyberpunk 2077', 'cyberpunk-1', 'Nachts gehört uns die Stadt', 28, 58, {
      tags: ['Open World'],
    }),
    clip('apex-third', 'Apex Legends', 'apex-4', 'Dritter Trupp, keine Chance', 30, 43, {
      tags: ['Teamplay'],
    }),
    clip('clutch-inferno', 'Counter-Strike 2', 'cs2-1', 'Clutch 1 gegen 3 auf Inferno', 50, 58, {
      tags: ['Clutch', 'Inferno'],
      favorite: true,
    }),
    clip('elden-view', 'ELDEN RING', 'elden-3', 'Die Aussicht war es wert', 74, 31, {
      tags: ['Atmosphäre'],
    }),
    clip('forza-rain', 'Forza Horizon 5', 'forza-4', 'Nur noch diese eine Kurve', 98, 36),
    clip('night-drive', 'Cyberpunk 2077', 'cyberpunk-3', 'Plan B: einfach weiterfahren', 120, 64),
    clip('headshot-dust', 'Counter-Strike 2', 'cs2-3', 'Doppel-Kill per Headshot', 140, 23, {
      tags: ['Headshot'],
    }),
  ];
}

const games = [
  'Counter-Strike 2',
  'Apex Legends',
  'ELDEN RING',
  'Forza Horizon 5',
  'Cyberpunk 2077',
];
const covers = {
  'Counter-Strike 2': 'cs2',
  'Apex Legends': 'apex',
  'ELDEN RING': 'elden',
  'Forza Horizon 5': 'forza',
  'Cyberpunk 2077': 'cyberpunk',
};
/** Was der Server bei Steam nachschlägt; die Beschreibungen sind eigene Kurztexte. */
const details = {
  'Counter-Strike 2': {
    genre: 'Action, Free to Play',
    released: '21. Aug. 2012',
    description: 'Taktischer Team-Shooter: zwei Teams, eine Bombe, Runde für Runde.',
    source: 'https://store.steampowered.com/app/730/',
  },
  'Apex Legends': {
    genre: 'Action, Free to Play',
    released: '4. Nov. 2020',
    description: 'Hero-Shooter im Battle-Royale-Format, in dem Trupps aus drei Legenden kämpfen.',
    source: 'https://store.steampowered.com/app/1172470/',
  },
  'ELDEN RING': {
    genre: 'Action, Rollenspiel',
    released: '25. Feb. 2022',
    description: 'Action-Rollenspiel in einer offenen Welt voller Ruinen und harter Bosse.',
    source: 'https://store.steampowered.com/app/1245620/',
  },
  'Forza Horizon 5': {
    genre: 'Rennspiel',
    released: '9. Nov. 2021',
    description: 'Open-World-Rennspiel quer durch Mexiko.',
    source: 'https://store.steampowered.com/app/1551360/',
  },
  'Cyberpunk 2077': {
    genre: 'Rollenspiel',
    released: '10. Dez. 2020',
    description: 'Rollenspiel in der Megastadt Night City.',
    source: 'https://store.steampowered.com/app/1091500/',
  },
};

/** Was die Web-App lokal speichert: Sammlungen, Fortschritt und Anzeigename. */
const vault = {
  version: 1,
  clips: [],
  collections: [
    {
      id: 'clutches',
      title: 'Beste Clutches',
      description: 'Es ist erst vorbei, wenn es vorbei ist.',
      clipIds: ['clutch-inferno', 'ace-inferno', 'apex-final'],
      updatedAt: iso(2),
    },
    {
      id: 'friends',
      title: 'Mit Freunden',
      description: 'Gute Gesellschaft, fragwürdige Entscheidungen.',
      clipIds: ['apex-third', 'mirage-triple', 'forza-drift'],
      updatedAt: iso(20),
    },
    {
      id: 'montage',
      title: 'Montage-Material',
      description: 'Für das nächste Video.',
      clipIds: ['forza-drift', 'night-city', 'headshot-dust'],
      updatedAt: iso(40),
    },
    {
      id: 'bosses',
      title: 'Bosskämpfe',
      description: 'Einmal noch.',
      clipIds: ['elden-boss', 'elden-view'],
      updatedAt: iso(80),
    },
  ],
  progress: {
    'elden-boss': { seconds: 25, duration: 66, updatedAt: iso(1) },
    'night-city': { seconds: 41, duration: 58, updatedAt: iso(3) },
    'forza-drift': { seconds: 9, duration: 31, updatedAt: iso(6) },
  },
  preferences: { name: 'Spieler', speed: 1, reducedMotion: false, compact: false },
};

/** Stellt den Server nach: Status mit verbundenem Gaming-PC, Clips, Spielinfos und das Video. */
async function mockServer(context, video) {
  const clips = demoClips();
  await context.route(`${base}/api/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/status')
      return route.fulfill({
        json: {
          connected: true,
          provider: 'none',
          configured: false,
          model: '',
          settings: { autoAnalyze: true, autoTitle: true, includeAudio: false },
          queue: 0,
          clientDownloadAvailable: true,
          devices: [
            {
              id: 'pc',
              name: 'Gaming-PC',
              folder: 'D:\\Clips',
              lastSeen: new Date().toISOString(),
              error: '',
              uploaded: clips.length,
              analysisLocation: 'client',
              paused: false,
            },
          ],
        },
      });
    if (path === '/api/clips' && route.request().method() === 'GET')
      return route.fulfill({ json: clips });
    if (path === '/api/games')
      return route.fulfill({
        json: games.map((name) => ({
          key: name.toLowerCase(),
          label: name,
          name,
          ...details[name],
          cover: `/media/${covers[name]}-cover.webp`,
        })),
      });
    return route.fulfill({ status: 404, json: { error: 'Nicht Teil der Demo.' } });
  });
  // Mit Byte-Bereichen, sonst kann Chromium im Video nicht springen.
  const bytes = await readFile(video);
  await context.route(`${base}/demo/clip.webm`, (route) => {
    const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range ?? '');
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Number(range[2]) : bytes.length - 1;
    return route.fulfill({
      status: range ? 206 : 200,
      body: bytes.subarray(start, end + 1),
      contentType: 'video/webm',
      headers: {
        'accept-ranges': 'bytes',
        ...(range ? { 'content-range': `bytes ${start}-${end}/${bytes.length}` } : {}),
      },
    });
  });
  await context.addInitScript((state) => {
    localStorage.setItem('replayhaven.v1', JSON.stringify(state));
  }, vault);
}

/** Screenshot als JPEG (Fotos aus Spielen komprimieren so auf einen Bruchteil) oder PNG. */
async function save(page, name, options = {}) {
  const buffer = await page.screenshot(options);
  const target = join(out, name);
  if (name.endsWith('.png'))
    await sharp(buffer).png({ compressionLevel: 9, palette: false }).toFile(target);
  else await sharp(buffer).jpeg({ quality: 84, mozjpeg: true }).toFile(target);
  console.log(`  ${name}`);
}

/** Wartet auf Schriften und sichtbare Bilder; Bilder unterhalb laden per Lazy Loading nie. */
const settle = (page) =>
  page.evaluate(async () => {
    await document.fonts.ready;
    const visible = [...document.images].filter((image) => {
      const box = image.getBoundingClientRect();
      return !image.complete && box.bottom > 0 && box.top < innerHeight;
    });
    const loaded = Promise.all(
      visible.map((image) => new Promise((done) => (image.onload = image.onerror = done))),
    );
    await Promise.race([loaded, new Promise((done) => setTimeout(done, 5000))]);
  });

async function appShots(browser, video) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  await mockServer(context, video);
  const page = await context.newPage();
  await page.goto(`${base}/`);
  await page.getByRole('heading', { name: 'Ace auf Inferno', level: 1 }).waitFor();
  await page.waitForTimeout(600);
  await settle(page);
  await save(page, 'app-home.jpg');

  // Details und Player der Startseite hängen an ?clip= und ?play=. Per Klick geöffnet zeigt der
  // Dialog keinen Tastaturfokus-Rahmen.
  await page.getByRole('button', { name: 'Details', exact: true }).first().click();
  await page.getByRole('dialog').waitFor();
  await page.waitForTimeout(500);
  await settle(page);
  await save(page, 'app-detail.jpg');

  await page.goto(`${base}/?play=ace-inferno`);
  await page.waitForFunction(
    () => (document.querySelector('.stream-player video')?.readyState ?? 0) >= 2,
  );
  // Angehalten bleiben die Bedienelemente stehen; zweimal vorspulen zeigt etwas Fortschritt.
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByRole('button', { name: '10 Sekunden vor' }).click();
  await page.getByRole('button', { name: '10 Sekunden vor' }).click();
  await page.mouse.move(720, 400);
  await page.waitForTimeout(500);
  await save(page, 'app-player.jpg');

  await page.goto(`${base}/library`);
  await page.getByText('Triple Kill auf Mirage').first().waitFor();
  // Die Maus stand zuletzt mitten im Bild und höbe sonst ein Cover hervor.
  await page.mouse.move(1420, 140);
  await settle(page);
  await save(page, 'app-library.jpg');

  // Ein Spiel gewählt: oben die Spieleleiste, darunter die Spielinfos und die ersten Clips.
  await page.goto(`${base}/library?game=${encodeURIComponent('name:Counter-Strike 2')}`);
  await page.locator('.stream-spotlight').waitFor();
  await page
    .locator('.stream-shelf')
    .evaluate((shelf) => scrollTo(0, shelf.getBoundingClientRect().top + scrollY - 110));
  await page.waitForTimeout(300);
  await settle(page);
  await save(page, 'app-game.jpg');

  await page.goto(`${base}/collections/clutches`);
  await page.getByRole('heading', { name: 'Beste Clutches', level: 1 }).waitFor();
  await page.waitForTimeout(300);
  await settle(page);
  await save(page, 'app-collection.jpg');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/`);
  await page.getByRole('heading', { name: 'Ace auf Inferno', level: 1 }).waitFor();
  await page.waitForTimeout(600);
  await settle(page);
  await save(page, 'app-mobile.jpg');
  await context.close();
}

/** Das Fenster des Windows-Clients, mit nachgestellter Brücke zum Hauptprozess. */
async function clientShot(browser) {
  const page = await browser.newPage({ viewport: { width: 1040, height: 900 } });
  await page.addInitScript(() => {
    const config = {
      folder: 'D:\\Clips',
      server: 'http://192.168.1.20:8787',
      game: '',
      playerNames: [{ name: 'SpielerEins', game: '' }],
      includeExisting: false,
      analyze: true,
      frames: 24,
      fortniteReplays: true,
      epicAccounts: [],
      r6Texts: false,
      hasToken: true,
    };
    const status = {
      running: true,
      paused: false,
      message: 'Hochgeladen: „Ace auf Inferno“. Warte auf die nächste Aufnahme.',
      queued: 0,
      uploaded: 48,
      model: true,
      ollama: true,
      downloading: false,
    };
    window.vault = {
      call: async (action) =>
        action === 'load'
          ? { ok: true, value: { config, status } }
          : action === 'games'
            ? { ok: true, value: ['Counter-Strike 2', 'Fortnite', 'ELDEN RING'] }
            : { ok: true, value: null },
      onStatus: () => () => {},
    };
  });
  await page.goto(pathToFileURL(join(root, 'desktop', 'renderer', 'index.html')).href);
  await page.locator('#status-title').getByText('Client läuft').waitFor();
  await settle(page);
  await save(page, 'client.png', { fullPage: true });
  await page.close();
}

async function graphics(browser) {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 620 },
    deviceScaleFactor: 1,
  });
  await page.goto(`${base}/docs/images/src/banner.html`);
  await settle(page);
  await save(page, 'banner.jpg');

  await page.setViewportSize({ width: 1280, height: 640 });
  await page.goto(`${base}/docs/images/src/social.html`);
  await settle(page);
  await save(page, 'social-preview.jpg');

  await page.setViewportSize({ width: 1600, height: 760 });
  for (const theme of ['dark', 'light']) {
    await page.goto(`${base}/docs/images/src/architecture.html?theme=${theme}`);
    await settle(page);
    await save(page, `architecture-${theme}.png`);
  }
  await page.close();
}

await mkdir(out, { recursive: true });
const work = await mkdtemp(join(tmpdir(), 'replayhaven-readme-'));
const vite = await startVite();
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  console.log(`Bilder nach ${out}:`);
  const video = await demoVideo(work);
  await appShots(browser, video);
  await clientShot(browser);
  await graphics(browser);
} finally {
  await browser.close();
  vite.kill();
  await rm(work, { recursive: true, force: true });
}
