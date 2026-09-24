import { contextBridge, ipcRenderer } from 'electron';
const actions = new Set([
  'load',
  'save',
  'folder',
  'games',
  'start',
  'pause',
  'check',
  'download',
  'cancel-download',
  'ollama-install',
  'archive',
]);
contextBridge.exposeInMainWorld('vault', {
  call: (action: string, value?: unknown) => {
    if (!actions.has(action)) return Promise.reject(new Error('Unbekannte Aktion'));
    return ipcRenderer.invoke(`vault:${action}`, value);
  },
  onStatus: (callback: (status: unknown) => void) => {
    const listener = (_event: unknown, status: unknown) => callback(status);
    ipcRenderer.on('vault:status', listener);
    return () => ipcRenderer.removeListener('vault:status', listener);
  },
});
