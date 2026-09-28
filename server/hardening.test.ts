import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AccountError, Accounts, MAX_WAITING_FOR_HASH, Throttle } from './auth';
import { buildServer } from './app';
import { MediaProcessor, runFile } from './media';
import { TEST_KEY, cookieOf, removeRoots, startServer } from './test-support';
import type { AnalysisResult } from './schema';

let fixtureRoot: string;
let video: Buffer;
beforeAll(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), 'replayhaven-hardening-'));
  const media = new MediaProcessor({});
  const fixture = join(fixtureRoot, 'test-only.mp4');
  await runFile(media.ffmpeg, [
    '-nostdin',
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=teal:s=160x90:r=10',
    '-t',
    '2',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    fixture,
  ]);
  video = await readFile(fixture);
});
afterAll(async () => {
  await removeRoots();
  if (
    fixtureRoot &&
    resolve(fixtureRoot).startsWith(resolve(tmpdir()) + sep) &&
    fixtureRoot.includes('replayhaven-hardening-')
  )
    await rm(fixtureRoot, { recursive: true, force: true });
});

const result: AnalysisResult = {
  title: 'Test title',
  description: 'Observation from an artificial test picture.',
  game: 'Test game',
  tags: ['Test'],
  confidence: 'medium',
  uncertainty: 'Test data.',
  highlights: [{ seconds: 1, title: 'Test moment', description: '' }],
};
function multipart(content: Buffer = video) {
  const boundary = 'replayhaven-hardening';
  return {
    'content-type': `multipart/form-data; boundary=${boundary}`,
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="capture.mp4"\r\nContent-Type: video/mp4\r\n\r\n`,
      ),
      content,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}
async function withAdmin(overrides: Parameters<typeof buildServer>[1] = {}) {
  const server = await startServer();
  // startServer builds without overrides; rebuild on the same data when a test needs them.
  let { app, db, worker } = server;
  if (Object.keys(overrides).length) {
    await app.close();
    ({ app, db, worker } = await buildServer(server.config, overrides));
  }
  const setup = await app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    payload: { name: 'owner', password: 'owner-password', key: TEST_KEY },
  });
  const admin = { cookie: cookieOf(setup) };
  const pairPc = async (name: string) => {
    const { id, secret } = (
      await app.inject({
        method: 'POST',
        url: '/api/pair/request',
        payload: { deviceId: randomUUID(), name },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/api/pair/${id}/approve`, headers: admin });
    const { token } = (
      await app.inject({ method: 'POST', url: '/api/pair/status', payload: { id, secret } })
    ).json();
    return { authorization: `Bearer ${token as string}` };
  };
  const upload = (headers: Record<string, string>, content?: Buffer) => {
    const { payload, ...type } = multipart(content);
    return app.inject({
      method: 'POST',
      url: '/api/clips',
      headers: { ...headers, ...type },
      payload,
    });
  };
  return { app, db, worker, config: server.config, admin, pairPc, upload };
}

it('counts sign-ins that are still being checked, so parallel guesses cannot pass the limit', () => {
  const throttle = new Throttle(3);
  expect([1, 2, 3].map(() => throttle.begin('a'))).toEqual([true, true, true]);
  // Three checks are running: a fourth has to wait for their outcome.
  expect(throttle.begin('a')).toBe(false);
  expect(throttle.begin('b')).toBe(true);
  throttle.end('a', false);
  expect(throttle.begin('a')).toBe(true);
  throttle.end('a', true);
  throttle.end('a', true);
  throttle.end('a', true);
  expect(throttle.blocked('a')).toBe(true);
});

// Twenty password checks at the full scrypt cost take a few seconds.
it(
  'answers at most twenty of many sign-in attempts sent at once',
  { timeout: 60_000 },
  async () => {
    const { app } = await withAdmin();
    const answers = await Promise.all(
      Array.from({ length: 26 }, () =>
        app.inject({
          method: 'POST',
          url: '/api/auth/login',
          remoteAddress: '203.0.113.7',
          payload: { name: 'owner', password: 'wrong-password' },
        }),
      ),
    );
    const codes = answers.map((a) => a.statusCode);
    expect(codes.filter((c) => c === 401)).toHaveLength(20);
    expect(codes.filter((c) => c === 429)).toHaveLength(6);
    await app.close();
  },
);

