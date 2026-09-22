const $ = (id) => document.getElementById(id);
async function call(action, value) {
  const response = await window.vault.call(action, value);
  if (!response.ok) throw new Error(response.error);
  return response.value;
}
function error(message = '') {
  $('error').textContent = message;
}
function settings() {
  return {
    folder: $('folder').value,
    server: $('server').value,
    token: $('token').value,
    game: $('game').value,
    includeExisting: $('include-existing').checked,
    analyze: $('analyze').checked,
    frames: Number($('frames').value),
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
  });
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
  $('include-existing').checked = config.includeExisting;
  $('analyze').checked = config.analyze;
  $('frames').value = String(config.frames);
  if (config.hasToken)
    $('token-info').textContent =
      'Zugangsschlüssel ist gespeichert. Leer lassen, um ihn beizubehalten.';
  render(status);
});
