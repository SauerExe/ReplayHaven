/**
 * Admin commands for the machine the server runs on, for when nobody can sign in anymore:
 *
 *   docker exec -it replayhaven node server-bundle/admin.mjs users
 *   docker exec -it replayhaven node server-bundle/admin.mjs reset-password <name>
 *   docker exec -it replayhaven node server-bundle/admin.mjs purge-removed --yes
 *
 * From a source checkout: npm run admin -- users. Whoever can run this already controls the data
 * directory, so it needs no further key.
 */
import { randomBytes } from 'node:crypto';
import { readdir, rm, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Accounts } from './auth';
import { loadConfig } from './config';
import { VaultDatabase } from './database';

const USAGE =
  'Usage: admin.mjs users | admin.mjs reset-password <name> | admin.mjs purge-removed [--yes]';

async function folderSize(folder: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
    const path = join(folder, entry.name);
    total += entry.isDirectory() ? await folderSize(path) : (await stat(path)).size;
  }
  return total;
}

/**
 * Clips removed in the library keep their files, so a mistaken removal can be undone by uploading
 * again. This deletes them for good: files and row. Without --yes it only reports what it would
 * free.
 */
async function purgeRemoved(archive: { db: VaultDatabase; dataDir: string }, confirmed: boolean) {
  const removed = archive.db.list().filter((c) => c.deleted);
  const root = resolve(archive.dataDir, 'clips');
  let bytes = 0;
  for (const clip of removed) {
    const folder = resolve(root, clip.id);
    // Only a clip folder directly below clips/, named by the clip's own UUID.
    if (!/^[0-9a-f-]{36}$/.test(clip.id) || !folder.startsWith(root + sep)) continue;
    bytes += await folderSize(folder);
    if (!confirmed) continue;
    await rm(folder, { recursive: true, force: true });
    archive.db.remove(clip.id);
  }
  const size = `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (!removed.length) return 'No removed clips to purge.';
  return confirmed
    ? `Deleted ${removed.length} removed clip(s) for good, ${size} freed.`
    : `${removed.length} removed clip(s), ${size}. Run again with --yes to delete them for good.`;
}

/** Runs one command and returns what to print; throws a message for the user on bad input. */
export async function runAdminCommand(
  args: string[],
  accounts: Accounts,
  archive?: { db: VaultDatabase; dataDir: string },
) {
  const [command, name] = args;
  if (command === 'purge-removed') {
    if (!archive) throw new Error(USAGE);
    return purgeRemoved(archive, args.includes('--yes'));
  }
  if (command === 'users') {
    const users = accounts.users();
    if (!users.length) return 'No accounts yet. Create the first one with the setup link.';
    return users
      .map(
        (u) =>
          `${u.name}  (${u.role}${u.disabled ? ', disabled' : ''}${u.hash ? '' : ', single sign-on only'})`,
      )
      .join('\n');
  }
  if (command === 'reset-password') {
    if (!name) throw new Error(USAGE);
    const account = accounts.byName(name);
    if (!account) throw new Error(`No account named ${JSON.stringify(name)}. See: admin.mjs users`);
    const password = randomBytes(12).toString('base64url');
    await accounts.changePassword(account.id, password);
    // Signed-in browsers of the account end; paired PCs keep working.
    accounts.revokeAll(account.id, 'browser');
    return `New password for ${account.name}: ${password}\nSign in with it and change it under Settings → Account.`;
  }
  throw new Error(USAGE);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { dataDir } = loadConfig();
  const db = new VaultDatabase(dataDir);
  try {
    console.log(await runAdminCommand(process.argv.slice(2), new Accounts(db.db), { db, dataDir }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}
