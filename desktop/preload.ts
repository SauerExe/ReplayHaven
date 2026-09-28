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
  'open-clip',
  'reveal',
  'test-server',
  'folder-info',
  'open-at-login',
  'pair-start',
  'pair-cancel',
  'open-devices',
  'discover',
]);
contextBridge.exposeInMainWorld('vault', {
  call: (action: string, value?: unknown) => {
    if (!actions.has(action)) return Promise.reject(new Error('Unknown action'));
    return ipcRenderer.invoke(`vault:${action}`, value);
  },
  onStatus: (callback: (status: unknown) => void) => {
    const listener = (_event: unknown, status: unknown) => callback(status);
    ipcRenderer.on('vault:status', listener);
    return () => ipcRenderer.removeListener('vault:status', listener);
  },
});
