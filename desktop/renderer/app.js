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

/* ---------- Language ---------- */

// Dictionaries live in i18n.js, loaded before this file.
const I18N = window.I18N;
const LOCALES = { en: 'en-US', de: 'de-DE' };
let language = 'en';

/** Text for a key in the current language, with {placeholders} filled from params. */
function t(key, params = {}) {
  let text = I18N[language]?.[key] ?? I18N.en[key] ?? key;
  if (typeof text === 'object') text = params.count === 1 ? text.one : text.other;
  return text.replace(/\{(\w+)\}/g, (match, name) =>
    params[name] === undefined ? match : String(params[name]),
  );
}
function locale() {
  return LOCALES[language] || LOCALES.en;
}
/** Sets the static texts marked with data-i18n* inside root. */
function applyLanguage(root = document) {
  for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const [attribute, data] of [
    ['placeholder', 'i18nPlaceholder'],
    ['title', 'i18nTitle'],
    ['aria-label', 'i18nAriaLabel'],
  ])
    for (const node of root.querySelectorAll(`[data-i18n-${attribute}]`))
      node.setAttribute(attribute, t(node.dataset[data]));
}
/** Switches the window language; everything visible is redrawn without a restart. */
function setLanguage(lang) {
  language = I18N[lang] ? lang : 'en';
  document.documentElement.lang = language;
  $('language').value = language;
  applyLanguage();
  if (config) {
    fillTokenPlaceholder();
    if (!$('settings').hidden) void describeFolder();
  }
  $('save-result').textContent = '';
  if (status) {
    render(status);
    renderSettingsPairing(status.pairing);
  }
  if (!$('wizard').hidden) renderWizard();
}
/** Saves only the language, which the main process allows even while the client is running. */
async function saveLanguage(lang) {
  setLanguage(lang);
  if (!config) return;
  const values = { ...config, token: '', language };
  delete values.hasToken;
  config = await call('save', values);
}
$('language').onchange = () => run(() => saveLanguage($('language').value));

/**
 * Progress messages come from the analysis in the main process (agent/ollama.ts). Older builds
 * wrote them in German, newer ones in English; both are recognized and shown in the window
 * language. Anything unknown is shown as is.
 */
const PROGRESS = [
  [/(?:Abschnitt|section|part|batch) (\d+) (?:von|of) (\d+)/i, 'progress.section'],
  [/(?:Modell wird geladen|downloading model|pulling model)\D*(\d+)\s*%/i, 'progress.download'],
  [/Aufnahme werden vorbereitet|preparing (?:the )?frames/i, 'progress.prepare'],
  [/Texterkennung liest|text recognition is reading/i, 'progress.texts'],
  [/Spracherkennung schreibt|speech recognition is transcribing/i, 'progress.speech'],
  [/zusammengefasst|summari[sz]ing|writing (?:the )?title, description/i, 'progress.summary'],
  [/Titel wird überarbeitet|revising the title/i, 'progress.revise'],
];
function localizeMessage(message) {
  for (const [pattern, key] of PROGRESS) {
    const match = pattern.exec(message || '');
    if (!match) continue;
    return key === 'progress.section'
      ? t(key, { current: match[1], total: match[2] })
      : key === 'progress.download'
        ? t(key, { percent: match[1] })
        : t(key);
  }
  return message;
}

/* ---------- Display helpers ---------- */

