import { test, expect, type Page } from '@playwright/test';

const DAY = 24 * 60 * 60 * 1000;

/** A connected server with a signed-in account; `supportBanner` as the server reports it. */
async function mockServer(page: Page, role: 'admin' | 'user' = 'admin', supportBanner = true) {
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/state')
      return route.fulfill({
        json: {
          accounts: true,
          setupRequired: false,
          setupNeedsKey: true,
          loggedIn: true,
          kind: 'browser',
          role,
          user: { id: 'u1', name: 'timo', role, hasPassword: true, oidcLinked: false },
          passwordLogin: true,
          oidc: null,
        },
      });
    if (path === '/api/status')
      return route.fulfill({
        json: {
          connected: true,
          version: '1.1.3',
          provider: 'none',
          configured: false,
          model: '',
          settings: { autoAnalyze: true, autoTitle: true, includeAudio: false },
          queue: 0,
          devices: [],
          supportBanner,
        },
      });
    return route.fulfill({ json: [] });
  });
}
const setSupport = (page: Page, value: object | null) =>
  page.addInitScript((saved) => {
    // Only once per test: a reload keeps what the banner saved.
    if (saved && !localStorage.getItem('replayhaven.support'))
      localStorage.setItem('replayhaven.support', JSON.stringify(saved));
  }, value);
const banner = (page: Page) => page.getByRole('complementary', { name: 'Support ReplayHaven' });

test('the support banner waits on a first visit', async ({ page }) => {
  await mockServer(page);
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'ReplayHaven home' }).first()).toBeVisible();
  await expect(banner(page)).toHaveCount(0);
  const saved = await page.evaluate(() => localStorage.getItem('replayhaven.support'));
  expect(JSON.parse(saved!).firstSeen).toBeGreaterThan(0);
});

for (const width of [390, 1440])
  test(`the support banner asks admins after four days and "Later" hides it at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockServer(page);
    await setSupport(page, { firstSeen: Date.now() - 5 * DAY });
    await page.goto('/');
    await expect(banner(page)).toBeVisible();
    await expect(banner(page).getByRole('link', { name: 'Tip via PayPal' })).toHaveAttribute(
      'href',
      'https://paypal.me/vvashed',
    );
    // On phones it sits above the bottom navigation, not on top of it.
    if (width < 600) {
      const nav = await page.getByRole('navigation', { name: 'Mobile navigation' }).boundingBox();
      const box = await banner(page).boundingBox();
      expect(box!.y + box!.height).toBeLessThanOrEqual(nav!.y);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await banner(page).getByRole('button', { name: 'Later' }).click();
    await expect(banner(page)).toHaveCount(0);
    const saved = JSON.parse(
      (await page.evaluate(() => localStorage.getItem('replayhaven.support')))!,
    );
    expect(saved.snoozedUntil).toBeGreaterThan(Date.now() + 3 * DAY);
  });

test('"I already donated" hides the support banner for good', async ({ page }) => {
  await mockServer(page);
  await setSupport(page, { firstSeen: Date.now() - 30 * DAY });
  await page.goto('/');
  await banner(page).getByRole('button', { name: 'I already donated' }).click();
  await page.reload();
  await expect(page.getByRole('link', { name: 'ReplayHaven home' }).first()).toBeVisible();
  await expect(banner(page)).toHaveCount(0);
});

test('users, switched-off servers and the demo never see the support banner', async ({ page }) => {
  await setSupport(page, { firstSeen: Date.now() - 30 * DAY });
  for (const setup of [
    () => mockServer(page, 'user'),
    () => mockServer(page, 'admin', false),
    () => page.route('**/api/**', (route) => route.abort()),
  ]) {
    await page.unrouteAll();
    await setup();
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'ReplayHaven home' }).first()).toBeVisible();
    await page.waitForTimeout(500);
    await expect(banner(page)).toHaveCount(0);
  }
});
