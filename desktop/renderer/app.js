const $ = (id) => document.getElementById(id);
const el = (tag, { dataset, ...props } = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  if (dataset) Object.assign(node.dataset, dataset);
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return node;
};
async function call(action, value) {
  const response = await window.vault.call(action, value);
  if (!response.ok) throw new Error(response.error);
  return response.value;
}
let toastTimer;
function toast(message) {
  const box = $('toast');
  box.textContent = message;
  box.hidden = !message;
  clearTimeout(toastTimer);
  if (message) toastTimer = setTimeout(() => (box.hidden = true), 7000);
}
async function run(action) {
  try {
    return await action();
  } catch (e) {
    toast(e.message);
  }
}

let config = null;
let status = null;

/* ---------- Anzeigehilfen ---------- */

/** "Valorant 2026.09.25 - 21.14.02.03.DVR.mp4" → "25.09.2026 · 21:14 Uhr" */
function clipName(file) {
  const m = /(\d{4})\.(\d{2})\.(\d{2}) - (\d{2})\.(\d{2})/.exec(file);
  return m ? `${m[3]}.${m[2]}.${m[1]} · ${m[4]}:${m[5]} Uhr` : file.replace(/\.[^.]+$/, '');
}
const SHORT = [
  [/rainbow six/i, 'R6'],
  [/valorant/i, 'VAL'],
  [/fortnite/i, 'FN'],
  [/call of duty/i, 'COD'],
  [/counter-?strike/i, 'CS'],
  [/minecraft/i, 'MC'],
  [/arc raiders/i, 'ARC'],
  [/^desktop$/i, 'PC'],
];
function gameShort(game) {
  const known = SHORT.find(([pattern]) => pattern.test(game));
  if (known) return known[1];
  const words = game
    .replace(/tom clancy's/i, '')
    .split(/\s+/)
    .filter(Boolean);
  return (
    words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2)
  ).toUpperCase();
}
function gameHue(game) {
  let hash = 0;
  for (const c of game.toLowerCase()) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return 200 + (hash % 140);
}
function gameName(game) {
  return game.replace(/^Tom Clancy's\s+/i, '').replace(/\s+/g, ' ');
}
function badge(game) {
  const node = el('span', { className: 'game-badge', textContent: gameShort(game), title: game });
  node.style.setProperty('--hue', String(gameHue(game)));
  return node;
}
function duration(seconds) {
  seconds = Math.max(0, Math.round(seconds));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}:${String(seconds % 60).padStart(2, '0')} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
function ago(at) {
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return 'gerade eben';
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const date = new Date(at);
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}
function megabytes(bytes) {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
}
/** Median der letzten Bearbeitungszeiten, für Restzeit und Kennzahl. */
function averageSeconds(recent) {
  const times = recent
    .slice(0, 10)
    .map((r) => r.seconds)
    .filter((s) => s > 0)
    .sort((a, b) => a - b);
  return times.length ? times[Math.floor(times.length / 2)] : 0;
}
function fraction(active) {
  if (!active) return 0;
  if (active.step === 'prepare') return 0.04;
  if (active.step === 'view')
    return 0.05 + 0.8 * (active.total ? active.current / active.total : 0);
  if (active.step === 'summary') return 0.9;
  return 0.97;
}

/* ---------- Übersicht ---------- */

function mode(s) {
  if (!config?.onboarded) return 'setup';
  if (!s.running) return 'off';
  if (s.gaming) return 'gaming';
  if (s.paused) return 'paused';
  return s.active ? 'working' : 'running';
}
const MODES = {
  setup: {
    pill: 'Nicht eingerichtet',
    eyebrow: 'Willkommen',
    title: 'Noch nicht eingerichtet',
    action: 'Einrichten',
  },
  off: { pill: 'Nicht gestartet', eyebrow: 'Bereit', title: 'Nicht gestartet', action: 'Starten' },
  running: { pill: 'Läuft', eyebrow: 'Läuft', title: 'Wartet auf neue Clips', action: 'Pausieren' },
  working: {
    pill: 'Analysiert',
    eyebrow: 'Läuft',
    title: 'Arbeitet an deinem Clip',
    action: 'Pausieren',
  },
  paused: { pill: 'Pausiert', eyebrow: 'Pausiert', title: 'Pausiert', action: 'Fortsetzen' },
  gaming: {
    pill: 'Spiel läuft',
    eyebrow: 'Wartet',
    title: 'Pause, während du spielst',
    action: 'Pausieren',
  },
};

function renderOverview(s) {
  const m = mode(s);
  const text = MODES[m];
  const pill = $('pill');
  pill.dataset.state = m === 'setup' ? 'off' : m;
  pill.lastElementChild.textContent =
    m === 'gaming' ? `Spiel läuft · ${gameName(s.gaming)}` : text.pill;
  $('hero-orb').dataset.state = m === 'setup' ? 'off' : m;
  $('hero-eyebrow').textContent = text.eyebrow;
  $('hero-title').textContent = text.title;
  $('hero-message').textContent =
    m === 'setup'
      ? 'Der Assistent führt dich in wenigen Schritten durch Server, Aufnahmeordner und lokale KI.'
      : m === 'gaming'
        ? `${gameName(s.gaming)} läuft. Analyse und Upload gehen eine Minute nach dem Spielen weiter, damit Grafikkarte und Leitung dem Spiel gehören.`
        : s.message;
  const action = $('primary-action');
  action.textContent = text.action;
  action.className = ['running', 'working', 'gaming'].includes(m)
    ? 'secondary large'
    : 'primary large';
  action.disabled = s.downloading;

  const open = s.queue.length + (s.active ? 1 : 0);
  const average = averageSeconds(s.recent);
  $('stat-queue').textContent = String(open);
  $('stat-queue-eta').textContent = open
    ? average
      ? `noch etwa ${duration(open * average)}`
      : `${open === 1 ? 'Ein Clip' : `${open} Clips`} offen`
    : 'Nichts offen';
  const midnight = new Date().setHours(0, 0, 0, 0);
  const today = s.recent.filter((r) => r.at >= midnight);
  $('stat-today').textContent = String(today.length);
  $('stat-today-note').textContent = today[0] ? `zuletzt ${ago(today[0].at)}` : ' ';
  $('stat-total').textContent = String(s.uploaded);
  $('stat-average').textContent = average ? `Ø ${duration(average)} je Clip` : ' ';

  renderActive(s.active);
  renderQueue(s.queue, average, !!s.active);
  renderRecent(s.recent);
}

let activePath = '';
function renderActive(active) {
  $('now-empty').hidden = !!active;
  $('now-clip').hidden = !active;
  if (!active) {
    activePath = '';
    $('now-elapsed').textContent = '';
    return;
  }
  if (active.path !== activePath) {
    activePath = active.path;
    $('now-thumb').hidden = true;
    $('now-thumb-fallback').textContent = gameShort(active.game);
  }
  if (active.thumbnail && $('now-thumb').src !== active.thumbnail) {
    $('now-thumb').src = active.thumbnail;
    $('now-thumb').hidden = false;
  }
  $('now-game').textContent = gameName(active.game);
  $('now-name').textContent = `Clip vom ${clipName(active.name)}`;
  $('now-name').title = active.name;
  const order = ['prepare', 'view', 'summary', 'upload'];
  const current = order.indexOf(active.step);
  for (const item of $('stepper').children) {
    const index = order.indexOf(item.dataset.step);
    item.dataset.state = index < current ? 'done' : index === current ? 'current' : 'todo';
  }
  const percent = Math.round(fraction(active) * 100);
  $('now-bar').style.width = `${percent}%`;
  $('now-bar').parentElement.setAttribute('aria-valuenow', String(percent));
  $('now-detail').textContent =
    active.step === 'prepare'
      ? 'Bilder und Ton werden vorbereitet'
      : active.step === 'view'
        ? active.total
          ? `Die KI sichtet Abschnitt ${active.current} von ${active.total}`
          : 'Die KI sichtet die Bilder'
        : active.step === 'summary'
          ? 'Titel, Beschreibung und Zeitmarken entstehen'
          : 'Wird in dein Archiv hochgeladen';
  tickElapsed();
}
function tickElapsed() {
  const active = status?.active;
  $('now-elapsed').textContent = active ? duration((Date.now() - active.since) / 1000) : '';
}
setInterval(tickElapsed, 1000);

const STATES = {
  waiting: ['Wartet', ''],
  settling: ['Wird gespeichert', 'accent'],
  retry: ['Neuer Versuch', 'bad'],
  deferred: ['Wartet aufs Match', 'warn'],
};
function renderQueue(queue, average, busy) {
  $('queue-count').textContent = String(queue.length);
  $('queue-empty').hidden = queue.length > 0;
  $('queue-list').replaceChildren(
    ...queue.slice(0, 100).map((entry, i) => {
      const [label, tone] = STATES[entry.state] || STATES.waiting;
      const eta =
        average && entry.state === 'waiting'
          ? ` · in etwa ${duration((i + (busy ? 1 : 0)) * average)}`
          : '';
      const chip = el('span', { className: 'chip', textContent: label });
      if (tone) chip.dataset.tone = tone;
      if (entry.note) chip.title = entry.note;
      return el(
        'li',
        { title: entry.note || entry.name },
        el('span', { className: 'position', textContent: String(i + 1) }),
        el(
          'span',
          { className: 'item-main' },
          el('span', {
            className: 'item-title',
            textContent: `${gameName(entry.game)} · ${clipName(entry.name)}`,
          }),
          el('span', { className: 'item-sub', textContent: `${megabytes(entry.size)}${eta}` }),
        ),
        el('span', { className: 'item-end' }, chip),
      );
    }),
  );
}
function renderRecent(recent) {
  $('recent-empty').hidden = recent.length > 0;
  $('recent-list').replaceChildren(
    ...recent.slice(0, 20).map((clip) => {
      const item = el(
        'li',
        { className: 'clickable', tabIndex: 0, title: 'Im Archiv öffnen' },
        badge(clip.game),
        el(
          'span',
          { className: 'item-main' },
          el('span', { className: 'item-title', textContent: clip.title || clipName(clip.name) }),
          el('span', {
            className: 'item-sub',
            textContent: `${gameName(clip.game)} · ${ago(clip.at)}`,
          }),
        ),
        el(
          'span',
          { className: 'item-end' },
          ...(clip.tags || [])
            .slice(0, 2)
            .map((t) => el('span', { className: 'tag', textContent: t })),
        ),
      );
      const open = () => run(() => call('open-clip', clip.clipId));
      item.onclick = open;
      item.onkeydown = (event) => event.key === 'Enter' && open();
      return item;
    }),
  );
}

$('primary-action').onclick = () =>
  run(async () => {
    const m = mode(status);
    if (m === 'setup') return openWizard();
    if (['running', 'working', 'gaming'].includes(m)) return call('pause');
    await call('start');
  });
$('now-reveal').onclick = () => run(() => call('reveal', status.active?.path));
$('archive').onclick = () => run(() => call('archive'));
$('recent-all').onclick = () => run(() => call('archive'));

/* ---------- Tabs ---------- */

function showView(view) {
  for (const tab of document.querySelectorAll('.tab'))
    tab.setAttribute('aria-selected', String(tab.dataset.view === view));
  $('overview').hidden = view !== 'overview';
  $('settings').hidden = view !== 'settings';
  if (view === 'settings') fillSettings();
}
for (const tab of document.querySelectorAll('.tab')) tab.onclick = () => showView(tab.dataset.view);

/* ---------- Spielernamen ---------- */

function nameRows(container, entries) {
  const add = (entry = { name: '', game: '' }) => {
    const name = el('input', {
      className: 'player-name',
      maxLength: 60,
      placeholder: 'Name im Spiel',
      value: entry.name,
    });
    name.setAttribute('aria-label', 'Spielername');
    const game = el('input', {
      className: 'player-game',
      maxLength: 100,
      placeholder: 'Alle Spiele',
      value: entry.game,
    });
    game.setAttribute('aria-label', 'Spiel zu diesem Namen');
    game.setAttribute('list', 'game-suggestions');
    const remove = el('button', {
      type: 'button',
      className: 'secondary remove-name',
      textContent: '×',
      title: 'Namen entfernen',
    });
    remove.setAttribute('aria-label', 'Namen entfernen');
    const row = el('div', { className: 'name-row' }, name, game, remove);
    remove.onclick = () => {
      row.remove();
      if (!container.children.length) add();
    };
    container.append(row);
    return name;
  };
  container.replaceChildren();
  for (const entry of entries) add(entry);
  if (!entries.length) add();
  return {
    add,
    read: () =>
      [...container.querySelectorAll('.name-row')]
        .map((row) => ({
          name: row.querySelector('.player-name').value.trim(),
          game: row.querySelector('.player-game').value.trim(),
        }))
        .filter((entry) => entry.name),
  };
}
function suggestGames(games) {
  $('game-suggestions').replaceChildren(...games.map((game) => el('option', { value: game })));
}

/* ---------- Einstellungen ---------- */

let settingsNames;
const CHECKS = {
  analyze: 'analyze',
  'r6-texts': 'r6Texts',
  speech: 'speech',
  'fortnite-replays': 'fortniteReplays',
  'keep-r6-replays': 'keepR6Replays',
  'pause-while-gaming': 'pauseWhileGaming',
  'auto-start': 'autoStart',
  'open-at-login': 'openAtLogin',
  notify: 'notify',
  'include-existing': 'includeExisting',
};
function fillSettings() {
  if (!config) return;
  $('server').value = config.server;
  $('token').value = '';
  $('token').placeholder = config.hasToken
    ? 'Gespeichert · leer lassen, um ihn zu behalten'
    : 'Schlüssel vom Archiv-Server';
  $('folder').value = config.folder;
  $('game').value = config.game;
  $('frames').value = String(config.frames);
  $('epic-accounts').value = config.epicAccounts.join(', ');
  for (const [id, key] of Object.entries(CHECKS)) $(id).checked = !!config[key];
  settingsNames = nameRows($('player-names'), config.playerNames);
  $('server-result').textContent = '';
  $('save-result').textContent = '';
  void describeFolder();
  renderSettingsLock(status);
}
function readSettings() {
  const values = {
    ...config,
    server: $('server').value.trim(),
    token: $('token').value,
    folder: $('folder').value,
    game: $('game').value.trim(),
    frames: Number($('frames').value),
    playerNames: settingsNames.read(),
    epicAccounts: $('epic-accounts')
      .value.split(/[\s,;]+/)
      .filter(Boolean),
  };
  delete values.hasToken;
  for (const [id, key] of Object.entries(CHECKS)) values[key] = $(id).checked;
  return values;
}
function renderSettingsLock(s) {
  if (!s) return;
  const locked = s.running && !s.paused;
  $('settings-lock').hidden = !locked;
  $('save').disabled = locked;
  $('model-state').textContent = s.model ? 'Bereit' : s.ollama ? 'Modell fehlt' : 'Ungeprüft';
  $('model-state').dataset.tone = s.model ? 'ok' : s.ollama ? 'warn' : '';
  $('download-model').disabled = s.downloading || s.model;
  $('cancel-download').hidden = !s.downloading;
  const percent = s.downloading ? /(\d+)\s*%/.exec(s.message)?.[1] : undefined;
  $('model-progress').hidden = !s.downloading;
  if (percent) $('model-progress').firstElementChild.style.width = `${percent}%`;
}
async function describeFolder() {
  const info = await call('folder-info').catch(() => ({ clips: 0, games: [] }));
  $('folder-info').textContent = info.clips
    ? `${info.clips} Clips in ${info.games.length} ${info.games.length === 1 ? 'Spiel' : 'Spielen'}: ${info.games
        .slice(0, 5)
        .map((g) => gameName(g.game))
        .join(', ')}${info.games.length > 5 ? ' …' : ''}`
    : '';
  suggestGames(info.games.map((g) => g.game));
  return info;
}
$('settings-form').onsubmit = (event) => {
  event.preventDefault();
  void run(async () => {
    config = await call('save', readSettings());
    await call('open-at-login', config.openAtLogin);
    $('token').value = '';
    $('save-result').textContent = 'Gespeichert';
    $('save-result').dataset.tone = 'ok';
  });
};
$('settings-pause').onclick = () => run(() => call('pause'));
$('test-server').onclick = () =>
  run(async () => {
    $('server-result').textContent = 'Prüfe …';
    $('server-result').dataset.tone = '';
    try {
      const result = await call('test-server', {
        server: $('server').value.trim(),
        token: $('token').value,
      });
      $('server-result').textContent = `Verbunden · ${result.clips} Clips im Archiv`;
      $('server-result').dataset.tone = 'ok';
    } catch (e) {
      $('server-result').textContent = e.message;
      $('server-result').dataset.tone = 'bad';
    }
  });
$('pick-folder').onclick = () =>
  run(async () => {
    const folder = await call('folder');
    if (folder) $('folder').value = folder;
    await describeFolder();
  });
$('add-name').onclick = () => settingsNames.add().focus();
$('check-model').onclick = () => run(() => call('check'));
$('install-ollama').onclick = () => run(() => call('ollama-install'));
$('download-model').onclick = () => run(() => call('download'));
$('cancel-download').onclick = () => run(() => call('cancel-download'));
$('rerun-setup').onclick = () => openWizard();

/* ---------- Assistent ---------- */

let draft = null;
let step = 0;
const wizard = { serverOk: false, clips: 0, games: [], ai: null, names: null };
const RECOMMENDED = 'Empfohlen';

function option(key, title, text, { recommended = false, checked } = {}) {
  const input = el('input', { type: 'checkbox', checked: checked ?? !!draft[key] });
  input.onchange = () => (draft[key] = input.checked);
  return el(
    'label',
    { className: 'option toggle' },
    input,
    el(
      'span',
      {},
      el(
        'b',
        {},
        title,
        recommended
          ? el('span', { className: 'chip', textContent: RECOMMENDED, dataset: { tone: 'accent' } })
          : null,
      ),
      el('small', { textContent: text }),
    ),
  );
}
function field(label, input) {
  return el('label', { className: 'field' }, label, input);
}
function checkLine(tone, text) {
  return el(
    'div',
    { className: 'check-line', dataset: { tone } },
    el('span', { className: 'dot' }),
    el('span', { textContent: text }),
  );
}
function hasGame(pattern) {
  return wizard.games.some((g) => pattern.test(g.game));
}

const STEPS = [
  {
    name: 'Willkommen',
    eyebrow: 'Willkommen bei ReplayHaven',
    title: 'Aus jedem Clip ein Highlight mit Namen.',
    lead: 'Der Client beobachtet deinen NVIDIA-Aufnahmeordner, lässt eine KI auf deinem PC jeden neuen Clip ansehen und legt ihn mit Titel, Tags und Zeitmarken in deinem Archiv ab. Die Einrichtung dauert zwei Minuten.',
    next: 'Einrichtung beginnen',
    render: () =>
      el(
        'div',
        { className: 'features' },
        ...[
          [
            '◉',
            'Aufnahmen',
            'Neue Clips aus der NVIDIA App werden automatisch erkannt. Originale bleiben, wo sie sind.',
          ],
          [
            '✦',
            'Lokale KI',
            'Kills, Rundensiege, Karten und Gespräche werden auf deiner Grafikkarte erkannt, nicht in der Cloud.',
          ],
          [
            '▶',
            'Dein Archiv',
            'Alles landet auf deinem eigenen Server, durchsuchbar und im Browser abspielbar.',
          ],
        ].map(([icon, title, text]) =>
          el(
            'div',
            { className: 'feature' },
            el('span', { className: 'feature-icon', textContent: icon }),
            el('b', { textContent: title }),
            el('p', { textContent: text }),
          ),
        ),
      ),
  },
  {
    name: 'Archiv-Server',
    eyebrow: 'Schritt 1 · Verbindung',
    title: 'Mit deinem Archiv koppeln.',
    lead: 'Gib die Adresse deines ReplayHaven-Servers ein, etwa replay.deine-domain.de. Der PC fragt dort an, und du gibst ihn in der Web-Oberfläche mit einem Klick frei.',
    render: () => {
      const box = el('div', { className: 'wizard-content' });
      const address = el('input', {
        type: 'text',
        value: draft.server,
        placeholder: 'replay.deine-domain.de',
        spellcheck: false,
      });
      const token = el('input', {
        type: 'password',
        autocomplete: 'off',
        placeholder: 'Zugangsschlüssel aus der Server-Einrichtung',
      });
      const keyResult = el('div');
      address.oninput = () => (wizard.serverOk = false);
      const paint = () => {
        const p = status?.pairing;
        const children = [field('Serveradresse', address)];
        if (wizard.useKey) {
          const test = el('button', {
            type: 'button',
            className: 'primary',
            textContent: 'Verbindung prüfen',
          });
          test.onclick = async () => {
            draft.server = address.value.trim();
            draft.token = token.value;
            keyResult.replaceChildren(checkLine('', 'Prüfe die Verbindung …'));
            try {
              const info = await call('test-server', { server: draft.server, token: draft.token });
              wizard.serverOk = true;
              keyResult.replaceChildren(
                checkLine('ok', `Verbunden · ${info.clips} Clips im Archiv`),
              );
            } catch (e) {
              wizard.serverOk = false;
              keyResult.replaceChildren(checkLine('bad', e.message));
            }
          };
          const back = el('button', {
            type: 'button',
            className: 'link',
            textContent: 'Lieber koppeln',
          });
          back.onclick = () => {
            wizard.useKey = false;
            paint();
          };
          children.push(
            field('Zugangsschlüssel', token),
            el('div', { className: 'row' }, test, back),
            keyResult,
          );
        } else if (p?.state === 'waiting') {
          const open = el('button', {
            type: 'button',
            className: 'primary',
            textContent: 'Geräteseite öffnen ↗',
          });
          open.onclick = () => run(() => call('open-devices'));
          const cancel = el('button', {
            type: 'button',
            className: 'ghost',
            textContent: 'Abbrechen',
          });
          cancel.onclick = () => run(() => call('pair-cancel'));
          children.push(
            el(
              'div',
              { className: 'pair-card' },
              el('span', { className: 'eyebrow', textContent: 'Dein Kontrollcode' }),
              el('strong', {
                className: 'pair-code',
                textContent: `${p.code.slice(0, 3)} ${p.code.slice(3)}`,
              }),
              el('p', {
                textContent:
                  'Öffne deine Web-Oberfläche unter „Geräte“ und klick bei diesem PC auf „Freigeben“. Dort steht derselbe Code.',
              }),
              el('div', { className: 'row' }, open, cancel),
            ),
            checkLine('', p.message),
          );
        } else if (p?.state === 'approved' || wizard.serverOk) {
          if (p?.state === 'approved') draft.server = p.server;
          wizard.serverOk = true;
          children.push(
            checkLine('ok', p?.state === 'approved' ? p.message : 'Dieser PC ist schon gekoppelt.'),
          );
        } else {
          const connect = el('button', {
            type: 'button',
            className: 'primary',
            textContent: 'Verbinden',
          });
          connect.onclick = () =>
            run(async () => {
              draft.server = address.value.trim();
              connect.disabled = true;
              try {
                await call('pair-start', draft.server);
              } finally {
                connect.disabled = false;
              }
            });
          const useKey = el('button', {
            type: 'button',
            className: 'link',
            textContent: 'Stattdessen mit Zugangsschlüssel',
          });
          useKey.onclick = () => {
            wizard.useKey = true;
            paint();
          };
          if (p) children.push(checkLine('bad', p.message));
          children.push(el('div', { className: 'row' }, connect, useKey));
        }
        box.replaceChildren(...children);
      };
      STEPS[1].paint = paint;
      paint();
      return box;
    },
    validate: () => {
      if (status?.pairing?.state === 'approved') {
        draft.server = status.pairing.server;
        wizard.serverOk = true;
      }
      if (!wizard.serverOk) throw new Error('Koppel den PC zuerst mit deinem Server.');
    },
  },
  {
    name: 'Aufnahmen',
    eyebrow: 'Schritt 2 · Aufnahmen',
    title: 'Wo speichert die NVIDIA App deine Clips?',
    lead: 'Meist ist das der Ordner „Videos“ oder „Videos\\NVIDIA“. Unterordner je Spiel werden mitgelesen.',
    render: () => {
      const folder = el('input', {
        readOnly: true,
        value: draft.folder,
        placeholder: 'Ordner auswählen',
      });
      const pick = el('button', {
        type: 'button',
        className: 'secondary',
        textContent: 'Ordner wählen',
      });
      const info = el('div', { className: 'wizard-content' });
      const existing = el('input', { type: 'checkbox', checked: draft.includeExisting });
      existing.onchange = () => (draft.includeExisting = existing.checked);
      const existingLabel = el('small');
      const describe = async () => {
        const result = await call('folder-info');
        wizard.clips = result.clips;
        wizard.games = result.games;
        suggestGames(result.games.map((g) => g.game));
        existingLabel.textContent = `${result.clips} vorhandene Clips werden dann nach und nach analysiert und hochgeladen. Sonst nur neue.`;
        info.replaceChildren(
          checkLine(
            result.clips ? 'ok' : 'warn',
            result.clips
              ? `${result.clips} Clips in ${result.games.length} ${result.games.length === 1 ? 'Spiel' : 'Spielen'} gefunden`
              : 'In diesem Ordner liegen noch keine Clips.',
          ),
          el(
            'div',
            { className: 'game-chips' },
            ...result.games
              .slice(0, 10)
              .map((g) =>
                el('span', { className: 'chip', textContent: `${gameName(g.game)} · ${g.clips}` }),
              ),
          ),
        );
      };
      pick.onclick = () =>
        run(async () => {
          const chosen = await call('folder');
          if (!chosen) return;
          draft.folder = chosen;
          folder.value = chosen;
          await describe();
        });
      if (draft.folder) void describe();
      return el(
        'div',
        { className: 'wizard-content' },
        el('div', { className: 'input-row' }, folder, pick),
        info,
        el(
          'label',
          { className: 'option toggle' },
          existing,
          el('span', {}, el('b', { textContent: 'Vorhandene Clips mitnehmen' }), existingLabel),
        ),
      );
    },
    validate: () => {
      if (!draft.folder) throw new Error('Wähle den Ordner, in dem deine Clips liegen.');
    },
  },
  {
    name: 'Lokale KI',
    eyebrow: 'Schritt 3 · Lokale KI',
    title: 'Die KI läuft auf deiner Grafikkarte.',
    lead: 'ReplayHaven nutzt Ollama mit dem Modell Qwen3.5 (9B, etwa 6,6 GB). Ab etwa 10 GB Grafikspeicher läuft es flüssig.',
    render: () => {
      const box = el('div', { className: 'wizard-content' });
      const paint = () => {
        const s = status;
        const ai = wizard.ai;
        const lines = [];
        if (!ai) lines.push(checkLine('', 'Prüfe, ob Ollama läuft …'));
        else {
          lines.push(
            checkLine(
              ai.running ? 'ok' : 'bad',
              ai.running ? 'Ollama läuft' : 'Ollama ist nicht installiert oder nicht gestartet',
            ),
          );
          if (ai.running)
            lines.push(
              checkLine(
                ai.installed ? 'ok' : s.downloading ? '' : 'warn',
                ai.installed
                  ? 'Modell Qwen3.5 · 9B ist bereit'
                  : s.downloading
                    ? s.message
                    : 'Das Modell fehlt noch',
              ),
            );
        }
        const buttons = [];
        if (ai && !ai.running) {
          const install = el('button', {
            type: 'button',
            className: 'primary',
            textContent: 'Ollama herunterladen ↗',
          });
          install.onclick = () => run(() => call('ollama-install'));
          buttons.push(install);
        }
        if (ai && ai.running && !ai.installed && !s.downloading) {
          const download = el('button', {
            type: 'button',
            className: 'primary',
            textContent: 'Modell laden · 6,6 GB',
          });
          download.onclick = () =>
            run(async () => {
              await call('download');
              await recheck();
            });
          buttons.push(download);
        }
        if (s.downloading) {
          const cancel = el('button', {
            type: 'button',
            className: 'secondary',
            textContent: 'Abbrechen',
          });
          cancel.onclick = () => run(() => call('cancel-download'));
          buttons.push(cancel);
        }
        const again = el('button', {
          type: 'button',
          className: 'ghost',
          textContent: 'Erneut prüfen',
        });
        again.onclick = () => recheck();
        buttons.push(again);
        const percent = s.downloading ? /(\d+)\s*%/.exec(s.message)?.[1] : undefined;
        const bar = el('div', { className: 'progress' }, el('span'));
        if (percent) bar.firstElementChild.style.width = `${percent}%`;
        box.replaceChildren(
          ...lines,
          ...(s.downloading ? [bar] : []),
          el('div', { className: 'row' }, ...buttons),
        );
      };
      const recheck = async () => {
        wizard.ai = await call('check').catch(() => ({ running: false, installed: false }));
        paint();
      };
      STEPS[3].paint = paint;
      paint();
      void recheck();
      return box;
    },
    skip: 'Ohne KI weiter',
    onSkip: () => (draft.analyze = false),
    validate: () => {
      if (!wizard.ai?.installed)
        throw new Error('Das Modell fehlt noch. Lade es oder mach ohne KI weiter.');
      draft.analyze = true;
    },
  },
  {
    name: 'Spielernamen',
    eyebrow: 'Schritt 4 · Du im Spiel',
    title: 'Wie heißt du in deinen Spielen?',
    lead: 'Mit deinem Namen erkennt die KI im Killfeed, welche Kills deine sind und wann du ausgeschaltet wurdest. Leer lassen geht auch.',
    render: () => {
      const container = el('div', { className: 'name-rows' });
      const known = new Set(draft.playerNames.map((n) => n.game.toLowerCase()));
      const games = wizard.games
        .map((g) => g.game)
        .filter((g) => !/^(desktop|base profile)$/i.test(g) && !known.has(g.toLowerCase()))
        .slice(0, 5);
      wizard.names = nameRows(container, [
        ...draft.playerNames,
        ...games.map((game) => ({ name: '', game })),
      ]);
      const add = el('button', {
        type: 'button',
        className: 'link',
        textContent: '+ Weiteren Namen',
      });
      add.onclick = () => wizard.names.add().focus();
      return el('div', { className: 'wizard-content' }, container, el('div', {}, add));
    },
    validate: () => {
      draft.playerNames = wizard.names.read();
    },
  },
  {
    name: 'Erkennung',
    eyebrow: 'Schritt 5 · Feinschliff',
    title: 'Was soll der Client können?',
    lead: 'Die Empfehlungen passen für die meisten. Alles lässt sich später in den Einstellungen ändern.',
    render: () => {
      const whole = el('input', { type: 'checkbox', checked: draft.frames === 0 });
      whole.onchange = () => (draft.frames = whole.checked ? 0 : 24);
      const r6 = hasGame(/rainbow six|r6/i);
      return el(
        'div',
        { className: 'option-grid' },
        el(
          'label',
          { className: 'option toggle' },
          whole,
          el(
            'span',
            {},
            el(
              'b',
              {},
              'Ganzen Clip ansehen',
              el('span', {
                className: 'chip',
                textContent: RECOMMENDED,
                dataset: { tone: 'accent' },
              }),
            ),
            el('small', {
              textContent: 'Ein Bild alle 3 Sekunden, damit keine Kill-Meldung durchrutscht.',
            }),
          ),
        ),
        option(
          'r6Texts',
          'Texterkennung',
          'Karte und Rundenausgang in R6, Kills und Kopfschüsse aus dem Valorant-Killfeed.',
          { recommended: r6 || hasGame(/valorant/i) },
        ),
        option(
          'pauseWhileGaming',
          'Beim Spielen pausieren',
          'Keine Last auf Grafikkarte und Leitung, solange du spielst.',
          { recommended: true },
        ),
        option(
          'speech',
          'Voice-Chat mitschreiben',
          'Titel nach dem Gespräch, wenn im Clip nichts Spielerisches passiert. Lädt einmalig 670 MB.',
        ),
        option(
          'keepR6Replays',
          'R6-Replays aufbewahren',
          'Sichert das Match zu jedem R6-Clip für spätere genaue Kills.',
          { recommended: r6 },
        ),
        option(
          'fortniteReplays',
          'Fortnite-Replays',
          'Kills, Waffe und Entfernung exakt aus den Replays.',
          { recommended: hasGame(/fortnite/i) },
        ),
        option('autoStart', 'Beim Öffnen weiterarbeiten', 'Kein Klick auf „Starten“ nötig.', {
          recommended: true,
        }),
        option('openAtLogin', 'Mit Windows starten', 'Läuft unauffällig im Infobereich.'),
        option(
          'notify',
          'Mitteilungen',
          'Kurze Meldung, wenn ein Clip archiviert ist. Nie während eines Spiels.',
        ),
      );
    },
  },
  {
    name: 'Fertig',
    eyebrow: 'Geschafft',
    title: 'Alles bereit.',
    lead: 'So arbeitet der Client ab jetzt. Die Übersicht zeigt dir, welcher Clip gerade dran ist und was noch wartet.',
    next: 'Speichern und starten',
    render: () => {
      const on = (value) => (value ? 'an' : 'aus');
      const items = [
        ['Archiv-Server', draft.server],
        ['Aufnahmen', `${draft.folder}${wizard.clips ? ` · ${wizard.clips} Clips` : ''}`],
        [
          'Lokale KI',
          draft.analyze
            ? `Qwen3.5 · ${draft.frames === 0 ? 'ganzer Clip' : `${draft.frames} Bilder`}`
            : 'aus, Clips werden nur hochgeladen',
        ],
        [
          'Spielernamen',
          draft.playerNames.length ? draft.playerNames.map((n) => n.name).join(', ') : 'keine',
        ],
        [
          'Erkennung',
          `Texte ${on(draft.r6Texts)} · Voice-Chat ${on(draft.speech)} · Replays ${on(draft.keepR6Replays || draft.fortniteReplays)}`,
        ],
        [
          'Verhalten',
          `Pause beim Spielen ${on(draft.pauseWhileGaming)} · mit Windows ${on(draft.openAtLogin)}`,
        ],
      ];
      return el(
        'ul',
        { className: 'summary' },
        ...items.map(([label, value]) => el('li', {}, el('span', { textContent: label }), value)),
      );
    },
    validate: async () => {
      const saved = { ...draft, onboarded: true };
      delete saved.hasToken;
      config = await call('save', saved);
      await call('open-at-login', config.openAtLogin);
      await call('start');
    },
  },
];

function openWizard() {
  draft = { ...config, token: '' };
  if (!config.onboarded) {
    // Empfehlungen für die Ersteinrichtung.
    Object.assign(draft, {
      frames: 0,
      r6Texts: true,
      pauseWhileGaming: true,
      keepR6Replays: true,
      autoStart: true,
      notify: true,
      analyze: true,
    });
  }
  wizard.serverOk = !!config.hasToken;
  wizard.useKey = false;
  step = 0;
  $('wizard').hidden = false;
  $('app').inert = true;
  renderWizard();
}
function closeWizard() {
  $('wizard').hidden = true;
  $('app').inert = false;
}
function renderWizard() {
  const current = STEPS[step];
  $('wizard-steps').replaceChildren(
    ...STEPS.map((s, i) =>
      el('li', {
        textContent: s.name,
        dataset: { state: i < step ? 'done' : i === step ? 'current' : 'todo' },
      }),
    ),
  );
  $('wizard-eyebrow').textContent = current.eyebrow;
  $('wizard-title').textContent = current.title;
  $('wizard-lead').textContent = current.lead;
  $('wizard-error').textContent = '';
  const content = current.render();
  $('wizard-content').replaceChildren(content);
  $('wizard-back').hidden = step === 0;
  $('wizard-back').textContent = 'Zurück';
  $('wizard-next').textContent = current.next || 'Weiter';
  $('wizard-skip').hidden = !current.skip;
  $('wizard-skip').textContent = current.skip || '';
  $('wizard-title').focus();
}
async function advance(skip = false) {
  const current = STEPS[step];
  $('wizard-next').disabled = true;
  $('wizard-error').textContent = '';
  try {
    if (skip) current.onSkip?.();
    else await current.validate?.();
    if (step === STEPS.length - 1) {
      closeWizard();
      showView('overview');
    } else {
      step++;
      renderWizard();
    }
  } catch (e) {
    $('wizard-error').textContent = e.message;
  } finally {
    $('wizard-next').disabled = false;
  }
}
$('wizard-next').onclick = () => advance();
$('wizard-skip').onclick = () => advance(true);
$('wizard-back').onclick = () => {
  if (step > 0) step--;
  renderWizard();
};
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('wizard').hidden && config?.onboarded) closeWizard();
});

