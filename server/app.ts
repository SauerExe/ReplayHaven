import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import cookie from '@fastify/cookie';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { z } from 'zod';
import { aiConfigured } from './config';
import type { ServerConfig } from './config';
import { VaultDatabase, publicClip } from './database';
import type { StoredClip } from './database';
import { MediaProcessor } from './media';
import { createProvider } from './providers';
import type { AnalysisProvider } from './providers';
import { AnalysisWorker } from './worker';
import { analysisSchema, parseAnalysis, clipPatchSchema, settingsSchema } from './schema';
const idSchema = z.string().uuid();
function tokenEqual(a: string, b: string) {
  return timingSafeEqual(
    createHash('sha256').update(a).digest(),
    createHash('sha256').update(b).digest(),
  );
}
export async function buildServer(
  config: ServerConfig,
  overrides: { provider?: AnalysisProvider; media?: MediaProcessor } = {},
) {
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024, requestTimeout: 30 * 60000 });
  const db = new VaultDatabase(config.dataDir);
  const media = overrides.media || new MediaProcessor(config);
  const worker = new AnalysisWorker(
    db,
    config,
    media,
    overrides.provider || createProvider(config, media),
  );
  await mkdir(join(config.dataDir, 'incoming'), { recursive: true });
  await app.register(cookie, {
    secret: createHash('sha256')
      .update(config.token || 'local-loopback-only')
      .digest('hex'),
  });
  await app.register(multipart, { limits: { fileSize: 2 * 1024 ** 3, files: 1, fields: 5 } });
  await app.register(fastifyStatic, { root: resolve('dist'), serve: false });
  const origins = new Set([
    config.publicOrigin,
    `http://localhost:${config.port}`,
    `http://127.0.0.1:${config.port}`,
  ]);
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    if (req.headers.origin && !origins.has(req.headers.origin))
      return reply.code(403).send({ error: 'Diese Herkunft ist nicht freigegeben.' });
    if (!config.token || req.url === '/api/session') return;
    const bearer = req.headers.authorization?.replace(/^Bearer /, '') || '';
    const signed = req.cookies.vault_session ? req.unsignCookie(req.cookies.vault_session) : null;
    if (!tokenEqual(bearer, config.token) && !(signed?.valid && signed.value === 'vault'))
      return reply.code(401).send({ error: 'Bitte mit deinem Server-Zugangsschlüssel verbinden.' });
  });
  app.setErrorHandler((error, req, reply) => {
    void req;
    const status =
      error instanceof z.ZodError ? 400 : (error as { statusCode?: number }).statusCode || 500;
    reply.code(status).send({
      error:
        status === 413
          ? 'Die Datei ist größer als 2 GB.'
          : status === 400
            ? 'Die Eingaben oder die Videodatei sind ungültig.'
            : status === 404
              ? 'Eintrag nicht gefunden.'
              : status === 409 && error instanceof Error
                ? error.message
                : 'Die Anfrage konnte nicht verarbeitet werden. Prüfe Server und Datei.',
    });
  });
  app.post('/api/session', async (req, reply) => {
    const { token } = z.object({ token: z.string().max(1000) }).parse(req.body);
    if (config.token && !tokenEqual(token, config.token))
      return reply.code(401).send({ error: 'Der Zugangsschlüssel stimmt nicht.' });
    reply.setCookie('vault_session', 'vault', {
      signed: true,
      httpOnly: true,
      sameSite: 'strict',
      secure: config.publicOrigin.startsWith('https:'),
      path: '/api',
      maxAge: 7 * 86400,
    });
    return { connected: true };
  });
  const releaseDir = resolve(config.releaseDir || 'release');
  const downloadPath = join(releaseDir, 'ReplayHaven-Client-Setup.exe');
  const localInstaller = () =>
    stat(downloadPath).then(
      () => true,
      () => false,
    );
  app.get('/api/status', async () => ({
    connected: true,
    provider: config.provider,
    configured: aiConfigured(config),
    model: config.model,
    settings: db.settings(),
    queue: db
      .list()
      .filter(
        (c) =>
          !c.deleted &&
          (c.status === 'processing' ||
            ['queued', 'preparing', 'analyzing'].includes(c.analysis?.status || '')),
      ).length,
    devices: db.devices(),
    clientDownloadAvailable: (await localInstaller()) || !!config.clientDownloadUrl,
  }));
  app.get('/api/downloads/windows', async (_req, reply) => {
    if (await localInstaller()) {
      reply.header('Content-Disposition', 'attachment; filename="ReplayHaven-Client-Setup.exe"');
      return reply.sendFile('ReplayHaven-Client-Setup.exe', releaseDir);
    }
    // Published releases (GitHub) when no installer is mounted next to the server.
    if (config.clientDownloadUrl) return reply.redirect(config.clientDownloadUrl, 302);
    return reply
      .code(404)
      .send({ error: 'Der Windows-Installer wurde auf diesem Server noch nicht bereitgestellt.' });
  });
  app.put('/api/settings/analysis', async (req) => {
    const settings = settingsSchema.parse(req.body);
    db.saveSettings(settings);
    return settings;
  });
  app.get('/api/clips', async () =>
    db
      .list()
      .filter((c) => !c.deleted)
      .map(publicClip),
  );
  app.get<{ Params: { id: string } }>('/api/clips/:id', async (req, reply) => {
    const clip = db.get(idSchema.parse(req.params.id));
    if (!clip || clip.deleted) return reply.code(404).send({ error: 'Clip nicht gefunden.' });
    return publicClip(clip);
  });
  app.post('/api/clips', async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'Wähle eine Videodatei.' });
    const extension = extname(file.filename).toLowerCase();
    if (!['.mp4', '.m4v', '.mov', '.webm', '.mkv'].includes(extension)) {
      file.file.resume();
      return reply.code(400).send({ error: 'Unterstützt werden MP4, WebM, MOV, M4V und MKV.' });
    }
    const id = randomUUID();
    const temporary = join(config.dataDir, 'incoming', `${id}.part`);
    const hash = createHash('sha256');
    let size = 0;
    try {
      await pipeline(
        file.file,
        new Transform({
          transform(chunk, _encoding, callback) {
            size += chunk.length;
            hash.update(chunk);
            callback(null, chunk);
          },
        }),
        createWriteStream(temporary, { flags: 'wx' }),
      );
      if (file.file.truncated || !size)
        return reply.code(file.file.truncated ? 413 : 400).send({
          error: file.file.truncated ? 'Die Datei ist größer als 2 GB.' : 'Die Datei ist leer.',
        });
      const digest = hash.digest('hex');
      const duplicate = db.findHash(digest);
      if (duplicate) {
        if (duplicate.deleted) db.patch(duplicate.id, { deleted: false });
        return reply.code(200).send({ clip: publicClip(db.get(duplicate.id)!), duplicate: true });
      }
      const directory = join(config.dataDir, 'clips', id);
      await mkdir(directory, { recursive: true });
      const originalFile = join(directory, `original${extension}`);
      await rename(temporary, originalFile);
      const header = (name: string) => {
        const value = req.headers[name];
        try {
          return decodeURIComponent(typeof value === 'string' ? value : '').slice(0, 160);
        } catch {
          return '';
        }
      };
      const recorded = header('x-recorded-at');
      const clip: StoredClip = {
        id,
        title: file.filename.replace(/\.[^.]+$/, '').slice(0, 120) || 'Neue Aufnahme',
        gameId: 'recording',
        gameName: header('x-game-name'),
        thumbnail: '',
        duration: 0,
        recordedAt:
          recorded && Number.isFinite(Date.parse(recorded))
            ? new Date(recorded).toISOString()
            : new Date().toISOString(),
        size,
        resolution: 'Wird ermittelt',
        tags: [],
        favorite: false,
        status: 'processing',
        note: '',
        server: true,
        originalName: file.filename.slice(0, 240),
        originalFile,
        hash: digest,
        deviceName: header('x-device-name') || 'Browser-Upload',
        analysis: { status: 'preparing' },
      };
      clip.expectsClientAnalysis = req.headers['x-client-analysis'] === '1';
      db.put(clip);
      worker.kick();
      return reply.code(201).send({ clip: publicClip(clip), duplicate: false });
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
  });
  app.post<{ Params: { id: string } }>('/api/clips/:id/client-analysis', async (req, reply) => {
    const id = idSchema.parse(req.params.id);
    const clip = db.get(id);
    if (!clip || clip.deleted) return reply.code(404).send({ error: 'Clip nicht gefunden.' });
    const payload = z
      .object({
        result: analysisSchema,
        duration: z.number().positive().max(1800),
        model: z.string().min(1).max(100),
      })
      .parse(req.body);
    const actual = await media.probe(clip.originalFile);
    if (Math.abs(payload.duration - actual.duration) > Math.max(1, actual.duration * 0.01))
      return reply.code(400).send({ error: 'Analyse und Videodauer stimmen nicht überein.' });
    const result = parseAnalysis(JSON.stringify(payload.result), actual.duration);
    const latest = db.get(id)!;
    if (latest.deleted) return reply.code(404).send({ error: 'Clip wurde entfernt.' });
    if (latest.analysis?.provider === 'client' && latest.analysis.status === 'ready')
      return publicClip(latest);
    return publicClip(
      db.patch(id, {
        expectsClientAnalysis: true,
        ...(db.settings().autoTitle && !latest.userEditedTitle ? { title: result.title } : {}),
        gameName: latest.gameName || result.game,
        tags: [...new Set([...latest.tags, ...result.tags])].slice(0, 20),
        analysis: {
          status: 'ready',
          provider: 'client',
          model: payload.model,
          input: 'frames',
          result,
          updatedAt: new Date().toISOString(),
        },
      })!,
    );
  });
  app.patch<{ Params: { id: string } }>('/api/clips/:id', async (req, reply) => {
    const id = idSchema.parse(req.params.id);
    const clip = db.get(id);
    if (!clip || clip.deleted) return reply.code(404).send({ error: 'Clip nicht gefunden.' });
    const patch = clipPatchSchema.parse(req.body);
    return publicClip(
      db.patch(id, { ...patch, ...(patch.title ? { userEditedTitle: true } : {}) })!,
    );
  });
  app.delete<{ Params: { id: string } }>('/api/clips/:id', async (req, reply) => {
    const id = idSchema.parse(req.params.id);
    if (!db.get(id)) return reply.code(404).send({ error: 'Clip nicht gefunden.' });
    db.patch(id, { deleted: true });
    return { removed: true };
  });
  app.post<{ Params: { id: string } }>('/api/clips/:id/analyze', async (req, reply) => {
    const id = idSchema.parse(req.params.id);
    const clip = db.get(id);
    if (!clip || clip.deleted) return reply.code(404).send({ error: 'Clip nicht gefunden.' });
    if (!aiConfigured(config))
      return reply.code(409).send({ error: 'Richte zuerst einen KI-Anbieter auf dem Server ein.' });
    if (clip.status !== 'ready')
      return reply.code(409).send({ error: 'Warte, bis die Videoverarbeitung abgeschlossen ist.' });
    if (['queued', 'analyzing', 'preparing'].includes(clip.analysis?.status || ''))
      return reply.code(409).send({ error: 'Die Analyse läuft bereits.' });
    const queued = db.patch(id, {
      analysis: { ...clip.analysis, status: 'queued', error: undefined },
    })!;
    worker.kick();
    return reply.code(202).send(publicClip(queued));
  });
  app.post<{ Params: { id: string } }>('/api/clips/:id/retry-media', async (req, reply) => {
    const id = idSchema.parse(req.params.id);
    const clip = db.get(id);
    if (!clip || clip.deleted) return reply.code(404).send({ error: 'Clip nicht gefunden.' });
    if (clip.status !== 'error')
      return reply.code(409).send({ error: 'Die Videoverarbeitung ist nicht fehlgeschlagen.' });
    db.patch(id, { status: 'processing', analysis: { status: 'preparing' } });
    worker.kick();
    return reply.code(202).send({ queued: true });
  });
  for (const kind of ['video', 'thumbnail', 'download'] as const)
    app.get<{ Params: { id: string } }>(`/api/clips/:id/${kind}`, async (req, reply) => {
      const clip = db.get(idSchema.parse(req.params.id));
      if (!clip || clip.deleted) return reply.code(404).send({ error: 'Clip nicht gefunden.' });
      const directory = join(config.dataDir, 'clips', clip.id);
      const path =
        kind === 'thumbnail'
          ? join(directory, 'thumbnail.jpg')
          : kind === 'download'
            ? clip.originalFile
            : clip.playbackFile;
      if (!path || !(await stat(path).catch(() => null)))
        return reply.code(404).send({ error: 'Die Datei ist noch nicht verfügbar.' });
      if (kind === 'download')
        reply.header(
          'Content-Disposition',
          `attachment; filename="clip${extname(path)}"; filename*=UTF-8''${encodeURIComponent(clip.originalName)}`,
        );
      return reply.sendFile(path.split(/[\\/]/).pop()!, directory);
    });
  app.post('/api/devices/heartbeat', async (req) => {
    const device = z
      .object({
        id: z.string().uuid(),
        name: z.string().min(1).max(100),
        folder: z.string().max(500),
        error: z.string().max(500),
        uploaded: z.number().int().min(0),
        analysisLocation: z.enum(['client', 'server']).optional(),
        paused: z.boolean().optional(),
      })
      .parse(req.body);
    db.putDevice({ ...device, lastSeen: new Date().toISOString() });
    return { received: true };
  });
  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith('/api/'))
      return reply.code(404).send({ error: 'API-Endpunkt nicht gefunden.' });
    const path = decodeURIComponent(req.url.split('?')[0]);
    return reply.sendFile(path.includes('.') ? path.replace(/^\//, '') : 'index.html');
  });
  app.addHook('onClose', async () => {
    await worker.stop();
    db.close();
  });
  worker.recover();
  return { app, db, worker };
}
