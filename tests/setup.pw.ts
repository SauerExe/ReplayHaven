import { test, expect } from '@playwright/test';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

for (const width of [390, 1440]) {
  test(`Setup-Guide öffnet den gewählten Schritt und liefert kopierbare Befehle bei ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/devices');
    await page.getByRole('link', { name: /02 Windows-Client installieren/ }).click();
    await expect(page).toHaveURL(/\/setup#client$/);
    const client = page.getByRole('region', { name: 'Bring deinen PC ins Spiel.' });
    await expect
      .poll(async () => (await client.boundingBox())?.y ?? Infinity)
      .toBeLessThan(width < 850 ? 220 : 150);
    expect((await client.boundingBox())!.y).toBeGreaterThan(65);
    await expect(
      page
        .getByRole('navigation', { name: 'Einrichtungsschritte' })
        .getByRole('link', { name: /02 PC verbinden/ }),
    ).toHaveAttribute('aria-current', 'location');

    await page
      .getByRole('navigation', { name: 'Einrichtungsschritte' })
      .getByRole('link', { name: /01 Server einrichten/ })
      .click();
    await page.getByRole('button', { name: 'Aus dem Quellcode', exact: true }).click();
    await page.getByRole('button', { name: 'Server vorbereiten kopieren' }).click();
    await expect(page.getByRole('button', { name: 'Server vorbereiten kopieren' })).toContainText(
      'Kopiert',
    );
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain('bash setup-server.sh');
    await page.getByRole('button', { name: /Docker-Image/ }).click();
    await page.getByRole('button', { name: 'Server starten kopieren' }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe('docker compose up -d');

    await page.getByText('Mein Server ist nicht erreichbar.', { exact: true }).click();
    await expect(page.getByText('docker compose logs --tail=80', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}

test('Ohne Clipboard-Zugriff wird der Befehl zum manuellen Kopieren markiert', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('Clipboard unavailable')) },
    });
  });
  await page.goto('/setup#server');
  await page.getByRole('button', { name: 'Aus dem Quellcode', exact: true }).click();
  await page.getByRole('button', { name: 'Server vorbereiten kopieren' }).click();
  await expect(
    page.getByText('Befehl markiert. Bitte mit Strg+C oder über das Auswahlmenü kopieren.'),
  ).toBeVisible();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(
    'git clone https://github.com/SauerExe/ReplayHaven.git\ncd ReplayHaven\nbash setup-server.sh',
  );
});
