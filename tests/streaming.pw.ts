import { expect, test, type Page } from '@playwright/test';

const PREVIEW = '/streaming-preview.html';
const MARKER = /^\d+:\d{2}, /;

// The preview runs without a server: calls to /api and foreign hosts may fail, nothing else may.
function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const source = message.location().url;
    if (source.includes('/api/') || (source && !source.startsWith('http://localhost:'))) return;
    errors.push(message.text());
  });
  return errors;
}

let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = collectErrors(page);
});
test.afterEach(() => {
  expect(errors).toEqual([]);
});

test('home page shows the hero and rows in a fixed order', async ({ page }) => {
  await page.goto(PREVIEW);
  const hero = page.getByRole('region', { name: 'Ace auf Inferno' });
  await expect(hero.getByRole('heading', { level: 1, name: 'Ace auf Inferno' })).toBeVisible();
  await expect(hero.getByText('AI title · confidence high')).toBeVisible();
  await expect(page.locator('.stream-row-title')).toHaveText([
    'Continue watching',
    'Recently recorded',
    'Favorites',
    'Counter-Strike 2',
    'Apex Legends',
    'Elden Ring',
    'Your games',
    'Your collections',
    'Sorted automatically',
  ]);
  await expect(
    page
      .getByRole('region', { name: 'Continue watching' })
      .locator('.stream-tile-meta', { hasText: '0:41 left' }),
  ).toBeVisible();
  const fresh = page.getByRole('region', { name: 'Recently recorded' });
  await expect(fresh.locator('.stream-badge', { hasText: 'New' }).first()).toBeVisible();
  await expect(fresh.locator('.stream-tile-analyzing')).toHaveText('AI is analyzing the clip …');
});

test('a tile opens the detail dialog, Escape closes it', async ({ page }) => {
  await page.goto(PREVIEW);
  await page
    .getByRole('region', { name: 'Recently recorded' })
    .getByRole('button', { name: 'Triple Kill auf Mirage', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Triple Kill auf Mirage' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Play', exact: true })).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Favorite' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(dialog.getByText('Gemini (Google)')).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'More from Counter-Strike 2' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('Play opens the player with one marker per highlight, Escape closes it', async ({ page }) => {
  await page.goto(PREVIEW);
  await page
    .getByRole('region', { name: 'Ace auf Inferno' })
    .getByRole('button', { name: 'Details' })
    .click();
  const detail = page.locator('.stream-detail');
  await expect(detail.locator('.stream-mark')).toHaveCount(5);
  await detail.getByRole('button', { name: 'Play', exact: true }).click();

  const player = page.locator('.stream-player');
  await expect(player).toBeVisible();
  const markers = player.getByRole('button', { name: MARKER });
  await expect(markers).toHaveCount(5);
  await expect(markers.first()).toHaveAccessibleName('0:12, Erster Kill');
  await markers.nth(2).hover();
  await expect(player.locator('.stream-marker-tip', { hasText: 'Triple Kill' })).toBeVisible();
  await expect(player.getByRole('button', { name: /^Next highlight/ })).toBeAttached();
  // Without a video file the controls stay and say why nothing plays.
  await expect(player.getByRole('alert')).toContainText('No video file');
  await expect(player.getByText('0:00 / 0:54')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(player).toBeHidden();
  await expect(detail).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(detail).toBeHidden();
});

