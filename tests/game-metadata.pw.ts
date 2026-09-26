import { expect, test } from '@playwright/test';
import type { GameMetadataStatus } from '../src/domain/models';

const initial: GameMetadataStatus = {
  enabled: true,
  total: 3,
  matched: 2,
  missing: 1,
  failed: 0,
  pending: 0,
};
for (const width of [390, 1440]) {
  test(`game info shows the fetch status and refreshes at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    let metadata = { ...initial };
    let requests = 0;
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/status')
        return route.fulfill({
          json: {
            connected: true,
            provider: 'none',
            configured: false,
            model: '',
            settings: { autoAnalyze: true, autoTitle: true, includeAudio: false },
            queue: 0,
            devices: [],
            gameMetadata: metadata,
          },
        });
      if (url.pathname === '/api/games/refresh') {
        expect(route.request().method()).toBe('POST');
        requests++;
        metadata = { ...metadata, pending: 3 };
        return route.fulfill({ status: 202, json: { queued: 3 } });
      }
      return route.fulfill({ json: [] });
    });
    await page.goto('/settings#games');
    const section = page.getByRole('region', { name: 'Game info', exact: true });
    await expect(section.getByText('Automatic fetching', { exact: true })).toBeVisible();
    await expect(section.getByText('On', { exact: true })).toBeVisible();
    await expect(
      section.getByText('2 of 3 games with info · 1 without a clear match'),
    ).toBeVisible();
    await section.getByRole('button', { name: 'Update now' }).click();
    await expect(section.getByRole('button', { name: 'Updating …' })).toBeDisabled();
    await expect(section.getByText('3 games are being looked up right now.')).toBeVisible();
    expect(requests).toBe(1);
    metadata = { ...metadata, pending: 0, matched: 3, missing: 0 };
    await expect(section.getByText('3 of 3 games with info · 0 without a clear match')).toBeVisible(
      { timeout: 10000 },
    );
    await expect(section.getByRole('button', { name: 'Update now' })).toBeEnabled();
    await section.screenshot({ path: `artifacts/game-metadata-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}

test('disabled fetching shows its state and allows no new job', async ({ page }) => {
  await page.route('**/api/**', (route) =>
    route.fulfill({
      json: route.request().url().endsWith('/status')
        ? {
            connected: true,
            provider: 'none',
            configured: false,
            model: '',
            settings: { autoAnalyze: true, autoTitle: true, includeAudio: false },
            queue: 0,
            devices: [],
            gameMetadata: { ...initial, enabled: false },
          }
        : [],
    }),
  );
  await page.goto('/settings#games');
  const section = page.getByRole('region', { name: 'Game info', exact: true });
  await expect(section.getByText('Off', { exact: true })).toBeVisible();
  await expect(section.getByRole('button', { name: 'Update now' })).toBeDisabled();
});
