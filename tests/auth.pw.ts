import { expect, test, type Page } from '@playwright/test';

const signedOut = {
  accounts: true,
  setupRequired: false,
  setupNeedsKey: false,
  loggedIn: false,
  kind: null,
  role: null,
  user: null,
  passwordLogin: true,
  oidc: null,
};

/** Mocks the auth API; returns the bodies of every POST in order. */
async function mockAuth(page: Page, state: Record<string, unknown>, loginStatus = 401) {
  const posts: { path: string; body: unknown }[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/auth/state') return route.fulfill({ json: { ...signedOut, ...state } });
    if (request.method() === 'POST') {
      posts.push({ path, body: request.postDataJSON() });
      if (path === '/api/auth/login')
        return route.fulfill({
          status: loginStatus,
          json: { error: 'Name or password is wrong.' },
        });
      if (path === '/api/auth/qr/redeem')
        return route.fulfill({ status: 400, json: { error: 'The code has expired.' } });
      if (path === '/api/auth/setup')
        return route.fulfill({
          status: 401,
          json: { error: 'The access key from the server setup is wrong.' },
        });
    }
    return route.fulfill({ json: [] });
  });
  return posts;
}

test('sign in shows one inline alert and marks the wrong field', async ({ page }) => {
  const posts = await mockAuth(page, {});
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in to your account' })).toBeVisible();

  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Enter your name.');
  await expect(page.getByLabel('Name')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Name')).toBeFocused();
  expect(posts).toEqual([]);

  await page.getByLabel('Name').fill('Timo');
  await page.getByLabel('Password', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Name or password is wrong.');
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(page.getByLabel('Name')).not.toHaveAttribute('aria-invalid', 'true');
  expect(posts).toEqual([{ path: '/api/auth/login', body: { name: 'Timo', password: 'wrong' } }]);
});

test('first-account setup checks the passwords and sends the access key', async ({ page }) => {
  const posts = await mockAuth(page, { setupRequired: true, setupNeedsKey: true });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Create your admin account' })).toBeVisible();
  await page.getByLabel('Name').fill('Timo');
  await page.getByLabel('Password', { exact: true }).fill('password123');
  await page.getByLabel('Repeat password').fill('password124');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('alert')).toHaveText('The two passwords don’t match.');
  await expect(page.getByLabel('Repeat password')).toHaveAttribute('aria-invalid', 'true');

  await page.getByLabel('Repeat password').fill('password123');
  await page.getByLabel('Setup access key').fill('wrong-key');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'The access key from the server setup is wrong.',
  );
  await expect(page.getByLabel('Setup access key')).toHaveAttribute('aria-invalid', 'true');
  expect(posts).toEqual([
    {
      path: '/api/auth/setup',
      body: { name: 'Timo', password: 'password123', key: 'wrong-key' },
    },
  ]);
});

test('single sign-on sits above the form, or alone without password sign-in', async ({ page }) => {
  await mockAuth(page, { oidc: { enabled: true, name: 'Authentik' } });
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Sign in with Authentik' })).toHaveAttribute(
    'href',
    '/api/auth/oidc/start',
  );
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();

  await page.unrouteAll();
  await mockAuth(page, { passwordLogin: false, oidc: { enabled: true, name: 'Authentik' } });
  await page.goto('/?login_error=Denied%20by%20Authentik');
  await expect(page.getByRole('alert')).toHaveText('Denied by Authentik');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('link', { name: 'Sign in with Authentik' })).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
});

test('the footer switches the language', async ({ page }) => {
  await mockAuth(page, {});
  await page.goto('/');
  await page.getByRole('button', { name: 'Deutsch' }).click();
  await expect(page.getByRole('heading', { name: 'Bei deinem Konto anmelden' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Deutsch' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to your account' })).toBeVisible();
});

test('phones get the QR hint next to the password and a full-bleed card', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAuth(page, {});
  await page.goto('/');
  const toggle = page.getByRole('button', { name: 'Use a QR code instead' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('choose “Connect phone”')).toBeVisible();
  const card = await page.locator('.auth-card').boundingBox();
  expect(card?.x).toBe(0);
  expect(card?.width).toBe(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test('a failed QR code explains what to do next', async ({ page }) => {
  await mockAuth(page, {});
  await page.goto('/connect?code=expired-code-0123456789');
  await expect(page.getByRole('heading', { name: 'This code didn’t work' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText('The code has expired.');
  await expect(page.getByRole('link', { name: 'Go to sign-in' })).toHaveAttribute('href', '/');
});
