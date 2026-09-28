import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { checkOllama } from '../agent/ollama';

/**
 * The official Ollama installer, pinned: 0.34.4 ignores `think: false` and the response schema,
 * so the client installs the last version the analysis was measured with. Size and SHA-256 come
 * from the release's sha256sum.txt.
 */
export const OLLAMA_SETUP = {
  version: '0.34.3',
  url: 'https://github.com/ollama/ollama/releases/download/v0.34.3/OllamaSetup.exe',
  bytes: 1570198936,
  sha256: 'fe1cce219b07ba13982a9419bfa3697c911bf77667ee636c967baed1b06ee3a0',
};

/** Where the per-user installer puts Ollama. */
export function ollamaApp(localAppData = process.env.LOCALAPPDATA ?? '') {
  return join(localAppData, 'Programs', 'Ollama', 'ollama app.exe');
}

/** Whether a usable Ollama answers; a known broken version is replaced by the pinned one. */
async function running() {
  return checkOllama().then(
    (ai) => ai.supported,
    () => false,
  );
}

/**
 * Downloads, checks and silently installs Ollama for the current Windows user (no admin rights),
 * then waits until it answers. A download with the wrong size or checksum is deleted, never run.
 */
export async function installOllama(
  workDir: string,
  onProgress: (message: string) => void,
  signal?: AbortSignal,
) {
  if (await running()) return;
  await mkdir(workDir, { recursive: true });
  const setup = join(workDir, 'OllamaSetup.exe');
  try {
    const response = await fetch(OLLAMA_SETUP.url, { signal });
    if (!response.ok || !response.body)
      throw new Error(`The Ollama download failed (HTTP ${response.status}).`);
    const hash = createHash('sha256');
    let received = 0;
    let shown = -1;
    const body = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream);
    body.on('data', (chunk: Buffer) => {
      hash.update(chunk);
      received += chunk.length;
      const percent = Math.floor((received / OLLAMA_SETUP.bytes) * 100);
      if (percent !== shown) onProgress(`Downloading Ollama: ${(shown = percent)} %`);
    });
    await pipeline(body, createWriteStream(setup), { signal });
    if (received !== OLLAMA_SETUP.bytes || hash.digest('hex') !== OLLAMA_SETUP.sha256)
      throw new Error('The Ollama download does not match its checksum and was discarded.');
    onProgress('Installing Ollama …');
    const code = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(
        setup,
        ['/VERYSILENT', '/NORESTART', '/SUPPRESSMSGBOXES', '/CLOSEAPPLICATIONS'],
        {
          windowsHide: true,
        },
      );
      child.once('error', reject);
      child.once('exit', resolve);
    });
    if (code !== 0) throw new Error(`The Ollama installer ended with code ${code}.`);
  } finally {
    await rm(setup, { force: true }).catch(() => {});
  }
  // A silent install may not start the app; start it once so the model can be downloaded.
  if (!(await running())) {
    const app = ollamaApp();
    await access(app).then(
      () => spawn(app, [], { detached: true, stdio: 'ignore', windowsHide: true }).unref(),
      () => {},
    );
  }
  onProgress('Starting Ollama …');
  for (let i = 0; i < 30; i++) {
    if (await running()) return;
    await delay(2000, undefined, { signal });
  }
  throw new Error('Ollama was installed but does not respond. Start it from the Start menu.');
}
