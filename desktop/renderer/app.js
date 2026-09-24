const $ = (id) => document.getElementById(id);
async function call(action, value) {
  const response = await window.vault.call(action, value);
  if (!response.ok) throw new Error(response.error);
  return response.value;
}
function error(message = '') {
  $('error').textContent = message;
}
/** Eine Zeile der Namensliste: Name, Spiel (leer = alle Spiele) und Entfernen. */
function addNameRow(entry = { name: '', game: '' }) {
  const row = document.createElement('div');
  row.className = 'name-row';
  const name = document.createElement('input');
  name.className = 'player-name';
  name.maxLength = 60;
  name.placeholder = 'Name im Spiel';
  name.setAttribute('aria-label', 'Spielername');
  name.value = entry.name;
  const game = document.createElement('input');
  game.className = 'player-game';
  game.maxLength = 100;
  game.placeholder = 'Alle Spiele';
  game.setAttribute('aria-label', 'Spiel zu diesem Namen');
  game.setAttribute('list', 'game-suggestions');
  game.value = entry.game;
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'secondary remove-name';
  remove.textContent = '×';
  remove.title = 'Namen entfernen';
  remove.setAttribute('aria-label', 'Namen entfernen');
  remove.onclick = () => {
    row.remove();
    if (!$('player-names').children.length) addNameRow();
  };
  row.append(name, game, remove);
  $('player-names').append(row);
  return name;
}
function playerNames() {
  return [...$('player-names').querySelectorAll('.name-row')]
    .map((row) => ({
      name: row.querySelector('.player-name').value.trim(),
      game: row.querySelector('.player-game').value.trim(),
    }))
    .filter((entry) => entry.name);
}
/**
 * Spiele aus dem Aufnahmeordner als Vorschläge, damit Eintrag und Ordnername zusammenpassen.
 * Den Ordner liest der Client nur beim Start und nach der Ordnerwahl, nicht bei jeder Eingabe.
 */
let recorded = [];
async function suggestGames(reload = false) {
  if (reload) recorded = await call('games');
  const games = new Set(recorded);
  if ($('game').value.trim()) games.add($('game').value.trim());
  $('game-suggestions').replaceChildren(
    ...[...games].map((game) => Object.assign(document.createElement('option'), { value: game })),
  );
}
function settings() {
  return {
    folder: $('folder').value,
    server: $('server').value,
    token: $('token').value,
    game: $('game').value,
    playerNames: playerNames(),
    includeExisting: $('include-existing').checked,
    analyze: $('analyze').checked,
    frames: Number($('frames').value),
    fortniteReplays: $('fortnite-replays').checked,
    r6Texts: $('r6-texts').checked,
    epicAccounts: $('epic-accounts')
      .value.split(/[\s,;]+/)
      .filter(Boolean),
  };
}
function render(status) {
  $('status-title').textContent = status.running
    ? status.paused
      ? 'Pausiert'
      : 'Client läuft'
    : 'Bereit zum Einrichten';
  $('status-message').textContent = status.message;
  $('status-dot').classList.toggle('running', status.running && !status.paused);
  $('queue').textContent = `${status.queued} ausstehend · ${status.uploaded} archiviert`;
  $('pause').disabled = !status.running || status.paused;
  $('start').disabled = (status.running && !status.paused) || status.downloading;
  $('save').disabled = status.running && !status.paused;
  $('model-state').textContent = status.model
    ? 'Bereit'
    : status.ollama
      ? 'Modell fehlt'
      : 'Ungeprüft';
  $('download-model').disabled = status.downloading;
  $('cancel-download').hidden = !status.downloading;
}
async function run(action) {
  error();
  try {
    await action();
  } catch (e) {
    error(e.message);
  }
}
$('pick-folder').onclick = () =>
  run(async () => {
    const folder = await call('folder');
    if (folder) $('folder').value = folder;
    await suggestGames(true);
  });
$('add-name').onclick = () => addNameRow().focus();
$('game').onchange = () => run(() => suggestGames());
$('save').onclick = () =>
  run(async () => {
    const result = await call('save', settings());
    $('token').value = '';
    $('token-info').textContent = result.hasToken
      ? 'Zugangsschlüssel ist verschlüsselt gespeichert. Leer lassen, um ihn beizubehalten.'
      : 'Kein Zugangsschlüssel gespeichert.';
  });
$('start').onclick = () =>
  run(async () => {
    await call('save', settings());
    $('token').value = '';
    await call('start');
  });
$('pause').onclick = () => run(() => call('pause'));
$('check-model').onclick = () => run(() => call('check'));
$('install-ollama').onclick = () => run(() => call('ollama-install'));
$('download-model').onclick = () => run(() => call('download'));
$('cancel-download').onclick = () => run(() => call('cancel-download'));
$('archive').onclick = () => run(() => call('archive'));
window.vault.onStatus(render);
void run(async () => {
  const { config, status } = await call('load');
  for (const key of ['folder', 'server', 'game']) $(key).value = config[key];
  for (const entry of config.playerNames) addNameRow(entry);
  if (!config.playerNames.length) addNameRow();
  $('include-existing').checked = config.includeExisting;
  $('analyze').checked = config.analyze;
  $('frames').value = String(config.frames);
  $('fortnite-replays').checked = config.fortniteReplays;
  $('r6-texts').checked = config.r6Texts;
  $('epic-accounts').value = config.epicAccounts.join(', ');
  if (config.hasToken)
    $('token-info').textContent =
      'Zugangsschlüssel ist gespeichert. Leer lassen, um ihn beizubehalten.';
  render(status);
  await suggestGames(true);
});
