/**
 * Admin commands for the machine the server runs on, for when nobody can sign in anymore:
 *
 *   docker exec -it replayhaven node server-bundle/admin.mjs users
 *   docker exec -it replayhaven node server-bundle/admin.mjs reset-password <name>
 *
 * From a source checkout: npm run admin -- users. Whoever can run this already controls the data
 * directory, so it needs no further key.
 */
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Accounts } from './auth';
import { loadConfig } from './config';
import { VaultDatabase } from './database';

const USAGE = 'Usage: admin.mjs users | admin.mjs reset-password <name>';

/** Runs one command and returns what to print; throws a message for the user on bad input. */
export async function runAdminCommand(args: string[], accounts: Accounts) {
  const [command, name] = args;
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
  const db = new VaultDatabase(loadConfig().dataDir);
  try {
    console.log(await runAdminCommand(process.argv.slice(2), new Accounts(db.db)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}
