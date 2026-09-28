import { afterAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from './app';
import type { ServerConfig } from './config';

describe('Windows client download', () => {
  const token = 'download-test-token-with-32-characters!!';
  const headers = { authorization: `Bearer ${token}` };
  const roots: string[] = [];
  afterAll(async () => {
    for (const root of roots) await rm(root, { recursive: true, force: true });
  });
  async function start(clientDownloadUrl?: string) {
    const root = await mkdtemp(join(tmpdir(), 'replayhaven-download-'));
    roots.push(root);
    const config: ServerConfig = {
      host: '127.0.0.1',
      port: 8787,
      // Tests do not query Steam.
      gameMetadata: false,
      dataDir: join(root, 'archive'),
      token,
      publicOrigin: 'http://localhost:5173',
      provider: 'none',
      model: '',
      geminiKey: '',
      localUrl: '',
      localKey: '',
      releaseDir: join(root, 'release'),
      clientDownloadUrl,
    };
    return { root, vault: await buildServer(config) };
  }

  it('is unavailable without a mounted installer or a published download', async () => {
    const { vault } = await start();
    const status = await vault.app.inject({ url: '/api/status', headers });
    expect(status.json().clientDownloadAvailable).toBe(false);
    const download = await vault.app.inject({ url: '/api/downloads/windows', headers });
    expect(download.statusCode).toBe(404);
    await vault.app.close();
  });

  it('redirects to the published installer when none is mounted locally', async () => {
    const url = 'https://example.invalid/releases/latest/download/ReplayHaven-Client-Setup.exe';
    const { vault } = await start(url);
    const status = await vault.app.inject({ url: '/api/status', headers });
    expect(status.json().clientDownloadAvailable).toBe(true);
    const download = await vault.app.inject({ url: '/api/downloads/windows', headers });
    expect(download.statusCode).toBe(302);
    expect(download.headers.location).toBe(url);
    await vault.app.close();
  });

  it('prefers a locally mounted installer over the published download', async () => {
    const { root, vault } = await start('https://example.invalid/ReplayHaven-Client-Setup.exe');
    await mkdir(join(root, 'release'), { recursive: true });
    await writeFile(join(root, 'release', 'ReplayHaven-Client-Setup.exe'), 'not a real installer');
    const download = await vault.app.inject({ url: '/api/downloads/windows', headers });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-disposition']).toContain('ReplayHaven-Client-Setup.exe');
    expect(download.body).toBe('not a real installer');
    await vault.app.close();
  });
});

describe('Windows client download address', () => {
  const base = { REPLAYHAVEN_ACCESS_TOKEN: 'download-test-token-with-32-characters!!' };
  const baked = 'https://github.com/SauerExe/ReplayHaven/releases/download/v9.9.9/Setup.exe';

  it('keeps the address baked into the image when the override is empty', async () => {
    const { loadConfig } = await import('./config');
    const config = loadConfig({
      ...base,
      REPLAYHAVEN_RELEASE_DOWNLOAD_URL: baked,
      REPLAYHAVEN_CLIENT_DOWNLOAD_URL: '',
    });
    expect(config.clientDownloadUrl).toBe(baked);
  });

  it('lets a set override win over the baked address', async () => {
    const { loadConfig } = await import('./config');
    const own = 'https://example.com/ReplayHaven-Client-Setup.exe';
    const config = loadConfig({
      ...base,
      REPLAYHAVEN_RELEASE_DOWNLOAD_URL: baked,
      REPLAYHAVEN_CLIENT_DOWNLOAD_URL: own,
    });
    expect(config.clientDownloadUrl).toBe(own);
  });
});
