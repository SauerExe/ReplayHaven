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
  test(`Spielinfos zeigen den Abrufstatus und aktualisieren sich bei ${width}px`, async ({
    page,
  }) => {
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
    const section = page.getByRole('region', { name: 'Spielinfos', exact: true });
    await expect(section.getByText('Automatischer Abruf aktiv', { exact: true })).toBeVisible();
    await expect(
      section.getByText('2 von 3 Spielen mit Infos · 1 ohne eindeutigen Treffer'),
    ).toBeVisible();
    await section.getByRole('button', { name: 'Jetzt aktualisieren' }).click();
    await expect(section.getByRole('button', { name: 'Wird aktualisiert …' })).toBeDisabled();
    await expect(section.getByText('3 Spiele werden gerade abgefragt.')).toBeVisible();
    expect(requests).toBe(1);
    metadata = { ...metadata, pending: 0, matched: 3, missing: 0 };
    await expect(
      section.getByText('3 von 3 Spielen mit Infos · 0 ohne eindeutigen Treffer'),
    ).toBeVisible({ timeout: 10000 });
    await expect(section.getByRole('button', { name: 'Jetzt aktualisieren' })).toBeEnabled();
    await section.screenshot({ path: `artifacts/game-metadata-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}

test('Ein deaktivierter Abruf zeigt den Zustand und erlaubt keinen neuen Auftrag', async ({
  page,
}) => {
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
  const section = page.getByRole('region', { name: 'Spielinfos', exact: true });
  await expect(section.getByText('Automatischer Abruf deaktiviert', { exact: true })).toBeVisible();
  await expect(section.getByRole('button', { name: 'Jetzt aktualisieren' })).toBeDisabled();
});
