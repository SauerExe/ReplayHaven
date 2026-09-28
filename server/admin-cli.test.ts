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
