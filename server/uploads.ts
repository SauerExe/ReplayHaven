/**
 * Resumable uploads: a recording arrives in pieces of at most `chunkSize` bytes, so it passes
 * proxies with a request limit (Cloudflare Tunnel: 100 MB) and a dropped connection only costs
 * the piece in flight. State lives next to the data in incoming/<id>.json and incoming/<id>.part,
 * so an upload survives a restart of the server.
 */
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, readdir, rename, rm, stat, truncate, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Transform } from 'node:stream';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

/** The largest recording the server accepts. */
export const MAX_UPLOAD_BYTES = 2 * 1024 ** 3;
/** Size of a piece: well below the 100 MB request limit of Cloudflare Tunnel. */
export const CHUNK_BYTES = 50 * 1024 ** 2;
export const VIDEO_EXTENSIONS = ['.mp4', '.m4v', '.mov', '.webm', '.mkv'];
/** Unfinished uploads one PC or browser may keep open at once. */
export const MAX_OPEN_UPLOADS = 4;
/** An upload without progress for this long is given up. */
export const STALE_UPLOAD_MS = 24 * 3600_000;

/** What a clip learns from its upload besides the file, as the multipart headers carry it. */
export interface UploadMeta {
  recordedAt: string;
  gameName: string;
  deviceName: string;
  clientAnalysis: boolean;
}
/** The same limits for both ways of uploading: texts are cut at 160 characters. */
export function uploadMeta(raw: {
  recordedAt?: string;
  gameName?: string;
  deviceName?: string;
  clientAnalysis?: boolean;
}): UploadMeta {
  return {
    recordedAt: (raw.recordedAt ?? '').slice(0, 160),
    gameName: (raw.gameName ?? '').slice(0, 160),
    deviceName: (raw.deviceName ?? '').slice(0, 160),
    clientAnalysis: raw.clientAnalysis === true,
  };
}
/** The session and account that started an upload; empty for the access key or local access. */
export interface UploadOwner {
  session: string;
  user: string;
}
interface UploadState {
  id: string;
  owner: UploadOwner;
  size: number;
  /** Bytes stored in the .part file; only raised after a piece was written completely. */
  received: number;
  name: string;
  meta: UploadMeta;
  createdAt: string;
  updatedAt: string;
}
/** A completely received file, ready to become a clip. */
export interface ReceivedFile {
  temporary: string;
  name: string;
  size: number;
  digest: string;
  meta: UploadMeta;
}
/** The answer to a stored upload: 201 with the new clip, 200 with the clip already there. */
export interface StoredUpload {
  status: number;
  body: { clip: unknown; duplicate: boolean };
}

const startSchema = z.object({
  size: z.number().int().min(0),
  name: z.string().min(1).max(1000),
  recordedAt: z.string().max(1000).optional(),
  game: z.string().max(1000).optional(),
  deviceName: z.string().max(1000).optional(),
  clientAnalysis: z.boolean().optional(),
});
const offsetSchema = z.object({ offset: z.coerce.number().int().min(0) });
const uploadId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A piece that turns out larger than announced or allowed while it arrives. */
class PieceTooLarge extends Error {}

