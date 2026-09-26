import { test, expect } from '@playwright/test';

test('clip search keeps selections across search terms and adds exactly those', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/collections');
  await page.getByRole('button', { name: 'New collection', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Über mehrere Suchbegriffe');
  await page
    .getByLabel('Description (optional)', { exact: true })
    .fill('Unsere gemeinsamen Runden');
  await page.getByRole('button', { name: 'Create collection', exact: true }).click();
  await expect(page.getByText('Unsere gemeinsamen Runden', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add clips', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  const search = dialog.getByRole('textbox', { name: 'Choose clips: search' });
  await search.fill('Dieser Boss');
  await dialog
    .getByRole('checkbox', { name: 'Dieser Boss hatte andere Pläne', exact: true })
    .check();
  await search.fill('Drift');
  await dialog.getByRole('checkbox', { name: 'Der sauberste Drift bisher', exact: true }).check();
  await search.fill('keine-treffer-123');
  await expect(dialog.getByRole('heading', { name: 'No matches', exact: true })).toBeVisible();
  await expect(dialog.getByRole('status')).toHaveText('2 selected');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  // The collection shows its clips in the streaming view (src/streaming/CollectionsPage.tsx).
  await expect(page.locator('.stream-grid .stream-tile--clip')).toHaveCount(2);
  await page.reload();
  await expect(page.locator('.stream-grid .stream-tile-title')).toHaveText([
    'Dieser Boss hatte andere Pläne',
    'Der sauberste Drift bisher',
  ]);
});

test('deselecting only visible clips keeps the rest of the selection', async ({ page }) => {
  await page.goto('/collections/clutches');
  await page.getByRole('button', { name: 'Add clips', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const search = dialog.getByRole('textbox', { name: 'Choose clips: search' });
  await search.fill('Dieser Boss');
  await dialog.getByRole('button', { name: 'Select visible' }).click();
  await search.fill('Drift');
  const visibleMatches = await dialog.getByRole('checkbox').count();
  expect(visibleMatches).toBeGreaterThan(1);
  await dialog.getByRole('button', { name: 'Select visible' }).click();
  await expect(dialog.getByRole('status')).toHaveText(`${visibleMatches + 1} selected`);
  await dialog.getByRole('button', { name: 'Deselect visible' }).click();
  await expect(dialog.getByRole('status')).toHaveText('1 selected');
  await search.fill('Dieser Boss');
  await expect(
    dialog.getByRole('checkbox', { name: 'Dieser Boss hatte andere Pläne', exact: true }),
  ).toBeChecked();
});

test('Escape returns focus to the dialog opener and the clip menu', async ({ page }) => {
  await page.goto('/collections');
  const create = page.getByRole('button', { name: 'New collection', exact: true });
  await create.click();
  await page.getByLabel('Title', { exact: true }).fill('Unfertig');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(create).toBeFocused();
  await page.goto('/library');
  const menu = page.getByRole('button', {
    name: 'Actions for Dieser Boss hatte andere Pläne',
    exact: true,
  });
  await menu.click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
});

test('mobile selection counts all clips and can be ended again', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/library');
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByRole('button', { name: 'Select all', exact: true }).click();
  const tiles = page.locator('.stream-grid .stream-tile--clip');
  const count = await tiles.count();
  expect(count).toBeGreaterThan(1);
  await expect(page.locator('.stream-bulk-count')).toHaveText(`${count} selected`);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.stream-bulk')).toHaveCount(0);
  await expect(tiles).toHaveCount(count);
});
