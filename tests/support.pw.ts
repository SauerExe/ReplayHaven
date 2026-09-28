import { test, expect, type Page } from '@playwright/test';

const DAY = 24 * 60 * 60 * 1000;
const setSupport = (page: Page, value: object | null) =>
  page.addInitScript((saved) => {
    // Only once per test: a reload keeps what the banner saved.
    if (saved && !localStorage.getItem('replayhaven.support'))
      localStorage.setItem('replayhaven.support', JSON.stringify(saved));
  }, value);

test('the support banner waits on a first visit', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading').first()).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Support ReplayHaven' })).toHaveCount(0);
  const saved = await page.evaluate(() => localStorage.getItem('replayhaven.support'));
  expect(JSON.parse(saved!).firstSeen).toBeGreaterThan(0);
});

for (const width of [390, 1440])
  test(`the support banner asks after four days and "Later" hides it at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await setSupport(page, { firstSeen: Date.now() - 5 * DAY });
    await page.goto('/');
    const banner = page.getByRole('complementary', { name: 'Support ReplayHaven' });
    await expect(banner).toBeVisible();
    await expect(banner.getByRole('link', { name: 'Tip via PayPal' })).toHaveAttribute(
      'href',
      'https://paypal.me/vvashed',
    );
    // On phones it sits above the bottom navigation, not on top of it.
    if (width < 600) {
      const nav = await page.getByRole('navigation', { name: /mobile|Mobile/ }).boundingBox();
      const box = await banner.boundingBox();
      expect(box!.y + box!.height).toBeLessThanOrEqual(nav!.y);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await banner.getByRole('button', { name: 'Later' }).click();
    await expect(banner).toHaveCount(0);
    const saved = JSON.parse(
      (await page.evaluate(() => localStorage.getItem('replayhaven.support')))!,
    );
    expect(saved.snoozedUntil).toBeGreaterThan(Date.now() + 3 * DAY);
  });

test('"I already donated" hides the support banner for good', async ({ page }) => {
  await setSupport(page, { firstSeen: Date.now() - 30 * DAY });
  await page.goto('/');
  await page.getByRole('button', { name: 'I already donated' }).click();
  await page.reload();
  await expect(page.getByRole('heading').first()).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Support ReplayHaven' })).toHaveCount(0);
});
