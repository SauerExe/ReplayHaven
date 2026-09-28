import { test, expect } from '@playwright/test';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

for (const width of [390, 1440]) {
  test(`setup guide opens the chosen step and offers copyable commands at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/setup');
    await page
      .getByRole('navigation', { name: 'Setup steps' })
      .getByRole('link', { name: /02 Connect your PC/ })
      .click();
    await expect(page).toHaveURL(/\/setup#client$/);
    const client = page.getByRole('region', { name: 'Connect your recording PC' });
    await expect
      .poll(async () => (await client.boundingBox())?.y ?? Infinity)
      .toBeLessThan(width < 850 ? 220 : 150);
    expect((await client.boundingBox())!.y).toBeGreaterThan(65);
    await expect(
      page
        .getByRole('navigation', { name: 'Setup steps' })
        .getByRole('link', { name: /02 Connect your PC/ }),
    ).toHaveAttribute('aria-current', 'location');

    await page
      .getByRole('navigation', { name: 'Setup steps' })
      .getByRole('link', { name: /01 Set up the server/ })
      .click();
    await page.getByRole('button', { name: 'From source', exact: true }).click();
    await page.getByRole('button', { name: 'Copy Prepare the server' }).click();
    await expect(page.getByRole('button', { name: 'Copy Prepare the server' })).toContainText(
      'Copied',
    );
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain('bash setup-server.sh');
    await page.getByRole('button', { name: /Docker image/ }).click();
    await page.getByRole('button', { name: 'Copy Prepare the server' }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(
        'curl -fsSL https://github.com/SauerExe/ReplayHaven/releases/latest/download/install.sh | bash',
      );

    await page.getByText('My server can’t be reached.', { exact: true }).click();
    await expect(page.getByText('docker compose logs --tail=80', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}

test('without clipboard access the command is selected for manual copying', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('Clipboard unavailable')) },
    });
  });
  await page.goto('/setup#server');
  await page.getByRole('button', { name: 'From source', exact: true }).click();
  await page.getByRole('button', { name: 'Copy Prepare the server' }).click();
  await expect(
    page.getByText('Command selected. Copy it with Ctrl+C or the selection menu.'),
  ).toBeVisible();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(
    'git clone https://github.com/SauerExe/ReplayHaven.git\ncd ReplayHaven\nbash setup-server.sh',
  );
});
