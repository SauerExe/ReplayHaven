import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { buildServer } from './app';
import { MediaProcessor, runFile } from './media';
import type { ServerConfig } from './config';
import type { AnalysisResult } from './schema';

describe('archive and client-analysis pipeline', () => {
  let root: string;
  let vault: Awaited<ReturnType<typeof buildServer>>;
  let config: ServerConfig;
  let video: Buffer;
  let id: string;
  const token = 'integration-test-token-with-32-characters';
  const headers = { authorization: `Bearer ${token}` };
  const result: AnalysisResult = {
    title: 'KI-Titel',
    description: 'Testbeobachtung aus einem ausdrücklich künstlichen Testbild.',
    game: 'Testspiel',
    tags: ['Test'],
    confidence: 'medium',
    uncertainty: 'Testdaten, keine echte KI-Auswertung.',
    highlights: [{ seconds: 1, title: 'Teststelle', description: '' }],
  };
  function upload(extra: Record<string, string> = {}) {
    const boundary = 'replayhaven-integration';
    return vault.app.inject({
      method: 'POST',
      url: '/api/clips',
      headers: {
        ...headers,
        ...extra,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="capture.mp4"\r\nContent-Type: video/mp4\r\n\r\n`,
        ),
        video,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
  }
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'replayhaven-pipeline-'));
    config = {
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
    };
    const media = new MediaProcessor(config);
    const fixture = join(root, 'test-only.mp4');
    await runFile(media.ffmpeg, [
      '-nostdin',
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=purple:s=320x180:r=12',
      '-t',
      '2',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      fixture,
    ]);
    video = await readFile(fixture);
    vault = await buildServer(config);
  });
  afterAll(async () => {
    await vault?.app.close();
    if (
      root &&
      resolve(root).startsWith(resolve(tmpdir()) + sep) &&
      root.includes('replayhaven-pipeline-')
    )
      await rm(root, { recursive: true, force: true });
  });
  it('requires a token, accepts a signed session, and rejects foreign origins', async () => {
    expect((await vault.app.inject('/api/status')).statusCode).toBe(401);
    expect(
      (
        await vault.app.inject({
          url: '/api/status',
          headers: { ...headers, origin: 'https://foreign.invalid' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await vault.app.inject({ method: 'POST', url: '/api/session', payload: { token: 'wrong' } }))
        .statusCode,
    ).toBe(401);
    const login = await vault.app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { token },
    });
    expect(login.statusCode).toBe(200);
    expect(
      (
        await vault.app.inject({
          url: '/api/status',
          headers: { cookie: login.cookies.map((c) => `${c.name}=${c.value}`).join('; ') },
        })
      ).statusCode,
    ).toBe(200);
  });
  it('streams a real MP4, extracts a thumbnail, and serves byte ranges', async () => {
    const uploaded = await upload({ 'x-client-analysis': '1' });
    expect(uploaded.statusCode).toBe(201);
    id = uploaded.json().clip.id;
    await expect.poll(() => vault.db.get(id)?.status, { timeout: 15000 }).toBe('ready');
    expect(vault.db.get(id)?.analysis?.status).toBe('awaiting_client');
    const detail = await vault.app.inject({ url: `/api/clips/${id}`, headers });
    expect(detail.json()).not.toHaveProperty('originalFile');
    const thumbnail = await vault.app.inject({ url: `/api/clips/${id}/thumbnail`, headers });
    expect(thumbnail.statusCode).toBe(200);
    expect(thumbnail.rawPayload.length).toBeGreaterThan(100);
    const range = await vault.app.inject({
      url: `/api/clips/${id}/video`,
      headers: { ...headers, range: 'bytes=0-99' },
    });
    expect(range.statusCode).toBe(206);
    expect(range.rawPayload.length).toBe(100);
    expect((await upload()).json().clip.id).toBe(id);
    expect(vault.db.list()).toHaveLength(1);
  });
  it('validates duration and time marks, preserves manual titles, and stores client metadata idempotently', async () => {
    const send = (body: unknown) =>
      vault.app.inject({
        method: 'POST',
        url: `/api/clips/${id}/client-analysis`,
        headers,
        payload: body as object,
      });
    expect((await send({ result, duration: 100, model: 'test-only' })).statusCode).toBe(400);
    expect(
      (
        await send({
          result: { ...result, highlights: [{ seconds: 5, title: 'Ungültig', description: '' }] },
          duration: 2,
          model: 'test-only',
        })
      ).statusCode,
    ).toBe(400);
    await vault.app.inject({
      method: 'PATCH',
      url: `/api/clips/${id}`,
      headers,
      payload: { title: 'Mein Titel' },
    });
    expect(
      (
        await vault.app.inject({
          method: 'PATCH',
          url: `/api/clips/${id}`,
          headers,
          payload: { originalFile: 'elsewhere' },
        })
      ).statusCode,
    ).toBe(400);
    const saved = await send({ result, duration: 2, model: 'test-only' });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      title: 'Mein Titel',
      gameName: 'Testspiel',
      tags: ['Test'],
      analysis: { status: 'ready', provider: 'client', result },
    });
    // Sending the same result again changes nothing.
    const stamp = vault.db.get(id)?.analysis?.updatedAt;
    await send({ result, duration: 2, model: 'test-only' });
    expect(vault.db.get(id)?.analysis?.updatedAt).toBe(stamp);
    // A new analysis replaces the old one including its tags; a custom title and custom tags stay.
    await vault.app.inject({
      method: 'PATCH',
      url: `/api/clips/${id}`,
      headers,
      payload: { tags: ['Test', 'Eigen'] },
    });
    const replaced = await send({
      result: { ...result, title: 'Anderer Vorschlag', tags: ['Neu'] },
      duration: 2,
      model: 'test-only',
    });
    expect(replaced.json()).toMatchObject({
      title: 'Mein Titel',
      tags: ['Eigen', 'Neu'],
      analysis: { result: { title: 'Anderer Vorschlag' } },
    });
  });
  it('keeps originals after removal and persists metadata across server restarts', async () => {
    const original = vault.db.get(id)!.originalFile;
    const download = await vault.app.inject({ url: `/api/clips/${id}/download`, headers });
    expect(download.rawPayload.equals(video)).toBe(true);
    await vault.app.inject({ method: 'DELETE', url: `/api/clips/${id}`, headers });
    expect((await stat(original)).size).toBe(video.length);
    expect((await vault.app.inject({ url: '/api/clips', headers })).json()).toHaveLength(0);
    expect((await vault.app.inject({ url: `/api/clips/${id}/video`, headers })).statusCode).toBe(
      404,
    );
    await vault.app.close();
    vault = await buildServer(config);
    expect(vault.db.get(id)?.deleted).toBe(true);
    expect((await upload()).json()).toMatchObject({
      duplicate: true,
      clip: { id, title: 'Mein Titel' },
    });
    expect(vault.db.get(id)?.analysis?.result).toEqual({
      ...result,
      title: 'Anderer Vorschlag',
      tags: ['Neu'],
    });
  });

  it('finds an uploaded clip by the SHA-256 of its content', async () => {
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256').update(video).digest('hex');
    const found = await vault.app.inject({ url: `/api/clips/lookup/${hash}`, headers });
    expect(found.json()).toEqual({ clip: { id, removed: false } });
    const unknown = await vault.app.inject({ url: `/api/clips/lookup/${'0'.repeat(64)}`, headers });
    expect(unknown.json()).toEqual({ clip: null });
    const invalid = await vault.app.inject({ url: '/api/clips/lookup/xyz', headers });
    expect(invalid.statusCode).toBe(400);
  });
});