/** "Valorant 2026.09.25 - 21.14.02.03.DVR.mp4" → "Sep 25, 2026 · 9:14 PM" */
function clipName(file) {
  const m = /(\d{4})\.(\d{2})\.(\d{2}) - (\d{2})\.(\d{2})/.exec(file);
  if (!m) return file.replace(/\.[^.]+$/, '');
  const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return t('clip.when', {
    date: at.toLocaleDateString(locale(), { dateStyle: 'medium' }),
    time: at.toLocaleTimeString(locale(), { timeStyle: 'short' }),
  });
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
  if (minutes < 1) return t('ago.now');
  if (minutes < 60) return t('ago.minutes', { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('ago.hours', { count: hours });
  const date = new Date(at);
  return date.toLocaleDateString(locale(), { day: '2-digit', month: '2-digit' });
}
function megabytes(bytes) {
  return bytes >= 1e9
    ? `${(bytes / 1e9).toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} GB`
    : `${Math.round(bytes / 1e6)} MB`;
}
/** Median of the latest processing times, for the remaining time and the key figure. */
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

/* ---------- Overview ---------- */

function mode(s) {
  if (!config?.onboarded) return 'setup';
  if (!s.running) return 'off';
  if (s.gaming) return 'gaming';
  if (s.paused) return 'paused';
  return s.active ? 'working' : 'running';
}
/** Pill, eyebrow, title and button label per mode, from the dictionary (mode.<mode>.<part>). */
function modeText(m) {
  return Object.fromEntries(
    ['pill', 'eyebrow', 'title', 'action'].map((part) => [part, t(`mode.${m}.${part}`)]),
  );
}

function renderOverview(s) {
  const m = mode(s);
  const text = modeText(m);
  const pill = $('pill');
  pill.dataset.state = m === 'setup' ? 'off' : m;
  pill.lastElementChild.textContent =
    m === 'gaming' ? t('pill.gaming', { game: gameName(s.gaming) }) : text.pill;
  $('hero-orb').dataset.state = m === 'setup' ? 'off' : m;
  $('hero-eyebrow').textContent = text.eyebrow;
  $('hero-title').textContent = text.title;
  $('hero-message').textContent =
    m === 'setup'
      ? t('hero.setup')
      : m === 'gaming'
        ? s.queue.length
          ? t('hero.gamingQueue', { game: gameName(s.gaming), count: s.queue.length })
          : t('hero.gamingNone', { game: gameName(s.gaming) })
        : localizeMessage(s.message);
  const action = $('primary-action');
  action.textContent = text.action;
  action.className = ['running', 'working', 'gaming'].includes(m)
    ? 'secondary large'
    : 'primary large';
  action.disabled = s.downloading;

  const open = s.queue.length + (s.active ? 1 : 0);
  const average = averageSeconds(s.recent);
  $('stat-queue').textContent = String(open);
  $('stat-queue-eta').textContent =
    s.gaming && open
      ? t('stat.afterGaming')
      : open
        ? average
          ? t('stat.eta', { time: duration(open * average) })
          : t('stat.open', { count: open })
        : t('stat.none');
  const midnight = new Date().setHours(0, 0, 0, 0);
  const today = s.recent.filter((r) => r.at >= midnight);
  $('stat-today').textContent = String(today.length);
  $('stat-today-note').textContent = today[0] ? t('stat.last', { ago: ago(today[0].at) }) : ' ';
  $('stat-total').textContent = String(s.uploaded);
  $('stat-average').textContent = average ? t('stat.average', { time: duration(average) }) : ' ';

  renderActive(s.active);
  // What waits because a game is running or the client is paused is told by the marker.
  const hold = s.gaming
    ? t('queue.afterGaming')
    : s.running && s.paused
      ? t('mode.paused.pill')
      : '';
  renderQueue(s.queue, average, !!s.active, hold);
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
  $('now-name').textContent = t('clip.from', { when: clipName(active.name) });
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
      ? t('detail.prepare')
      : active.step === 'view'
        ? active.total
          ? t('detail.viewOf', { current: active.current, total: active.total })
          : t('detail.view')
        : active.step === 'summary'
          ? t('detail.summary')
          : t('detail.upload');
  tickElapsed();
}
function tickElapsed() {
  const active = status?.active;
  $('now-elapsed').textContent = active ? duration((Date.now() - active.since) / 1000) : '';
}
setInterval(tickElapsed, 1000);

/** Queue entry state → dictionary key and chip tone. */
const STATES = {
  waiting: ['state.waiting', ''],
  settling: ['state.settling', 'accent'],
  retry: ['state.retry', 'bad'],
  deferred: ['state.deferred', 'warn'],
};
function renderQueue(queue, average, busy, hold) {
  $('queue-count').textContent = String(queue.length);
  $('queue-empty').hidden = queue.length > 0;
  $('queue-list').replaceChildren(
    ...queue.slice(0, 100).map((entry, i) => {
      const [key, color] = STATES[entry.state] || STATES.waiting;
      const [label, tone] = hold && entry.state === 'waiting' ? [hold, 'warn'] : [t(key), color];
      const eta =
        average && !hold && entry.state === 'waiting'
          ? t('queue.eta', { time: duration((i + (busy ? 1 : 0)) * average) })
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
        { className: 'clickable', tabIndex: 0, title: t('recent.open') },
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
            .map((tag) => el('span', { className: 'tag', textContent: tag })),
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

/* ---------- Player names ---------- */

function nameRows(container, entries) {
  const add = (entry = { name: '', game: '' }) => {
    // The texts come from data-i18n-* so a language switch also reaches existing rows.
    const name = el('input', {
      className: 'player-name',
      maxLength: 60,
      value: entry.name,
      dataset: { i18nPlaceholder: 'names.placeholder', i18nAriaLabel: 'names.aria' },
    });
    const game = el('input', {
      className: 'player-game',
      maxLength: 100,
      value: entry.game,
      dataset: { i18nPlaceholder: 'names.gamePlaceholder', i18nAriaLabel: 'names.gameAria' },
    });
    game.setAttribute('list', 'game-suggestions');
    const remove = el('button', {
      type: 'button',
      className: 'secondary remove-name',
      textContent: '×',
      dataset: { i18nTitle: 'names.remove', i18nAriaLabel: 'names.remove' },
    });
    const row = el('div', { className: 'name-row' }, name, game, remove);
    applyLanguage(row);
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

/* ---------- Settings ---------- */

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
function fillTokenPlaceholder() {
  $('token').placeholder = config.hasToken ? t('token.saved') : t('token.new');
}
function fillSettings() {
  if (!config) return;
  $('server').value = config.server;
  $('token').value = '';
  fillTokenPlaceholder();
  $('folder').value = config.folder;
  $('game').value = config.game;
  $('frames').value = String(config.frames);
  $('language').value = language;
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
    language,
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
  $('model-state').textContent = s.model
    ? t('model.ready')
    : s.ollama
      ? t('model.missing')
      : t('model.unchecked');
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
    ? t('folder.info', {
        clips: t('count.clips', { count: info.clips }),
        games: t('count.games', { count: info.games.length }),
        list: `${info.games
          .slice(0, 5)
          .map((g) => gameName(g.game))
          .join(', ')}${info.games.length > 5 ? ' …' : ''}`,
      })
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
    $('save-result').textContent = t('result.saved');
    $('save-result').dataset.tone = 'ok';
  });
};
$('settings-pause').onclick = () => run(() => call('pause'));
$('test-server').onclick = () =>
  run(async () => {
    $('server-result').textContent = t('result.checking');
    $('server-result').dataset.tone = '';
    try {
      const result = await call('test-server', {
        server: $('server').value.trim(),
        token: $('token').value,
      });
      $('server-result').textContent = t('result.connected', {
        clips: t('count.clips', { count: result.clips }),
      });
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

/* ---------- Setup wizard ---------- */

let draft = null;
let step = 0;
const wizard = { serverOk: false, clips: 0, games: [], ai: null, names: null };

function recommendedChip() {
  return el('span', {
    className: 'chip',
    textContent: t('recommended'),
    dataset: { tone: 'accent' },
  });
}
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
      el('b', {}, title, recommended ? recommendedChip() : null),
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

/**
 * The wizard steps. Name, eyebrow, title and lead come from the dictionary under w.<key>.*;
 * `next` and `skip` mark steps with their own button labels (w.<key>.next, w.<key>.skip).
 */
const STEPS = [
  {
    key: 'welcome',
    next: true,
    render: () => {
      const choice = el(
        'select',
        {},
        el('option', { value: 'en', textContent: 'English' }),
        el('option', { value: 'de', textContent: 'Deutsch' }),
      );
      choice.value = language;
      choice.onchange = () =>
        run(async () => {
          draft.language = choice.value;
          await saveLanguage(choice.value);
        });
      return el(
        'div',
        { className: 'wizard-content' },
        el(
          'div',
          { className: 'features' },
          ...[
            ['◉', 'recordings'],
            ['✦', 'ai'],
            ['▶', 'archive'],
          ].map(([icon, feature]) =>
            el(
              'div',
              { className: 'feature' },
              el('span', { className: 'feature-icon', textContent: icon }),
              el('b', { textContent: t(`w.feature.${feature}`) }),
              el('p', { textContent: t(`w.feature.${feature}Text`) }),
            ),
          ),
        ),
        el('label', { className: 'field language-field' }, t('field.language'), choice),
      );
    },
  },
  {
    key: 'server',
    render: () => {
      const box = el('div', { className: 'wizard-content' });
      const address = el('input', {
        type: 'text',
        value: draft.server,
        placeholder: t('w.server.placeholder'),
        spellcheck: false,
      });
      const token = el('input', {
        type: 'password',
        autocomplete: 'off',
        placeholder: t('w.server.tokenPlaceholder'),
      });
      const keyResult = el('div');
      address.oninput = () => (wizard.serverOk = false);
      const paint = () => {
        const p = status?.pairing;
        const children = [field(t('field.server'), address)];
        if (wizard.useKey) {
          const test = el('button', {
            type: 'button',
            className: 'primary',
            textContent: t('w.server.check'),
          });
          test.onclick = async () => {
            draft.server = address.value.trim();
            draft.token = token.value;
            keyResult.replaceChildren(checkLine('', t('w.server.checking')));
            try {
              const info = await call('test-server', { server: draft.server, token: draft.token });
              wizard.serverOk = true;
              keyResult.replaceChildren(
                checkLine(
                  'ok',
                  t('result.connected', { clips: t('count.clips', { count: info.clips }) }),
                ),
              );
            } catch (e) {
              wizard.serverOk = false;
              keyResult.replaceChildren(checkLine('bad', e.message));
            }
          };
          const back = el('button', {
            type: 'button',
            className: 'link',
            textContent: t('w.server.pairInstead'),
          });
          back.onclick = () => {
            wizard.useKey = false;
            paint();
          };
          children.push(
            field(t('field.token'), token),
            el('div', { className: 'row' }, test, back),
            keyResult,
          );
        } else if (p?.state === 'waiting') {
          const open = el('button', {
            type: 'button',
            className: 'primary',
            textContent: t('w.server.openDevices'),
          });
          open.onclick = () => run(() => call('open-devices'));
          const cancel = el('button', {
            type: 'button',
            className: 'ghost',
            textContent: t('btn.cancel'),
          });
          cancel.onclick = () => run(() => call('pair-cancel'));
          children.push(
            el(
              'div',
              { className: 'pair-card' },
              el('span', { className: 'eyebrow', textContent: t('w.server.code') }),
              el('strong', {
                className: 'pair-code',
                textContent: `${p.code.slice(0, 3)} ${p.code.slice(3)}`,
              }),
              el('p', { textContent: t('w.server.codeText') }),
              el('div', { className: 'row' }, open, cancel),
            ),
            checkLine('', p.message),
          );
        } else if (p?.state === 'approved' || wizard.serverOk) {
          if (p?.state === 'approved') draft.server = p.server;
          wizard.serverOk = true;
          children.push(
            checkLine('ok', p?.state === 'approved' ? p.message : t('w.server.paired')),
          );
        } else {
          const connect = el('button', {
            type: 'button',
            className: 'primary',
            textContent: t('w.server.connect'),
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
            textContent: t('w.server.useKey'),
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
      if (!wizard.serverOk) throw new Error(t('w.server.error'));
    },
  },
  {
    key: 'rec',
    render: () => {
      const folder = el('input', {
        readOnly: true,
        value: draft.folder,
        placeholder: t('w.rec.placeholder'),
      });
      const pick = el('button', {
        type: 'button',
        className: 'secondary',
        textContent: t('w.rec.pick'),
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
        existingLabel.textContent = t('w.rec.existingNote', { count: result.clips });
        info.replaceChildren(
          checkLine(
            result.clips ? 'ok' : 'warn',
            result.clips
              ? t('w.rec.found', {
                  clips: t('count.clips', { count: result.clips }),
                  games: t('count.games', { count: result.games.length }),
                })
              : t('w.rec.none'),
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
          el('span', {}, el('b', { textContent: t('w.rec.existing') }), existingLabel),
        ),
      );
    },
    validate: () => {
      if (!draft.folder) throw new Error(t('w.rec.error'));
    },
  },
  {
    key: 'ai',
    render: () => {
      const box = el('div', { className: 'wizard-content' });
      const paint = () => {
        const s = status;
        const ai = wizard.ai;
        const lines = [];
        if (!ai) lines.push(checkLine('', t('w.ai.checking')));
        else {
          lines.push(
            checkLine(
              ai.running ? 'ok' : 'bad',
              ai.running ? t('w.ai.running') : t('w.ai.notRunning'),
            ),
          );
          if (ai.running)
            lines.push(
              checkLine(
                ai.installed ? 'ok' : s.downloading ? '' : 'warn',
                ai.installed
                  ? t('w.ai.ready')
                  : s.downloading
                    ? localizeMessage(s.message)
                    : t('w.ai.missing'),
              ),
            );
        }
        const buttons = [];
        if (ai && !ai.running) {
          const install = el('button', {
            type: 'button',
            className: 'primary',
            textContent: t('w.ai.downloadOllama'),
          });
          install.onclick = () => run(() => call('ollama-install'));
          buttons.push(install);
        }
        if (ai && ai.running && !ai.installed && !s.downloading) {
          const download = el('button', {
            type: 'button',
            className: 'primary',
            textContent: t('btn.downloadModel'),
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
            textContent: t('btn.cancel'),
          });
          cancel.onclick = () => run(() => call('cancel-download'));
          buttons.push(cancel);
        }
        const again = el('button', {
          type: 'button',
          className: 'ghost',
          textContent: t('w.ai.again'),
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
    skip: true,
    onSkip: () => (draft.analyze = false),
    validate: () => {
      if (!wizard.ai?.installed) throw new Error(t('w.ai.error'));
      draft.analyze = true;
    },
  },
  {
    key: 'names',
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
        textContent: t('names.add'),
      });
      add.onclick = () => wizard.names.add().focus();
      return el('div', { className: 'wizard-content' }, container, el('div', {}, add));
    },
    validate: () => {
      draft.playerNames = wizard.names.read();
    },
  },
  {
    key: 'detect',
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
            el('b', {}, t('w.detect.whole'), recommendedChip()),
            el('small', { textContent: t('w.detect.wholeNote') }),
          ),
        ),
        option('r6Texts', t('opt.texts'), t('w.detect.textsNote'), {
          recommended: r6 || hasGame(/valorant/i),
        }),
        option('pauseWhileGaming', t('opt.pauseGaming'), t('w.detect.pauseNote'), {
          recommended: true,
        }),
        option('speech', t('opt.speech'), t('w.detect.speechNote')),
        option('keepR6Replays', t('w.detect.keepR6'), t('w.detect.keepR6Note'), {
          recommended: r6,
        }),
        option('fortniteReplays', t('opt.fortnite'), t('w.detect.fortniteNote'), {
          recommended: hasGame(/fortnite/i),
        }),
        option('autoStart', t('w.detect.autoStart'), t('w.detect.autoStartNote'), {
          recommended: true,
        }),
        option('openAtLogin', t('opt.openAtLogin'), t('w.detect.openAtLoginNote')),
        option('notify', t('w.detect.notify'), t('w.detect.notifyNote')),
      );
    },
  },
  {
    key: 'done',
    next: true,
    render: () => {
      const on = (value) => (value ? t('w.done.on') : t('w.done.off'));
      const items = [
        [t('w.server.name'), draft.server],
        [
          t('w.rec.name'),
          `${draft.folder}${wizard.clips ? ` · ${t('count.clips', { count: wizard.clips })}` : ''}`,
        ],
        [
          t('w.ai.name'),
          draft.analyze
            ? t('w.done.ai', {
                scope:
                  draft.frames === 0
                    ? t('w.done.whole')
                    : t('w.done.frames', { count: draft.frames }),
              })
            : t('w.done.noAi'),
        ],
        [
          t('w.names.name'),
          draft.playerNames.length
            ? draft.playerNames.map((n) => n.name).join(', ')
            : t('w.done.noNames'),
        ],
        [
          t('w.detect.name'),
          t('w.done.detection', {
            texts: on(draft.r6Texts),
            speech: on(draft.speech),
            replays: on(draft.keepR6Replays || draft.fortniteReplays),
          }),
        ],
        [
          t('card.behavior'),
          t('w.done.behavior', {
            pause: on(draft.pauseWhileGaming),
            login: on(draft.openAtLogin),
          }),
        ],
      ];
      return el(
        'ul',
        { className: 'summary' },
        ...items.map(([label, value]) => el('li', {}, el('span', { textContent: label }), value)),
      );
    },
    validate: async () => {
      const saved = { ...draft, language, onboarded: true };
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
    // Recommendations for the first setup.
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
  const text = (part) => t(`w.${current.key}.${part}`);
  $('wizard-steps').replaceChildren(
    ...STEPS.map((s, i) =>
      el('li', {
        textContent: t(`w.${s.key}.name`),
        dataset: { state: i < step ? 'done' : i === step ? 'current' : 'todo' },
      }),
    ),
  );
  $('wizard-eyebrow').textContent = text('eyebrow');
  $('wizard-title').textContent = text('title');
  $('wizard-lead').textContent = text('lead');
  $('wizard-error').textContent = '';
  const content = current.render();
  $('wizard-content').replaceChildren(content);
  $('wizard-back').hidden = step === 0;
  $('wizard-back').textContent = t('btn.back');
  $('wizard-next').textContent = current.next ? text('next') : t('btn.next');
  $('wizard-skip').hidden = !current.skip;
  $('wizard-skip').textContent = current.skip ? text('skip') : '';
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
  setLanguage(config.language);
  render(loaded.status);
  if (!config.onboarded) openWizard();
});

/* ---------- Pairing in the settings ---------- */

function renderSettingsPairing(pairing) {
  if (!pairing) return;
  const result = $('server-result');
  result.textContent =
    pairing.state === 'waiting'
      ? t('pair.settings', { code: `${pairing.code.slice(0, 3)} ${pairing.code.slice(3)}` })
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
