import { test, expect, type Page } from '@playwright/test';
/** Clip tiles in the library and collection grid. */
const tiles = (page: Page) => page.locator('.stream-grid .stream-tile--clip');
test('missing media, processing state and an empty library stay usable', async ({ page }) => {
  await page.goto('/library');
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('replayhaven.v1')!);
    state.clips[0].videoSource = undefined;
    state.clips[0].thumbnail = '/missing-artwork.webp';
    state.clips[1].status = 'processing';
    localStorage.setItem('replayhaven.v1', JSON.stringify(state));
  });
  await page.goto('/clips/elden-1');
  await expect(page.getByRole('heading', { name: 'No video file available' })).toBeVisible();
  await page.goto('/clips/elden-2');
  await expect(page.getByRole('heading', { name: 'Clip is being processed' })).toBeVisible();
  await page.goto('/library?status=processing');
  await expect(tiles(page)).toHaveCount(1);
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('replayhaven.v1')!);
    state.clips = [];
    state.collections = [];
    localStorage.setItem('replayhaven.v1', JSON.stringify(state));
  });
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'No clips yet' })).toBeVisible();
  await page.getByRole('button', { name: 'Add clip', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});
test('search, filters and favorites stay consistent and saved', async ({ page }) => {
  await page.goto('/library');
  await page.getByRole('textbox', { name: 'Search library' }).fill('Clutch');
  await page
    .getByRole('group', { name: 'Filter by game' })
    .getByRole('button', { name: /^Counter-Strike 2/ })
    .click();
  await expect(tiles(page)).toHaveCount(4);
  await page.getByRole('button', { name: 'Favorites', exact: true }).click();
  await expect(tiles(page)).toHaveCount(1);
  await tiles(page)
    .first()
    .getByRole('button', { name: /from favorites/ })
    .click();
  await expect(page.getByRole('heading', { name: 'No matches' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'No matches' })).toBeVisible();
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await expect(tiles(page)).toHaveCount(20);
});
test('create, fill and rename a collection, then open it after a reload', async ({ page }) => {
  await page.goto('/collections');
  await page.getByRole('button', { name: 'New collection', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Unsere beste Runde');
  await page.getByRole('button', { name: 'Create collection', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Unsere beste Runde' })).toBeVisible();
  await page.getByRole('button', { name: 'Add clips', exact: true }).first().click();
  await page.getByRole('checkbox', { name: 'Dieser Boss hatte andere Pläne', exact: true }).check();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(tiles(page)).toHaveCount(1);
  await page.reload();
  await expect(tiles(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'Actions for Dieser Boss hatte andere Pläne' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Unser Highlight');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.reload();
  await expect(tiles(page).locator('.stream-tile-title')).toHaveText('Unser Highlight');
  await page.getByRole('button', { name: 'Remove Unser Highlight from collection' }).click();
  await expect(tiles(page)).toHaveCount(0);
  await page.goto('/library?q=Unser%20Highlight');
  await expect(tiles(page)).toHaveCount(1);
});
test('multi-select deletes only after confirmation', async ({ page }) => {
  await page.goto('/library?game=cs2');
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByRole('button', { name: 'Select all', exact: true }).click();
  await page.getByRole('button', { name: 'Delete selection' }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(tiles(page)).toHaveCount(4);
  await page.getByRole('button', { name: 'Delete selection' }).click();
  await page.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(tiles(page)).toHaveCount(0);
  await page.reload();
  await expect(tiles(page)).toHaveCount(0);
});
test('a real external video plays and resumes from the actual progress', async ({ page }) => {
  await page.goto('/clips/elden-1');
  await expect(page.getByRole('heading', { name: 'Dieser Boss hatte andere Pläne' })).toBeVisible();
  await page.waitForFunction(
    () => {
      const v = document.querySelector('video');
      return v && v.readyState >= 2;
    },
    null,
    { timeout: 30000 },
  );
  await page.locator('video').evaluate((v) => {
    v.currentTime = 8;
    return v.play();
  });
  await page.waitForFunction(() => document.querySelector('video')!.currentTime > 9);
  await page.locator('video').evaluate((v) => v.pause());
  await page.reload();
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate((v) => v.currentTime)).toBeGreaterThan(8);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Continue watching', exact: true })).toBeVisible();
});
test('local file, format error and an honest share preview', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Upload clip', exact: true }).click();
  await page.getByLabel('Choose video files').setInputFiles({
    name: 'invalid.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('not a video'),
  });
  await expect(page.getByText(/This format is not supported/)).toBeVisible();
  // Ephemeral video fixture produced only in this test; never added to the product's assets.
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 180;
    const ctx = canvas.getContext('2d')!;
    const stream = canvas.captureStream(15);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    const result = new Promise<number[]>((resolve) => {
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () =>
        resolve([...new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer())]);
    });
    recorder.start();
    let frame = 0;
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        ctx.fillStyle = frame % 2 ? '#282338' : '#a78bfa';
        ctx.fillRect(0, 0, 320, 180);
        if (++frame >= 15) {
          clearInterval(timer);
          recorder.stop();
          stream.getTracks().forEach((t) => t.stop());
          resolve();
        }
      }, 75);
    });
    return result;
  });
  await page
    .getByLabel('Choose video files')
    .setInputFiles({ name: 'local-test.webm', mimeType: 'video/webm', buffer: Buffer.from(bytes) });
  await expect(page.getByText('Local preview ready')).toBeVisible({ timeout: 20000 });
  await page.getByRole('link', { name: 'Play local-test.webm' }).click();
  await expect(page.getByRole('heading', { name: 'local-test', exact: true })).toBeVisible();
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    return video && video.readyState >= 2;
  });
  await page.locator('video').evaluate((v) => v.play());
  await expect.poll(() => page.locator('video').evaluate((v) => v.currentTime)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Share clip', exact: true }).click();
  await expect(page.getByText(/Public sharing is not available yet/)).toBeVisible();
  await page.getByRole('link', { name: 'Preview', exact: true }).click();
  await expect(page.locator('.share-page')).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Share not available' })).toBeVisible();
});
test('mobile menus, filters, focus and error pages', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Mobile navigation' })
    .getByRole('link', { name: 'Library' })
    .click();
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await expect(page.getByLabel('Filter by status')).toBeVisible();
  await page
    .getByRole('group', { name: 'Filter by game' })
    .getByRole('button', { name: /^ELDEN RING/ })
    .click();
  await expect(tiles(page)).toHaveCount(4);
  await page
    .getByRole('navigation', { name: 'Mobile navigation' })
    .getByRole('button', { name: 'Profile menu' })
    .click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  // Phones get the section list first, then one section with a way back.
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Appearance' }).click();
  await expect(page.getByRole('heading', { name: 'Appearance', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
  await page.getByRole('switch', { name: 'Reduce motion' }).click();
  await page.reload();
  await expect(page.getByRole('switch', { name: 'Reduce motion' })).toBeChecked();
  await page.getByRole('button', { name: 'Upload clip', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/clips/unknown');
  await expect(page.getByRole('heading', { name: 'Clip not found' })).toBeVisible();
  await page.goto('/unknown');
  await expect(page.getByRole('heading', { name: 'No clip landed here.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
test('the clip page player shows the loaded part and a spinner while playback stalls', async ({
  page,
}) => {
  // Deterministic media: 54 seconds long, the first 27 seconds loaded, and the request never answers.
  await page.addInitScript(() => {
    Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
      configurable: true,
      get: () => 54,
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'buffered', {
      configurable: true,
      get: () => ({ length: 1, start: () => 0, end: () => 27 }),
    });
  });
  await page.route(
    (url) => url.hostname !== 'localhost',
    () => new Promise(() => {}),
  );
  await page.goto('/clips/elden-1');
  const video = page.locator('.video-stage video');
  // The real loadstart may still reset the strip, so repeat the progress event until it sticks.
  await expect
    .poll(async () => {
      await video.dispatchEvent('progress');
      return page.getByTestId('seek-buffer').getAttribute('style');
    })
    .toMatch(/--buffered: 50%/);
  await video.dispatchEvent('waiting');
  const spinner = page.getByTestId('player-buffering');
  await expect(spinner).toHaveText('Loading video …');
  await expect(spinner).toHaveRole('status');
  await video.dispatchEvent('playing');
  await expect(spinner).toHaveCount(0);
});

test('a page chunk that fails to load shows a reload message instead of a white screen', async ({
  page,
}) => {
  await page.route('**/src/streaming/LibraryPage.tsx*', (route) => route.abort());
  await page.goto('/');
  await expect(page).toHaveTitle('ReplayHaven · Your best moments');
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'This page could not be loaded' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload page' })).toBeVisible();
  // The rest of the app still works: another page renders again.
  await page.getByRole('link', { name: 'Collections', exact: true }).first().click();
  await expect(page).toHaveTitle('Collections · ReplayHaven');
  await expect(page.getByRole('heading', { name: 'This page could not be loaded' })).toBeHidden();
});
