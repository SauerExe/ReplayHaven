import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import cookie from '@fastify/cookie';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, readFileSync } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { z } from 'zod';
import { aiConfigured } from './config';
import type { ServerConfig } from './config';
import { VaultDatabase, publicClip } from './database';
import { Accounts } from './auth';
import { registerAuth } from './auth-routes';
import type { StoredClip } from './database';
import { MediaProcessor } from './media';
import { GameLibrary } from './games';
import { Igdb } from './metadata';
import { createProvider } from './providers';
import type { AnalysisProvider } from './providers';
import { AnalysisWorker } from './worker';
import { PlaybackBackfill } from './playback';
import { analysisSchema, parseAnalysis, clipPatchSchema, settingsSchema } from './schema';

/**
 * The release this server runs: the version the image was built for (REPLAYHAVEN_VERSION, from the
 * git tag), otherwise package.json in the working directory.
 */
const serverVersion = (() => {
  const built = process.env.REPLAYHAVEN_VERSION?.replace(/^v/, '');
  if (built && built !== 'dev') return built;
  try {
    const { version } = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
      version?: unknown;
    };
    return typeof version === 'string' ? version : undefined;
  } catch {
    return undefined;
  }
})();
const idSchema = z.string().uuid();
/** The message of the first validation problem, e.g. a too short password. */
function zodMessage(error: unknown) {
  const issue = error instanceof z.ZodError ? error.issues[0] : undefined;
  if (!issue) return 'The input or the video file is invalid.';
  const field = issue.path.join('.');
  return field ? `Invalid ${field}: ${issue.message}` : issue.message;
}
export async function buildServer(
  config: ServerConfig,
  overrides: { provider?: AnalysisProvider; media?: MediaProcessor } = {},
) {
  const app = Fastify({
    logger: false,
    bodyLimit: 1024 * 1024,
    // Uploads of up to 2 GB over slow connections may take a while.
    requestTimeout: 30 * 60000,
    // Longer than the idle timeout of common reverse proxies (Traefik: 90 s), so a proxy never
    // reuses a connection the server is just closing.
    keepAliveTimeout: 120_000,
    // Behind Traefik, Caddy or nginx: take protocol and client address from X-Forwarded-*.
    // A hop count works at runtime (proxy-addr) although the type only names boolean and string.
    trustProxy: (config.trustProxy ?? false) as boolean | string,
  });
  const db = new VaultDatabase(config.dataDir);
  const media = overrides.media || new MediaProcessor(config);
  const coverDir = join(config.dataDir, 'covers');
  const games = new GameLibrary(
    db,
    coverDir,
    config.gameMetadata,
    config.igdb ? new Igdb(config.igdb) : undefined,
    config.contentLanguage,
  );
  const worker = new AnalysisWorker(
    db,
    config,
    media,
    overrides.provider || createProvider(config, media),
    (name) => {
      games.schedule(name);
    },
    () => playback.kick(),
  );
  // Web renditions for streaming, created one clip at a time in the background (playback.ts).
  const playback = new PlaybackBackfill(db, config.dataDir, media, config.playback ?? 'web', () =>
    worker.hasWork(),
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
    ...(config.extraOrigins ?? []),
    `http://localhost:${config.port}`,
    `http://127.0.0.1:${config.port}`,
  ]);
  /**
   * A page served by this very server calling its own API, e.g. opened at a LAN address such as
   * http://192.168.1.10:8787 that is not listed in REPLAYHAVEN_PUBLIC_ORIGIN. Another site cannot
   * forge this: the browser sets Origin to that site, while Host names this server. Behind a
   * proxy, req.host follows X-Forwarded-Host only when REPLAYHAVEN_TRUST_PROXY trusts it.
   */
  const sameOrigin = (req: { headers: { origin?: string }; host: string; protocol: string }) => {
    try {
      const origin = new URL(req.headers.origin!);
      return origin.host === req.host && origin.protocol === `${req.protocol}:`;
    } catch {
      return false;
    }
  };
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    if (req.headers.origin && !origins.has(req.headers.origin) && !sameOrigin(req))
      return reply.code(403).send({
        error: `The address ${req.headers.origin} is not allowed. Add it to REPLAYHAVEN_PUBLIC_ORIGIN on the server.`,
      });
    if (auth.guard(req, reply)) return reply;
  });
  // Accounts, roles, devices and pairing (server/auth-routes.ts).
  const auth = registerAuth(app, new Accounts(db.db), config);
  app.setErrorHandler((error, req, reply) => {
    void req;
    const status =
      error instanceof z.ZodError ? 400 : (error as { statusCode?: number }).statusCode || 500;
    reply.code(status).send({
      error:
        status === 413
          ? 'The file is larger than 2 GB.'
          : status === 400
            ? zodMessage(error)
            : status === 404
              ? 'Not found.'
              : status === 409 && error instanceof Error
                ? error.message
                : 'The request could not be processed. Check the server and the file.',
    });
  });
  const releaseDir = resolve(config.releaseDir || 'release');
  const downloadPath = join(releaseDir, 'ReplayHaven-Client-Setup.exe');
  const localInstaller = () =>
    stat(downloadPath).then(
      () => true,
      () => false,
    );
  /** Game info for the library tiles: name, description, genre, cover. */
  app.get('/api/games', async () =>
    games.list().map((g) => ({
      key: g.key,
      label: g.label,
      ...(g.info
        ? {
            name: g.info.name,
            description: g.info.description,
            genre: g.info.genre,
            released: g.info.released,
            source: g.info.source,
            cover: g.info.cover
              ? `/api/games/${encodeURIComponent(g.key)}/cover?v=${encodeURIComponent(g.checkedAt)}`
              : undefined,
          }
        : {}),
    })),
  );
  app.post('/api/games/refresh', async (_req, reply) => {
    if (!config.gameMetadata)
      return reply.code(409).send({
        error: 'Automatic game info lookups are disabled on this server.',
      });
    return reply.code(202).send({ queued: games.backfill(undefined, true) });
  });
  app.get<{ Params: { key: string } }>('/api/games/:key/cover', async (req, reply) => {
    const entry = games.list().find((g) => g.key === req.params.key);
    if (!entry?.info?.cover) return reply.code(404).send({ error: 'No cover available.' });
    reply.header('Cache-Control', 'private, max-age=86400');
    // The file name comes from the stored entry, not from the request.
    return reply.sendFile(entry.info.cover, coverDir);
  });
  app.get('/api/status', async (req) => ({
    connected: true,
    version: serverVersion,
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
    // The folders on the gaming PCs are the admins' business.
    devices: db.devices().map((d) => {
      const shown = { ...d, ...(auth.admin(req) ? {} : { folder: '' }) };
      delete shown.owner;
      return shown;
    }),
    clientDownloadAvailable: (await localInstaller()) || !!config.clientDownloadUrl,
    gameMetadata: games.status(),
    playback: playback.status(),
    supportBanner: config.supportBanner !== false,
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
      .send({ error: 'The Windows installer has not been provided on this server yet.' });
  });
  app.put('/api/settings/analysis', async (req) => {
    const settings = settingsSchema.parse(req.body);
    db.saveSettings(settings);
    return settings;
  });
  // Whether the archive already holds a recording with this content (SHA-256 of the file), so a
  // client can skip analysing and uploading it again, e.g. after switching the server address.
  // Clips removed from the library count as present: they stay removed.
  app.get<{ Params: { hash: string } }>('/api/clips/lookup/:hash', async (req) => {
    const hash = z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .parse(req.params.hash);
    const clip = db.findHash(hash);
    return { clip: clip ? { id: clip.id, removed: !!clip.deleted } : null };
  });
  app.get('/api/clips', async () =>
    db
      .list()
      .filter((c) => !c.deleted)
      .map(publicClip),
  );
  app.get<{ Params: { id: string } }>('/api/clips/:id', async (req, reply) => {
    const clip = db.get(idSchema.parse(req.params.id));
    if (!clip || clip.deleted) return reply.code(404).send({ error: 'Clip not found.' });
    return publicClip(clip);
  });
  app.post('/api/clips', async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'Choose a video file.' });
    const extension = extname(file.filename).toLowerCase();
    if (!['.mp4', '.m4v', '.mov', '.webm', '.mkv'].includes(extension)) {
      file.file.resume();
      return reply.code(400).send({ error: 'Supported formats are MP4, WebM, MOV, M4V and MKV.' });
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
          error: file.file.truncated ? 'The file is larger than 2 GB.' : 'The file is empty.',
        });
      const digest = hash.digest('hex');
      const duplicate = db.findHash(digest);
      if (duplicate) {
        // Uploading a removed clip again on purpose brings it back; clients skip removed clips
        // before uploading (lookup above), so they stay removed there.
        if (duplicate.deleted) db.patch(duplicate.id, { deleted: false });
        if (duplicate.gameName) games.schedule(duplicate.gameName);
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
      const gameNameHeader = header('x-game-name');
      // Fetch game info in the background; the upload does not wait for it.
      if (gameNameHeader) games.schedule(gameNameHeader);
      const clip: StoredClip = {
        id,
        title: file.filename.replace(/\.[^.]+$/, '').slice(0, 120) || 'New recording',
        gameId: 'recording',
        gameName: gameNameHeader,
        thumbnail: '',
        duration: 0,
        recordedAt:
          recorded && Number.isFinite(Date.parse(recorded))
            ? new Date(recorded).toISOString()
            : new Date().toISOString(),
        size,
        // Set once the video has been probed; the interface shows nothing until then.
        resolution: '',
        tags: [],
        favorite: false,
        status: 'processing',
        note: '',
        server: true,
        originalName: file.filename.slice(0, 240),
        originalFile,
        hash: digest,
        deviceName: header('x-device-name') || 'Browser upload',
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
    if (!clip || clip.deleted) return reply.code(404).send({ error: 'Clip not found.' });
    const payload = z
      .object({
        result: analysisSchema,
        duration: z.number().positive().max(1800),
        model: z.string().min(1).max(100),
      })
      .parse(req.body);
    const actual = await media.probe(clip.originalFile);
    if (Math.abs(payload.duration - actual.duration) > Math.max(1, actual.duration * 0.01))
      return reply.code(400).send({ error: 'Analysis and video duration do not match.' });
    const result = parseAnalysis(JSON.stringify(payload.result), actual.duration);
    const latest = db.get(id)!;
    if (latest.deleted) return reply.code(404).send({ error: 'The clip was removed.' });
    games.schedule(latest.gameName || result.game);
    const previous =
      latest.analysis?.provider === 'client' && latest.analysis.status === 'ready'
        ? latest.analysis.result
        : undefined;
    // Sending the same result again changes nothing. A new analysis replaces the old one:
    // otherwise the archive would keep titles and tags of earlier versions forever.
    if (previous && JSON.stringify(previous) === JSON.stringify(result)) return publicClip(latest);
    // Tags of the previous analysis go, the user's own tags stay.
    const stale = new Set(previous?.tags ?? []);
    return publicClip(
      db.patch(id, {
        expectsClientAnalysis: true,
        ...(db.settings().autoTitle && !latest.userEditedTitle ? { title: result.title } : {}),
        gameName: latest.gameName || result.game,
        tags: [...new Set([...latest.tags.filter((t) => !stale.has(t)), ...result.tags])].slice(
          0,
          20,
        ),
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
    if (!clip || clip.deleted) return reply.code(404).send({ error: 'Clip not found.' });
    const patch = clipPatchSchema.parse(req.body);
    if (patch.gameName) games.schedule(patch.gameName);
    return publicClip(
      db.patch(id, { ...patch, ...(patch.title ? { userEditedTitle: true } : {}) })!,
    );
  });
  app.delete<{ Params: { id: string } }>('/api/clips/:id', async (req, reply) => {
    const id = idSchema.parse(req.params.id);
    if (!db.get(id)) return reply.code(404).send({ error: 'Clip not found.' });
    db.patch(id, { deleted: true });
    return { removed: true };
  });
  app.post<{ Params: { id: string } }>('/api/clips/:id/analyze', async (req, reply) => {
    const id = idSchema.parse(req.params.id);
    const clip = db.get(id);
    if (!clip || clip.deleted) return reply.code(404).send({ error: 'Clip not found.' });
    if (!aiConfigured(config))
      return reply.code(409).send({ error: 'Set up an AI provider on the server first.' });
    if (clip.status !== 'ready')
      return reply.code(409).send({ error: 'Wait until video processing has finished.' });
    if (['queued', 'analyzing', 'preparing'].includes(clip.analysis?.status || ''))
      return reply.code(409).send({ error: 'The analysis is already running.' });
    const queued = db.patch(id, {
      analysis: { ...clip.analysis, status: 'queued', error: undefined },
    })!;
    worker.kick();
    return reply.code(202).send(publicClip(queued));
  });
  app.post<{ Params: { id: string } }>('/api/clips/:id/retry-media', async (req, reply) => {
    const id = idSchema.parse(req.params.id);
    const clip = db.get(id);
    if (!clip || clip.deleted) return reply.code(404).send({ error: 'Clip not found.' });
    if (clip.status !== 'error')
      return reply.code(409).send({ error: 'Video processing has not failed.' });
    db.patch(id, { status: 'processing', analysis: { status: 'preparing' } });
    worker.kick();
    return reply.code(202).send({ queued: true });
  });
  for (const kind of ['video', 'thumbnail', 'download'] as const)
    app.get<{ Params: { id: string } }>(`/api/clips/:id/${kind}`, async (req, reply) => {
      const clip = db.get(idSchema.parse(req.params.id));
      if (!clip || clip.deleted) return reply.code(404).send({ error: 'Clip not found.' });
      const directory = join(config.dataDir, 'clips', clip.id);
      const path =
        kind === 'thumbnail'
          ? join(directory, 'thumbnail.jpg')
          : kind === 'download'
            ? clip.originalFile
            : clip.playbackFile;
      if (!path || !(await stat(path).catch(() => null)))
        return reply.code(404).send({ error: 'The file is not available yet.' });
      // Private data: browsers may cache it, shared caches may not. The video URL carries a
      // version (playback.ts videoSource), so a new rendition is never mixed with a cached one.
      if (kind !== 'download')
        reply.header(
          'Cache-Control',
          kind === 'video' ? 'private, max-age=86400' : 'private, max-age=3600',
        );
      if (kind === 'download')
        reply.header(
          'Content-Disposition',
          `attachment; filename="clip${extname(path)}"; filename*=UTF-8''${encodeURIComponent(clip.originalName)}`,
        );
      return reply.sendFile(path.split(/[\\/]/).pop()!, directory, { cacheControl: false });
    });
  app.post('/api/devices/heartbeat', async (req, reply) => {
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
    const owner = req.identity?.kind === 'client' ? req.identity.session?.id : undefined;
    const known = db.devices().find((d) => d.id === device.id);
    if (known?.owner && known.owner !== owner)
      return reply.code(409).send({ error: 'This device ID belongs to another PC.' });
    db.putDevice({ ...device, lastSeen: new Date().toISOString(), ...(owner ? { owner } : {}) });
    return { received: true };
  });
  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith('/api/'))
      return reply.code(404).send({ error: 'API endpoint not found.' });
    let path: string;
    try {
      path = decodeURIComponent(req.url.split('?')[0]);
    } catch {
      return reply.code(404).send({ error: 'Not found.' });
    }
    return reply.sendFile(path.includes('.') ? path.replace(/^\//, '') : 'index.html');
  });
  // Expired entries and failed lookups are retried even without new uploads.
  games.backfill();
  const metadataTimer = config.gameMetadata
    ? setInterval(() => games.backfill(), 3600000)
    : undefined;
  metadataTimer?.unref();
  app.addHook('onClose', async () => {
    clearInterval(metadataTimer);
    await playback.stop();
    await worker.stop();
    await games.stop();
    db.close();
  });
  worker.recover();
  playback.kick();
  return { app, db, worker, games };
}
