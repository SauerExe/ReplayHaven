import { expect, test, type Page } from '@playwright/test';

/** An admin signed in to a server with accounts, one pairing request and two users. */
async function mockAdmin(page: Page) {
  const calls: string[] = [];
  let pending = [
    {
      id: 'p1',
      code: '123456',
      name: 'GAMING-PC',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300000).toISOString(),
    },
  ];
  let users = [
    {
      id: 'u1',
      name: 'admin',
      role: 'admin',
      disabled: false,
      createdAt: '2026-09-01T10:00:00Z',
      hasPassword: true,
      oidcLinked: false,
      sessions: { browser: 1, client: 0 },
      self: true,
    },
    {
      id: 'u2',
      name: 'freund',
      role: 'user',
      disabled: false,
      createdAt: '2026-09-02T10:00:00Z',
      hasPassword: true,
      oidcLinked: false,
      sessions: { browser: 0, client: 0 },
      self: false,
    },
  ];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') calls.push(`${request.method()} ${path}`);
    if (path === '/api/auth/state')
      return route.fulfill({
        json: {
          accounts: true,
          setupRequired: false,
          setupNeedsKey: false,
          loggedIn: true,
          kind: 'browser',
          role: 'admin',
          user: { id: 'u1', name: 'admin', role: 'admin', hasPassword: true, oidcLinked: false },
          passwordLogin: true,
          oidc: null,
        },
      });
    if (path === '/api/status')
      return route.fulfill({
        json: {
          connected: true,
          version: '1.2.0',
          provider: 'none',
          configured: false,
          model: '',
          settings: { autoAnalyze: true, autoTitle: true, includeAudio: false },
          queue: 0,
          devices: [],
          playback: { mode: 'web', pending: 3, done: 1 },
        },
      });
    if (path === '/api/pair/pending') return route.fulfill({ json: pending });
    if (path === '/api/pair/p1/approve') {
      pending = [];
      return route.fulfill({ json: { approved: true } });
    }
    if (path === '/api/users' && request.method() === 'POST') {
      users = [...users, { ...users[1], id: 'u3', name: 'neu', self: false }];
      return route.fulfill({ status: 201, json: {} });
    }
    if (path === '/api/users') return route.fulfill({ json: users });
    if (path === '/api/users/u2' && request.method() === 'DELETE') {
      users = users.filter((u) => u.id !== 'u2');
      return route.fulfill({ json: { deleted: true } });
    }
    return route.fulfill({ json: [] });
  });
  return calls;
}

test('pairing requests show a nav badge and are approved from Recording PCs', async ({ page }) => {
  const calls = await mockAdmin(page);
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/settings\/account$/);
  const nav = page.getByRole('navigation', { name: 'Settings sections' });
  const pcs = nav.getByRole('link', { name: /Recording PCs/ });
  await expect(pcs).toContainText('1');
  await expect(pcs).toHaveAccessibleName(/Recording PCs\s*1 pairing request/);
  await pcs.click();
  const requests = page.getByRole('group', { name: 'Pairing requests' });
  await expect(requests.getByText('GAMING-PC wants to connect')).toBeVisible();
  await expect(requests.getByText('123 456')).toBeVisible();
  await requests.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('PC approved. It connects within a few seconds.')).toBeVisible();
  await expect(requests).toHaveCount(0);
  await expect(pcs).not.toContainText('1');
  expect(calls).toContain('POST /api/pair/p1/approve');
});

test('the server section shows version, role and smooth playback progress', async ({ page }) => {
  await mockAdmin(page);
  await page.goto('/settings/server');
  await expect(page.getByText('Version 1.2.0', { exact: false })).toBeVisible();
  await expect(page.getByText('You are signed in as admin · Admin')).toBeVisible();
  await expect(page.getByText('Preparing smooth playback: 3 clips left')).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Smooth playback' })).toHaveAttribute(
    'aria-valuenow',
    '25',
  );
  await expect(page.getByRole('switch', { name: 'Apply AI titles automatically' })).toBeEnabled();
});

test('users are added in a dialog and deleted after a confirmation', async ({ page }) => {
  const calls = await mockAdmin(page);
  await page.goto('/users');
  await expect(page).toHaveURL(/\/settings\/users$/);
  const add = page.getByRole('button', { name: 'Add user' });
  await add.click();
  const dialog = page.getByRole('dialog', { name: 'Add user' });
  await dialog.getByLabel('Name').fill('neu');
  await dialog.getByLabel('Password').fill('ein-langes-passwort');
  await dialog.getByRole('button', { name: 'Add user' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(add).toBeFocused();
  await expect(page.getByText('Account “neu” created.')).toBeVisible();

  const menu = page.getByRole('button', { name: 'Actions for freund' });
  await menu.click();
  await page.getByRole('menuitem', { name: 'Delete account' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete “freund”?' });
  await expect(confirm).toBeVisible();
  expect(calls).not.toContain('DELETE /api/users/u2');
  await confirm.getByRole('button', { name: 'Delete account' }).click();
  await expect(page.getByText('“freund” was deleted.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Actions for freund' })).toHaveCount(0);
  expect(calls).toEqual(['POST /api/users', 'DELETE /api/users/u2']);
});

test('phones get a section list, then one section with a back link', async ({ page }) => {
  await mockAdmin(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'Storage' }).click();
  await expect(page).toHaveURL(/\/settings\/storage$/);
  await expect(page.getByRole('heading', { name: 'Storage', level: 1 })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Danger zone' })).toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
