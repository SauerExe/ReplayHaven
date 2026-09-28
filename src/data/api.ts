import type { Clip, ServerInfo } from '../domain/models';
import { t } from '../i18n';
import { localizeServerMessage } from './server-messages';
export const disconnectedServer: ServerInfo = {
  connected: false,
  provider: 'none',
  configured: false,
  model: '',
  settings: { autoAnalyze: true, autoTitle: true, includeAudio: false },
  queue: 0,
  devices: [],
};
/** A failed API request; `status` is the HTTP status, e.g. 401 when a sign-in or key is needed. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
      signal: options.signal || AbortSignal.timeout(15000),
    });
  } catch (error) {
    // The browser's own texts ("Failed to fetch") are neither helpful nor translated.
    if (error instanceof DOMException && error.name === 'AbortError' && options.signal?.aborted)
      throw error;
    throw new ApiError(
      t(
        error instanceof DOMException && error.name === 'TimeoutError'
          ? 'app.api.slow'
          : 'app.api.offline',
      ),
      0,
    );
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(
      data.error
        ? localizeServerMessage(data.error)
        : t('app.api.httpError', { status: response.status }),
      response.status,
    );
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
    request.onerror = () => reject(new Error(t('app.api.unreachable')));
    request.ontimeout = () => reject(new Error(t('app.api.timeout')));
    request.onload = () => {
      try {
        const result = JSON.parse(request.responseText);
        if (request.status >= 200 && request.status < 300) resolve(result.clip);
        else
          reject(
            new Error(
              result.error ? localizeServerMessage(result.error) : t('app.api.uploadFailed'),
            ),
          );
      } catch {
        reject(new Error(t('app.api.invalidResponse')));
      }
    };
    const form = new FormData();
    form.append('file', file);
    request.send(form);
  });
}
