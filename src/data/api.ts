import type { Clip, ServerInfo } from '../domain/models';
export const disconnectedServer: ServerInfo = {
  connected: false,
  provider: 'none',
  configured: false,
  model: '',
  settings: { autoAnalyze: true, autoTitle: true, includeAudio: false },
  queue: 0,
  devices: [],
};
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
    signal: options.signal || AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Server antwortet mit HTTP ${response.status}.`);
  }
  return response.json() as Promise<T>;
}
export function uploadToServer(file: File, onProgress: (progress: number) => void): Promise<Clip> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', '/api/clips');
    request.timeout = 30 * 60000;
    request.setRequestHeader('x-recorded-at', new Date(file.lastModified).toISOString());
    request.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    request.onerror = () =>
      reject(new Error('Server nicht erreichbar. Die Datei wurde nicht bestätigt.'));
    request.ontimeout = () =>
      reject(new Error('Der Upload hat zu lange gedauert. Versuche es erneut.'));
    request.onload = () => {
      try {
        const result = JSON.parse(request.responseText);
        if (request.status >= 200 && request.status < 300) resolve(result.clip);
        else reject(new Error(result.error || 'Upload fehlgeschlagen.'));
      } catch {
        reject(new Error('Ungültige Serverantwort.'));
      }
    };
    const form = new FormData();
    form.append('file', file);
    request.send(form);
  });
}
