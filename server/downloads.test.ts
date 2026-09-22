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
