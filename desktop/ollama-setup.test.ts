import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { installOllama, ollamaApp } from './ollama-setup';

afterEach(() => vi.unstubAllGlobals());

it('installs Ollama per user, next to the other local programs', () => {
  expect(ollamaApp('C:\\Users\\A\\AppData\\Local')).toBe(
    join('C:\\Users\\A\\AppData\\Local', 'Programs', 'Ollama', 'ollama app.exe'),
  );
});

it('does nothing while Ollama already answers', async () => {
  const fetch = vi.fn(async (url: string) => Response.json({ models: [], url }));
  vi.stubGlobal('fetch', fetch);
  await installOllama(join(tmpdir(), 'unused'), () => {});
  expect(fetch.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
    '/api/tags',
    '/api/version',
  ]);
});

it('discards a download that does not match the pinned checksum and never runs it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'replayhaven-ollama-'));
  try {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('127.0.0.1')) throw new TypeError('fetch failed');
        return new Response('not the installer');
      }),
    );
    const progress: string[] = [];
    await expect(installOllama(root, (m) => progress.push(m))).rejects.toThrow(/checksum/);
    expect(progress.some((m) => m.startsWith('Downloading Ollama'))).toBe(true);
    expect(progress).not.toContain('Installing Ollama …');
    expect(await readdir(root)).toEqual([]);
  } finally {
    if (resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('replayhaven-ollama-'))
      await rm(root, { recursive: true, force: true });
  }
});
