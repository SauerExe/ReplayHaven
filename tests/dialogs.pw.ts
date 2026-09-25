import { test, expect } from '@playwright/test';

test('Clipsuche behält Auswahlen über Suchbegriffe hinweg und fügt genau diese hinzu', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/collections');
  await page.getByRole('button', { name: 'Neue Sammlung', exact: true }).click();
  await page.getByLabel('Titel', { exact: true }).fill('Über mehrere Suchbegriffe');
  await page
    .getByLabel('Beschreibung (optional)', { exact: true })
    .fill('Unsere gemeinsamen Runden');
  await page.getByRole('button', { name: 'Sammlung erstellen', exact: true }).click();
  await expect(page.getByText('Unsere gemeinsamen Runden', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clips hinzufügen', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  const search = dialog.getByRole('textbox', { name: 'Clips auswählen: Suche' });
  await search.fill('Dieser Boss');
  await dialog
    .getByRole('checkbox', { name: 'Dieser Boss hatte andere Pläne', exact: true })
    .check();
  await search.fill('Drift');
  await dialog.getByRole('checkbox', { name: 'Der sauberste Drift bisher', exact: true }).check();
  await search.fill('keine-treffer-123');
  await expect(dialog.getByRole('heading', { name: 'Keine Treffer', exact: true })).toBeVisible();
  await expect(dialog.getByRole('status')).toHaveText('2 ausgewählt');
  await dialog.getByRole('button', { name: 'Hinzufügen', exact: true }).click();
  // Die Sammlung zeigt ihre Clips in der Streaming-Ansicht (src/streaming/CollectionsPage.tsx).
  await expect(page.locator('.stream-grid .stream-tile--clip')).toHaveCount(2);
  await page.reload();
  await expect(page.locator('.stream-grid .stream-tile-title')).toHaveText([
    'Dieser Boss hatte andere Pläne',
    'Der sauberste Drift bisher',
  ]);
});

test('Nur sichtbare Clips abwählen lässt die übrige Auswahl bestehen', async ({ page }) => {
  await page.goto('/collections/clutches');
  await page.getByRole('button', { name: 'Clips hinzufügen', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const search = dialog.getByRole('textbox', { name: 'Clips auswählen: Suche' });
  await search.fill('Dieser Boss');
  await dialog.getByRole('button', { name: 'Sichtbare auswählen' }).click();
  await search.fill('Drift');
  const visibleMatches = await dialog.getByRole('checkbox').count();
  expect(visibleMatches).toBeGreaterThan(1);
  await dialog.getByRole('button', { name: 'Sichtbare auswählen' }).click();
  await expect(dialog.getByRole('status')).toHaveText(`${visibleMatches + 1} ausgewählt`);
  await dialog.getByRole('button', { name: 'Sichtbare abwählen' }).click();
  await expect(dialog.getByRole('status')).toHaveText('1 ausgewählt');
  await search.fill('Dieser Boss');
  await expect(
    dialog.getByRole('checkbox', { name: 'Dieser Boss hatte andere Pläne', exact: true }),
  ).toBeChecked();
});

test('Escape gibt den Fokus an Dialogauslöser und Clip-Menü zurück', async ({ page }) => {
  await page.goto('/collections');
  const create = page.getByRole('button', { name: 'Neue Sammlung', exact: true });
  await create.click();
  await page.getByLabel('Titel', { exact: true }).fill('Unfertig');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(create).toBeFocused();
  await page.goto('/library');
  const menu = page.getByRole('button', {
    name: 'Aktionen für Dieser Boss hatte andere Pläne',
    exact: true,
  });
  await menu.click();
  await page.getByRole('menuitem', { name: 'Umbenennen' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
});

test('Mobile Auswahl zählt alle Clips und lässt sich wieder beenden', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/library');
  await page.getByRole('button', { name: 'Auswählen', exact: true }).click();
  await page.getByRole('button', { name: 'Alle auswählen', exact: true }).click();
  const tiles = page.locator('.stream-grid .stream-tile--clip');
  const count = await tiles.count();
  expect(count).toBeGreaterThan(1);
  await expect(page.locator('.stream-bulk-count')).toHaveText(`${count} ausgewählt`);
  await page.getByRole('button', { name: 'Beenden', exact: true }).click();
  await expect(page.locator('.stream-bulk')).toHaveCount(0);
  await expect(tiles).toHaveCount(count);
});
