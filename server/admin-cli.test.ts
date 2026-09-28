import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { Accounts } from './auth';
import { runAdminCommand } from './admin-cli';

it('lists accounts and resets a forgotten password, signing out the old browsers', async () => {
  const accounts = new Accounts(new DatabaseSync(':memory:'));
  expect(await runAdminCommand(['users'], accounts)).toMatch(/No accounts yet/);
  const timo = await accounts.createUser('timo', 'vergessenes-passwort', 'admin');
  await accounts.createUser('sso', null, 'user');
  const browser = accounts.createSession(timo.id, 'browser', 'Firefox');
  const pc = accounts.createSession(timo.id, 'client', 'GAMING-PC');
  expect(await runAdminCommand(['users'], accounts)).toBe(
    'timo  (admin)\nsso  (user, single sign-on only)',
  );

  const output = await runAdminCommand(['reset-password', 'timo'], accounts);
  const password = /New password for timo: (\S+)/.exec(output)?.[1];
  expect(password).toMatch(/^[\w-]{16}$/);
  expect(await accounts.verify('timo', 'vergessenes-passwort')).toBeUndefined();
  expect(await accounts.verify('timo', password!)).toMatchObject({ name: 'timo' });
  expect(accounts.session(browser.secret)).toBeUndefined();
  expect(accounts.session(pc.secret)).toBeTruthy();
});

it('explains wrong input instead of doing anything', async () => {
  const accounts = new Accounts(new DatabaseSync(':memory:'));
  await expect(runAdminCommand([], accounts)).rejects.toThrow(/Usage/);
  await expect(runAdminCommand(['reset-password'], accounts)).rejects.toThrow(/Usage/);
  await expect(runAdminCommand(['reset-password', 'nobody'], accounts)).rejects.toThrow(
    /No account named "nobody"/,
  );
});

it('purges removed clips for good only when confirmed', async () => {
  const fs = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join, resolve, sep } = await import('node:path');
  const { VaultDatabase } = await import('./database');
  const dataDir = await fs.mkdtemp(join(tmpdir(), 'replayhaven-purge-'));
  const db = new VaultDatabase(dataDir);
  try {
    const accounts = new Accounts(db.db);
    const clip = (id: string, deleted: boolean) => ({
      id,
      title: id,
      gameId: 'recording',
      gameName: '',
      thumbnail: '',
      duration: 1,
      recordedAt: new Date(0).toISOString(),
      size: 4,
      resolution: '',
      tags: [],
      favorite: false,
      status: 'ready' as const,
      note: '',
      server: true as const,
      originalName: `${id}.mp4`,
      originalFile: join(dataDir, 'clips', id, 'original.mp4'),
      hash: id.replace(/-/g, '').padEnd(64, '0'),
      deleted,
    });
    const gone = '11111111-1111-4111-8111-111111111111';
    const kept = '22222222-2222-4222-8222-222222222222';
    for (const [id, deleted] of [
      [gone, true],
      [kept, false],
    ] as const) {
      db.put(clip(id, deleted));
      await fs.mkdir(join(dataDir, 'clips', id), { recursive: true });
      await fs.writeFile(join(dataDir, 'clips', id, 'original.mp4'), 'data');
    }
    const archive = { db, dataDir };
    expect(await runAdminCommand(['purge-removed'], accounts, archive)).toMatch(
      /1 removed clip\(s\).*--yes/,
    );
    expect(await fs.readdir(join(dataDir, 'clips'))).toHaveLength(2);
    expect(await runAdminCommand(['purge-removed', '--yes'], accounts, archive)).toMatch(
      /Deleted 1 removed clip/,
    );
    expect(await fs.readdir(join(dataDir, 'clips'))).toEqual([kept]);
    expect(db.get(gone)).toBeUndefined();
    expect(db.get(kept)).toBeTruthy();
    expect(await runAdminCommand(['purge-removed'], accounts, archive)).toBe(
      'No removed clips to purge.',
    );
  } finally {
    db.close();
    if (
      resolve(dataDir).startsWith(resolve(tmpdir()) + sep) &&
      dataDir.includes('replayhaven-purge-')
    )
      await fs.rm(dataDir, { recursive: true, force: true });
  }
});