export function registerUploads(
  app: FastifyInstance,
  options: {
    /** incoming/ in the data folder. */
    directory: string;
    chunkSize: number;
    /** Answers 507 when the disk is almost full; true when the request has been answered. */
    refuseWhenFull: (req: FastifyRequest, reply: FastifyReply) => Promise<boolean>;
    ownerOf: (req: FastifyRequest) => UploadOwner;
    /** Whether the caller may see and continue an upload of `owner`. */
    owns: (req: FastifyRequest, owner: UploadOwner) => boolean;
    /** Turns the file into a clip, exactly as the multipart upload does. */
    store: (req: FastifyRequest, file: ReceivedFile) => Promise<StoredUpload>;
  },
) {
  const { directory, chunkSize } = options;
  const statePath = (id: string) => join(directory, `${id}.json`);
  const partPath = (id: string) => join(directory, `${id}.part`);
  /** Uploads with a piece or the completion in progress, in this process. */
  const busy = new Set<string>();
  const load = async (id: string) => {
    try {
      return JSON.parse(await readFile(statePath(id), 'utf8')) as UploadState;
    } catch {
      return undefined;
    }
  };
  const save = async (upload: UploadState) => {
    const temporary = `${statePath(upload.id)}.tmp`;
    await writeFile(temporary, JSON.stringify(upload));
    await rename(temporary, statePath(upload.id));
  };
  const remove = async (id: string) => {
    await rm(statePath(id), { force: true }).catch(() => {});
    await rm(partPath(id), { force: true }).catch(() => {});
  };
  const all = async () => {
    const names = await readdir(directory).catch(() => [] as string[]);
    const uploads: UploadState[] = [];
    for (const name of names)
      if (name.endsWith('.json')) {
        const upload = await load(name.slice(0, -5));
        if (upload) uploads.push(upload);
      }
    return uploads;
  };
  /** The caller's upload, or undefined: someone else's upload is answered as not found. */
  const find = async (req: FastifyRequest, id: string) => {
    if (!uploadId.test(id)) return undefined;
    const upload = await load(id);
    if (!upload || !options.owns(req, upload.owner)) return undefined;
    return upload;
  };
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'Upload not found.' });
  const isBusy = (reply: FastifyReply, upload: UploadState) =>
    reply
      .code(409)
      .send({ error: 'This upload is busy. Try again in a moment.', offset: upload.received });

  /** Removes uploads without progress for a day, and state files cut off while being written. */
  async function sweep(now = Date.now()) {
    for (const name of await readdir(directory).catch(() => [] as string[])) {
      if (name.endsWith('.json.tmp')) {
        const info = await stat(join(directory, name)).catch(() => undefined);
        if (info && now - info.mtimeMs > 3600_000)
          await rm(join(directory, name), { force: true }).catch(() => {});
        continue;
      }
      if (!name.endsWith('.json')) continue;
      const id = name.slice(0, -5);
      if (busy.has(id)) continue;
      const upload = await load(id);
      const updated = upload ? Date.parse(upload.updatedAt) : NaN;
      if (!(now - updated <= STALE_UPLOAD_MS)) await remove(id);
    }
  }

  app.post('/api/uploads', async (req, reply) => {
    const input = startSchema.parse(req.body);
    if (input.size > MAX_UPLOAD_BYTES)
      return reply.code(413).send({ error: 'The file is larger than 2 GB.' });
    if (!input.size) return reply.code(400).send({ error: 'The file is empty.' });
    if (!VIDEO_EXTENSIONS.includes(extname(input.name).toLowerCase()))
      return reply.code(400).send({ error: 'Supported formats are MP4, WebM, MOV, M4V and MKV.' });
    if (await options.refuseWhenFull(req, reply)) return reply;
    const owner = options.ownerOf(req);
    const open = (await all()).filter(
      (u) => u.owner.session === owner.session && u.owner.user === owner.user,
    );
    if (open.length >= MAX_OPEN_UPLOADS)
      return reply.code(429).send({
        error: 'Too many unfinished uploads from this device. Finish or cancel one first.',
      });
    const now = new Date().toISOString();
    const upload: UploadState = {
      id: randomUUID(),
      owner,
      size: input.size,
      received: 0,
      name: input.name.slice(0, 240),
      meta: uploadMeta({
        recordedAt: input.recordedAt,
        gameName: input.game,
        deviceName: input.deviceName,
        clientAnalysis: input.clientAnalysis,
      }),
      createdAt: now,
      updatedAt: now,
    };
    await writeFile(partPath(upload.id), '', { flag: 'wx' });
    await save(upload);
    return reply.code(201).send({ id: upload.id, offset: 0, chunkSize });
  });

  app.get<{ Params: { id: string } }>('/api/uploads/:id', async (req, reply) => {
    const upload = await find(req, req.params.id);
    if (!upload) return notFound(reply);
    return { offset: upload.received, size: upload.size };
  });

  // Pieces arrive as raw bytes and are streamed to disk; only this scope accepts them.
  app.register(async (scope) => {
    scope.addContentTypeParser('application/octet-stream', (_req, payload, done) =>
      done(null, payload),
    );
    scope.put<{ Params: { id: string }; Querystring: { offset?: string } }>(
      '/api/uploads/:id',
      async (req, reply) => {
        const upload = await find(req, req.params.id);
        if (!upload) return notFound(reply);
        const { offset } = offsetSchema.parse(req.query);
        if (busy.has(upload.id)) return isBusy(reply, upload);
        // Another position: a piece was stored although its answer got lost, or the client
        // restarted. It continues from where the server is.
        if (offset !== upload.received)
          return reply.code(409).send({
            error: 'The upload continues at another position.',
            offset: upload.received,
          });
        if (!(req.body && typeof (req.body as Readable).pipe === 'function'))
          return reply.code(400).send({ error: 'Send the piece as application/octet-stream.' });
        const room = Math.min(chunkSize, upload.size - upload.received);
        const announced = Number(req.headers['content-length']);
        if (announced > chunkSize)
          return reply.code(413).send({ error: 'The piece is larger than the server accepts.' });
        if (announced > room)
          return reply.code(400).send({ error: 'The piece goes beyond the end of the file.' });
        busy.add(upload.id);
        const part = partPath(upload.id);
        try {
          // Drops what an interrupted piece left behind: only complete pieces count.
          await truncate(part, upload.received);
          let count = 0;
          await pipeline(
            req.body as Readable,
            new Transform({
              transform(chunk: Buffer, _encoding, callback) {
                count += chunk.length;
                callback(count > room ? new PieceTooLarge() : null, chunk);
              },
            }),
            createWriteStream(part, { flags: 'a' }),
          );
          upload.received += count;
          upload.updatedAt = new Date().toISOString();
          await save(upload);
          return { offset: upload.received };
        } catch (error) {
          await truncate(part, upload.received).catch(() => {});
          // Sent without Content-Length: the limit shows while the piece arrives.
          if (error instanceof PieceTooLarge)
            return room === chunkSize
              ? reply.code(413).send({ error: 'The piece is larger than the server accepts.' })
              : reply.code(400).send({ error: 'The piece goes beyond the end of the file.' });
          throw error;
        } finally {
          busy.delete(upload.id);
        }
      },
    );
  });

  app.post<{ Params: { id: string } }>('/api/uploads/:id/complete', async (req, reply) => {
    const upload = await find(req, req.params.id);
    if (!upload) return notFound(reply);
    if (busy.has(upload.id)) return isBusy(reply, upload);
    if (upload.received !== upload.size)
      return reply
        .code(409)
        .send({ error: 'The upload is not complete yet.', offset: upload.received });
    busy.add(upload.id);
    let stored: StoredUpload;
    let finished = false;
    try {
      const part = partPath(upload.id);
      const hash = createHash('sha256');
      let size = 0;
      for await (const chunk of createReadStream(part)) {
        hash.update(chunk as Buffer);
        size += (chunk as Buffer).length;
      }
      if (size !== upload.size) {
        // The file lost bytes behind the server's back: continue from what is really there.
        upload.received = Math.min(size, upload.size);
        upload.updatedAt = new Date().toISOString();
        await truncate(part, upload.received);
        await save(upload);
        return reply
          .code(409)
          .send({ error: 'The upload is not complete yet.', offset: upload.received });
      }
      finished = true;
      stored = await options.store(req, {
        temporary: part,
        name: upload.name,
        size,
        digest: hash.digest('hex'),
        meta: upload.meta,
      });
    } finally {
      busy.delete(upload.id);
      // Stored, found as a duplicate or failed while storing: the upload is over either way.
      if (finished) await remove(upload.id);
    }
    return reply.code(stored.status).send(stored.body);
  });

  app.delete<{ Params: { id: string } }>('/api/uploads/:id', async (req, reply) => {
    const upload = await find(req, req.params.id);
    if (!upload) return notFound(reply);
    if (busy.has(upload.id)) return isBusy(reply, upload);
    await remove(upload.id);
    return { removed: true };
  });

  const timer = setInterval(() => void sweep(), 3600_000);
  timer.unref();
  return {
    sweep,
    stop: () => clearInterval(timer),
    status: () => ({ resumable: true, chunkSize }),
  };
}