/* ---------- Start ---------- */

let lastPairing = 'null';
function render(s) {
  status = s;
  renderOverview(s);
  renderSettingsLock(s);
  if (!$('wizard').hidden && step === 3) STEPS[3].paint?.();
  const pairing = JSON.stringify(s.pairing);
  if (pairing !== lastPairing) {
    lastPairing = pairing;
    if (!$('wizard').hidden && step === 1) STEPS[1].paint?.();
    renderSettingsPairing(s.pairing);
  }
}
window.vault.onStatus(render);
void run(async () => {
  const loaded = await call('load');
  config = loaded.config;
  render(loaded.status);
  if (!config.onboarded) openWizard();
});

/* ---------- Kopplung in den Einstellungen ---------- */

function renderSettingsPairing(pairing) {
  if (!pairing) return;
  const result = $('server-result');
  result.textContent =
    pairing.state === 'waiting'
      ? `Code ${pairing.code.slice(0, 3)} ${pairing.code.slice(3)} · in der Web-Oberfläche unter „Geräte“ freigeben`
      : pairing.message;
  result.dataset.tone =
    pairing.state === 'approved' ? 'ok' : pairing.state === 'waiting' ? '' : 'bad';
  if (pairing.state === 'approved' && config) {
    config.server = pairing.server;
    config.hasToken = true;
    $('server').value = pairing.server;
  }
}
$('pair-server').onclick = () => run(() => call('pair-start', $('server').value.trim()));