test('a video that does not load reports it clearly', async ({ page }) => {
  await page.route(
    (url) => url.pathname === '/kaputt.mp4',
    (route) => route.fulfill({ status: 200, contentType: 'video/mp4', body: 'kein Video' }),
  );
  await page.goto(`${PREVIEW}?video=/kaputt.mp4`);
  await page
    .getByRole('region', { name: 'Ace auf Inferno' })
    .getByRole('button', { name: 'Play', exact: true })
    .click();
  const alert = page.locator('.stream-player').getByRole('alert');
  await expect(alert).toContainText('The video cannot be loaded');
  await expect(alert.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('tiles are reachable by keyboard', async ({ page }) => {
  await page.goto(PREVIEW);
  await expect(page.locator('.stream-hero')).toBeVisible();
  let focused: string | null = null;
  for (let i = 0; i < 30 && !focused; i++) {
    await page.keyboard.press('Tab');
    focused = await page.evaluate(() =>
      document.activeElement?.closest('.stream-tile--clip')
        ? document.activeElement.getAttribute('aria-label')
        : null,
    );
  }
  expect(focused).toBe('Dieser Boss hatte andere Pläne');
  // The tiles' play buttons are not in the tab order.
  await page.keyboard.press('Tab');
  const nextTile = page
    .getByRole('region', { name: 'Continue watching' })
    .locator('.stream-tile')
    .nth(1);
  const next = nextTile.getByRole('button', { name: 'Plan B: einfach weiterfahren', exact: true });
  await expect(next).toBeFocused();
  // Focus enlarges the tile like hover: measured width versus layout width.
  await expect
    .poll(() => nextTile.evaluate((el) => el.getBoundingClientRect().width / el.offsetWidth))
    .toBeCloseTo(1.06, 2);
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Plan B: einfach weiterfahren' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(next).toBeFocused();
});

test('at 390 × 844 the page does not overflow sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(PREVIEW);
  await expect(page.locator('.stream-hero')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('in the app frame details and player live in the URL, Back closes them', async ({ page }) => {
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 503, json: { error: 'No server in the preview.' } }),
  );
  // The sample clips point to trailers on the web; the test stays local.
  await page.route(
    (url) => url.hostname !== 'localhost',
    (route) => route.fulfill({ status: 404, body: '' }),
  );
  await page.goto(`${PREVIEW}?modus=app`);
  await expect(page.locator('.stream-hero')).toBeVisible();
  await page
    .getByRole('region', { name: 'Recently recorded' })
    .locator('.stream-tile-open')
    .first()
    .click();
  const detail = page.locator('.stream-detail');
  await expect(detail).toBeVisible();
  await expect(page).toHaveURL(/[?&]clip=/);

  await detail.getByRole('button', { name: 'Play', exact: true }).click();
  const player = page.locator('.stream-player');
  await expect(player).toBeVisible();
  await expect(page).toHaveURL(/[?&]play=/);

  await page.goBack();
  await expect(player).toBeHidden();
  await expect(detail).toBeVisible();
  await expect(page).not.toHaveURL(/play=/);
  await page.goBack();
  await expect(detail).toBeHidden();
  await expect(page).not.toHaveURL(/clip=/);
});

test('the app starts with the streaming home page, the detail dialog fits on a phone', async ({
  page,
}) => {
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 503, json: { error: 'No server in the test.' } }),
  );
  await page.route(
    (url) => url.hostname !== 'localhost',
    (route) => route.fulfill({ status: 404, body: '' }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.stream-hero')).toBeVisible();
  await page.getByRole('button', { name: 'Details', exact: true }).first().click();
  const detail = page.getByRole('dialog');
  await expect(detail).toBeVisible();
  await expect(page).toHaveURL(/[?&]clip=/);
  // aspect-ratio plus a minimum height once pushed the dialog header to 533 px width.
  const close = detail.getByRole('button', { name: 'Close' });
  const box = await close.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await close.click();
  await expect(detail).toBeHidden();
  await expect(page).not.toHaveURL(/clip=/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test('volume: hovering opens the vertical slider, a click mutes', async ({ page }) => {
  await page.goto(PREVIEW);
  await page
    .getByRole('region', { name: 'Ace auf Inferno' })
    .getByRole('button', { name: 'Play' })
    .click();
  const player = page.locator('.stream-player');
  const button = player.getByRole('button', { name: 'Mute' });
  await button.hover();
  const slider = player.getByRole('slider', { name: 'Volume' });
  await expect(slider).toBeVisible();
  // As on Netflix, the slider stands vertically above the icon.
  const box = (await slider.boundingBox())!;
  expect(box.height).toBeGreaterThan(box.width * 2);
  expect(box.y + box.height).toBeLessThanOrEqual((await button.boundingBox())!.y);
  await slider.focus();
  await page.keyboard.press('ArrowDown');
  await expect(slider).toHaveValue('99');
  await button.click();
  await expect(player.getByRole('button', { name: 'Unmute' })).toBeVisible();
  await expect(slider).toHaveValue('0');
  await page.mouse.move(5, 5);
  await expect(slider).toBeHidden();
});

test('the seek bar shows the loaded part and a spinner while playback stalls', async ({ page }) => {
  // Deterministic buffer: pretend the first 27 seconds are loaded.
  await page.addInitScript(() => {
    Object.defineProperty(HTMLMediaElement.prototype, 'buffered', {
      configurable: true,
      get: () => ({ length: 1, start: () => 0, end: () => 27 }),
    });
  });
  // The video request never answers, so the player keeps loading without an error.
  await page.route(
    (url) => url.pathname === '/slow.mp4',
    () => new Promise(() => {}),
  );
  await page.goto(`${PREVIEW}?video=/slow.mp4`);
  await page
    .getByRole('region', { name: 'Ace auf Inferno' })
    .getByRole('button', { name: 'Play', exact: true })
    .click();
  const player = page.locator('.stream-player');
  const video = player.locator('video');
  await video.dispatchEvent('progress');
  // 27 of 54 seconds: the light segment ends halfway, behind the played part.
  await expect(player.locator('.stream-seek')).toHaveAttribute('style', /--buffered: 50%/);
  await expect(player.getByTestId('seek-buffer')).toBeAttached();

  await video.dispatchEvent('waiting');
  const spinner = player.getByRole('status');
  await expect(spinner).toHaveText('Loading video …');
  // No extra focus stop: the spinner is not focusable.
  await expect(spinner.locator('button, [tabindex]')).toHaveCount(0);
  await video.dispatchEvent('playing');
  await expect(spinner).toHaveCount(0);
});

test('the language can be switched to German in the settings', async ({ page }) => {
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 503, json: { error: 'No server in the test.' } }),
  );
  await page.route(
    (url) => url.hostname !== 'localhost',
    (route) => route.fulfill({ status: 404, body: '' }),
  );
  await page.goto('/settings');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.getByLabel('Language').selectOption('de');
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(page.getByLabel('Sprache')).toHaveValue('de');
  await expect(page.getByRole('heading', { name: 'Einstellungen', level: 1 })).toBeVisible();
  // The choice survives a reload and applies to the home page.
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(page.getByRole('link', { name: 'Bibliothek' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Abspielen', exact: true }).first()).toBeVisible();
});