it('refuses password checks instead of queueing without limit', { timeout: 120_000 }, async () => {
  const accounts = new Accounts(new DatabaseSync(':memory:'));
  const checks = await Promise.allSettled(
    Array.from({ length: MAX_WAITING_FOR_HASH + 8 }, (_, i) =>
      accounts.verify(`nobody-${i}`, 'password'),
    ),
  );
  const refused = checks.filter((c) => c.status === 'rejected' && c.reason instanceof AccountError);
  expect(refused.length).toBeGreaterThan(0);
  expect((refused[0] as PromiseRejectedResult).reason).toMatchObject({ status: 503 });
  // Afterwards the queue is empty again.
  await expect(accounts.verify('nobody', 'password')).resolves.toBeUndefined();
});

it('names the account of a QR code before it is used', async () => {
  const { app, admin } = await withAdmin();
  const qr = await app.inject({
    method: 'POST',
    url: '/api/auth/qr',
    headers: { ...admin, origin: 'https://replay.example.org' },
  });
  const code = new URL(qr.json().url).searchParams.get('code')!;
  const preview = await app.inject({
    method: 'POST',
    url: '/api/auth/qr/preview',
    payload: { code },
  });
  expect(preview.statusCode).toBe(200);
  expect(preview.json()).toEqual({ user: { name: 'owner' } });
  expect(cookieOf(preview)).toBe('');
  // The preview used nothing up.
  expect(
    (await app.inject({ url: `/api/auth/qr/${qr.json().id}`, headers: admin })).json(),
  ).toEqual({ status: 'waiting' });
  const redeemed = await app.inject({
    method: 'POST',
    url: '/api/auth/qr/redeem',
    payload: { code },
  });
  expect(redeemed.statusCode).toBe(200);
  const again = await app.inject({
    method: 'POST',
    url: '/api/auth/qr/preview',
    payload: { code },
  });
  expect(again.statusCode).toBe(401);
  await app.close();
});

it(
  'takes AI results for a clip only from the PC that uploaded it',
  { timeout: 30_000 },
  async () => {
    const { app, admin, pairPc, upload } = await withAdmin();
    const first = await pairPc('PC-1');
    const second = await pairPc('PC-2');
    const uploaded = await upload({ ...first, 'x-client-analysis': '1' });
    expect(uploaded.statusCode).toBe(201);
    expect(uploaded.json().clip).not.toHaveProperty('uploader');
    const id = uploaded.json().clip.id as string;
    const deliver = (headers: Record<string, string>) =>
      app.inject({
        method: 'POST',
        url: `/api/clips/${id}/client-analysis`,
        headers,
        payload: { result, duration: 2, model: 'test-only' },
      });
    const foreign = await deliver(second);
    expect(foreign.statusCode).toBe(403);
    expect(foreign.json().error).toBe('This clip was uploaded by another PC.');
    expect((await deliver(first)).statusCode).toBe(200);
    // An admin in the browser is not bound to a PC.
    expect((await deliver(admin)).statusCode).toBe(200);
    await app.close();
  },
);

it('answers an upload racing a copy of itself as a duplicate', { timeout: 30_000 }, async () => {
  const { app, db, config, admin, upload } = await withAdmin();
  const first = await upload(admin);
  expect(first.statusCode).toBe(201);
  // As if the second upload had checked for the hash just before the first one was stored.
  vi.spyOn(db, 'findHash').mockReturnValueOnce(undefined);
  const second = await upload(admin);
  expect(second.statusCode).toBe(200);
  expect(second.json()).toMatchObject({ duplicate: true, clip: { id: first.json().clip.id } });
  expect(await readdir(join(config.dataDir, 'clips'))).toEqual([first.json().clip.id]);
  expect(await readdir(join(config.dataDir, 'incoming'))).toEqual([]);
  await app.close();
});

it('refuses uploads when the disk is almost full and sweeps abandoned ones', async () => {
  const { app, config, admin, upload } = await withAdmin({ freeBytes: async () => 1024 ** 3 });
  const refused = await upload(admin);
  expect(refused.statusCode).toBe(507);
  expect(refused.json().error).toBe(
    'The server is running out of disk space. Free up space on the server, then retry.',
  );
  await app.close();
  const incoming = join(config.dataDir, 'incoming');
  await mkdir(incoming, { recursive: true });
  await writeFile(join(incoming, 'old.part'), 'cut off');
  await writeFile(join(incoming, 'fresh.part'), 'still arriving');
  const hoursAgo = new Date(Date.now() - 2 * 3600_000);
  await utimes(join(incoming, 'old.part'), hoursAgo, hoursAgo);
  const restarted = await buildServer(config);
  expect(await readdir(incoming)).toEqual(['fresh.part']);
  await restarted.app.close();
});
