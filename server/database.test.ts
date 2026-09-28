import { mkdtemp, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { expect, it } from 'vitest';
import { SCHEMA_VERSION, VaultDatabase } from './database';

it('records its layout version and refuses a database from a newer release', async () => {
  const root = await mkdtemp(join(tmpdir(), 'replayhaven-db-'));
  try {
    const vault = new VaultDatabase(root);
    const version = () =>
      (vault.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    expect(version()).toBe(SCHEMA_VERSION);
    vault.db.exec(`PRAGMA user_version=${SCHEMA_VERSION + 1}`);
    vault.close();
    expect(() => new VaultDatabase(root)).toThrow(/newer ReplayHaven.*Restore a backup/);
    // Refusing leaves the database as it was.
    const raw = new DatabaseSync(join(root, 'vault.sqlite'));
    expect(
      (raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    ).toBe(SCHEMA_VERSION + 1);
    raw.close();
  } finally {
    if (resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('replayhaven-db-'))
      await rm(root, { recursive: true, force: true });
  }
});
