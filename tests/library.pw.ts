import { expect, test, type Page } from '@playwright/test';
import type { Clip } from '../src/domain/models';

// Library and collections in streaming style. Calls to /api and foreign hosts may fail.
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

const tiles = (page: Page) => page.locator('.stream-grid .stream-tile--clip');

/** Sample data without a server; the trailers on the web stay out. */
async function offline(page: Page) {
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 503, json: { error: 'No server in the test.' } }),
  );
  await page.route(
    (url) => url.hostname !== 'localhost',
    (route) => route.fulfill({ status: 404, body: '' }),
  );
}

// What the server delivers after looking up Steam; the description is our own text.
const siege = {
  key: 'rainbow six siege',
  label: 'Rainbow Six Siege',
  name: 'Tom Clancy’s Rainbow Six® Siege',
  genre: 'Action',
  released: '1. Dez. 2015',
  description: 'Taktischer Shooter in zerstörbaren Räumen.',
  source: 'https://store.steampowered.com/app/359550/',
  cover: '/api/games/rainbow%20six%20siege/cover',
};
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function serverClip(id: string, title: string, hoursAgo: number): Clip {
  return {
    id,
    title,
    gameId: 'recording',
    gameName: 'Rainbow Six Siege',
    thumbnail: '',
    duration: 40,
    recordedAt: new Date(Date.now() - hoursAgo * 3600000).toISOString(),
    size: 1000000,
    resolution: '1080p',
    tags: ['Clutch'],
    favorite: false,
    status: 'ready',
    note: '',
    server: true,
  };
}

test('the library shows the game info from the server like "Your games"', async ({ page }) => {
  const clips = [serverClip('r6-neu', 'Ace auf Oregon', 1), serverClip('r6-alt', 'Clutch', 5)];
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/status')
      return route.fulfill({
        json: {
          connected: true,
          provider: 'none',
          configured: false,
          model: '',
          settings: { autoAnalyze: true, autoTitle: true, includeAudio: false },
          queue: 0,
          devices: [],
        },
      });
    if (path === '/api/clips') return route.fulfill({ json: clips });
    if (path === '/api/games') return route.fulfill({ json: [siege] });
    // pathname stays URL-encoded, like siege.cover.
    if (path === siege.cover) return route.fulfill({ body: PIXEL, contentType: 'image/png' });
    return route.fulfill({ status: 404, json: { error: 'Not part of the test.' } });
  });

  await page.goto('/');
  await expect(
    page.getByRole('region', { name: 'Your games' }).getByText(siege.name),
  ).toBeVisible();

  await page.goto('/library');
  const game = page
    .getByRole('group', { name: 'Filter by game' })
    .getByRole('button', { name: /^Tom Clancy’s Rainbow Six® Siege/ });
  await expect(game).toContainText('2 clips');
  await game.click();
  await expect(game).toHaveAttribute('aria-pressed', 'true');
  const spotlight = page.getByRole('region', { name: siege.name });
  await expect(spotlight).toContainText('Action');
  await expect(spotlight).toContainText('Released 1. Dez. 2015');
  await expect(spotlight).toContainText(siege.description);
  await expect(spotlight.getByRole('img', { name: `Cover of ${siege.name}` })).toHaveAttribute(
    'src',
    siege.cover,
  );
  await expect(spotlight.getByRole('link', { name: 'View on Steam' })).toHaveAttribute(
    'href',
    siege.source,
  );
  await expect(tiles(page)).toHaveCount(2);

  await spotlight.getByRole('button', { name: 'Play newest clip' }).click();
  await expect(page).toHaveURL(/[?&]play=r6-neu/);
  await expect(page.locator('.stream-player')).toBeVisible();
});

test('a collection shows its games and plays on in its own order', async ({ page }) => {
  await offline(page);
  await page.goto('/collections');
  const card = page.locator('.stream-collection-grid .stream-tile--collection').first();
  await expect(card).toContainText('Die besten Momente');
  await expect(card).toContainText('4 clips');
  await expect(card).toContainText('ELDEN RING');
  await card.click();

  await expect(page.getByRole('heading', { name: 'Die besten Momente', level: 1 })).toBeVisible();
  const games = page.getByRole('list', { name: 'Games in this collection' });
  await expect(games.getByRole('link')).toHaveCount(4);
  await expect(tiles(page)).toHaveCount(4);

  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page).toHaveURL(/[?&]play=elden-1/);
  await expect(
    page.getByRole('button', { name: 'Next clip: Eine Runde. Fünf Treffer.' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.stream-player')).toBeHidden();

  await games.getByRole('link', { name: /^Counter-Strike 2/ }).click();
  await expect(page).toHaveURL(/\/library\?game=cs2$/);
  await expect(tiles(page)).toHaveCount(4);
});

test('from the library, details and menu lead to the clip page', async ({ page }) => {
  await offline(page);
  await page.goto('/library');
  await page.getByRole('button', { name: 'Dieser Boss hatte andere Pläne', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/library\?clip=elden-1$/);
  await dialog.getByRole('button', { name: 'Actions for Dieser Boss hatte andere Pläne' }).click();
  await page.getByRole('menuitem', { name: 'Open clip page' }).click();
  await expect(page).toHaveURL(/\/clips\/elden-1$/);
  await expect(page.getByRole('heading', { name: 'Dieser Boss hatte andere Pläne' })).toBeVisible();
});

test('automatic collections follow the tags and can be saved', async ({ page }) => {
  await offline(page);
  await page.goto('/');
  const row = page.getByRole('region', { name: 'Sorted automatically' });
  await expect(row.locator('.stream-tile--collection')).toHaveCount(2);

  await page.goto('/collections');
  const smart = page.getByRole('region', { name: 'Sorted automatically' });
  await expect(smart).toContainText('Clutches');
  await expect(smart).toContainText('Boss fights');
  await smart.getByRole('link', { name: /Clutches/ }).click();
  await expect(page).toHaveURL(/\/collections\/auto\/clutches$/);
  await expect(page.getByRole('heading', { name: 'Clutches', level: 1 })).toBeVisible();
  await expect(tiles(page)).toHaveCount(4);

  // Without the tag the clip drops out.
  await page.getByRole('button', { name: 'Eine Runde. Fünf Treffer.', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Edit tags' }).click();
  await page.getByLabel('Tags, separated by commas').fill('Mit Freunden');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(tiles(page)).toHaveCount(3);

  await page.getByRole('button', { name: 'Save as collection' }).click();
  await expect(page).toHaveURL(/\/collections\/(?!auto\/)[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Clutches', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit collection' })).toBeVisible();
  await expect(tiles(page)).toHaveCount(3);
});

test('bulk favorite sends a few PATCHes at a time, refreshes once and stores no server clips', async ({
  page,
}) => {
  const clips = Array.from({ length: 9 }, (_, i) => serverClip(`bulk-${i}`, `Bulk ${i}`, i + 1));
  let running = 0;
  let peak = 0;
  const patched: string[] = [];
  let listed = 0;
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/status')
      return route.fulfill({
        json: {
          connected: true,
          provider: 'none',
          configured: false,
          model: '',
          settings: { autoAnalyze: true, autoTitle: true, includeAudio: false },
          queue: 0,
          devices: [],
        },
      });
    if (path === '/api/clips') {
      listed++;
      return route.fulfill({ json: clips });
    }
    if (request.method() === 'PATCH') {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 150));
      const id = decodeURIComponent(path.split('/').pop()!);
      patched.push(id);
      const clip = clips.find((c) => c.id === id)!;
      Object.assign(clip, request.postDataJSON());
      running--;
      return route.fulfill({ json: clip });
    }
    return route.fulfill({ status: 404, json: { error: 'Not part of the test.' } });
  });

  await page.goto('/library');
  await expect(tiles(page)).toHaveCount(9);
  // Previews outside the view skip rendering but keep their 16:9 size, so nothing jumps.
  const ratios = await page
    .locator('.stream-grid .stream-tile-media')
    .evaluateAll((items) => items.map((el) => el.clientWidth / el.clientHeight));
  for (const ratio of ratios) expect(ratio).toBeCloseTo(16 / 9, 1);
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByRole('button', { name: 'Select all' }).click();
  const before = listed;
  await page.getByRole('button', { name: 'Favorite selection' }).click();
  await expect.poll(() => patched.length).toBe(9);
  expect(peak).toBeLessThanOrEqual(4);
  await expect.poll(() => listed).toBeGreaterThan(before);
  // One refresh at the end (a poll may add one more), not one per clip.
  expect(listed - before).toBeLessThanOrEqual(2);
  expect(clips.every((c) => c.favorite)).toBe(true);
  const stored = await page.evaluate(() => localStorage.getItem('replayhaven.v1') || '');
  expect(stored).not.toContain('Bulk 0');
});

test('the library filters by who recorded a clip and keeps the choice in the URL', async ({
  page,
}) => {
  const timo = { id: 'user-timo', name: 'Timo' };
  const brother = { id: 'user-bruder', name: 'Bruder' };
  const clips: Clip[] = [
    { ...serverClip('von-timo', 'Ace auf Oregon', 1), uploadedBy: timo },
    { ...serverClip('vom-bruder', 'Clutch auf Villa', 2), uploadedBy: brother },
    serverClip('alt', 'Alter Clip', 30),
  ];
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/status')
      return route.fulfill({
        json: {
          connected: true,
          provider: 'none',
          configured: false,
          model: '',
          settings: { autoAnalyze: true, autoTitle: true, includeAudio: false },
          queue: 0,
          devices: [],
        },
      });
    if (path === '/api/clips') return route.fulfill({ json: clips });
    return route.fulfill({ status: 404, json: { error: 'Not part of the test.' } });
  });

  await page.goto('/library');
  await expect(tiles(page)).toHaveCount(3);
  const recordedBy = page.getByRole('combobox', { name: 'Recorded by' });
  await expect(recordedBy.locator('option')).toHaveText(['Everyone', 'Bruder', 'Timo', 'Unknown']);
  await recordedBy.selectOption({ label: 'Bruder' });
  await expect(page).toHaveURL(/[?&]by=user-bruder/);
  await expect(tiles(page)).toHaveCount(1);
  await expect(tiles(page)).toContainText('Clutch auf Villa');
  await recordedBy.selectOption({ label: 'Unknown' });
  await expect(page).toHaveURL(/[?&]by=unknown/);
  await expect(tiles(page)).toHaveCount(1);
  await expect(tiles(page)).toContainText('Alter Clip');

  // After a reload the filter still applies.
  await page.goto('/library?by=user-timo');
  await expect(tiles(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'Ace auf Oregon', exact: true }).click();
  const facts = page.getByRole('dialog').locator('.stream-facts');
  await expect(facts).toContainText('Recorded by');
  await expect(facts).toContainText('Timo');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(tiles(page)).toHaveCount(3);
});

test('the "Recorded by" filter stays hidden while one person recorded everything', async ({
  page,
}) => {
  const timo = { id: 'user-timo', name: 'Timo' };
  const clips: Clip[] = [
    { ...serverClip('a', 'Ace auf Oregon', 1), uploadedBy: timo },
    { ...serverClip('b', 'Clutch auf Villa', 2), uploadedBy: timo },
  ];
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/status')
      return route.fulfill({
        json: {
          connected: true,
          provider: 'none',
          configured: false,
          model: '',
          settings: { autoAnalyze: true, autoTitle: true, includeAudio: false },
          queue: 0,
          devices: [],
        },
      });
    if (path === '/api/clips') return route.fulfill({ json: clips });
    return route.fulfill({ status: 404, json: { error: 'Not part of the test.' } });
  });
  await page.goto('/library');
  await expect(tiles(page)).toHaveCount(2);
  await expect(page.getByRole('combobox', { name: 'Filter by tag' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Recorded by' })).toHaveCount(0);
});

/** Server that answers the clip list with `clips`; everything else is not part of the test. */
async function serveClips(page: Page, clips: Clip[]) {
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/status')
      return route.fulfill({
        json: {
          connected: true,
          provider: 'none',
          configured: false,
          model: '',
          settings: { autoAnalyze: true, autoTitle: true, includeAudio: false },
          queue: 0,
          devices: [],
        },
      });
    if (path === '/api/clips') return route.fulfill({ json: clips });
    return route.fulfill({ status: 404, json: { error: 'Not part of the test.' } });
  });
}

test('the home page filters by person, shows "New from" rows and keeps the choice in links', async ({
  page,
}) => {
  const timo = { id: 'user-timo', name: 'Timo' };
  const brother = { id: 'user-bruder', name: 'Bruder' };
  await serveClips(page, [
    { ...serverClip('von-timo', 'Ace auf Oregon', 1), uploadedBy: timo },
    { ...serverClip('vom-bruder', 'Clutch auf Villa', 2), uploadedBy: brother },
    { ...serverClip('vom-bruder-2', 'Entry auf Bank', 3), uploadedBy: brother },
    serverClip('alt', 'Alter Clip', 30),
  ]);

  await page.goto('/');
  const people = page.getByRole('group', { name: 'Recorded by' });
  await expect(people.getByRole('button')).toHaveText(['Everyone', 'Bruder', 'Timo', 'Unknown']);
  await expect(people.getByRole('button', { name: 'Everyone' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // Everyone: one row per person, the most recently active first, right after "Recently recorded".
  const titles = page.locator('.stream-row-title');
  await expect(titles.nth(0)).toHaveText('Recently recorded');
  await expect(titles.nth(1)).toHaveText('New from Timo');
  await expect(titles.nth(2)).toHaveText('New from Bruder');
  await expect(
    page.getByRole('region', { name: 'New from Bruder' }).locator('.stream-tile--clip'),
  ).toHaveCount(2);

  const bruder = people.getByRole('button', { name: 'Bruder' });
  await bruder.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/[?&]by=user-bruder/);
  await expect(bruder).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Clutch auf Villa');
  const fresh = page.getByRole('region', { name: 'Recently recorded' });
  await expect(fresh.locator('.stream-tile--clip')).toHaveCount(2);
  await expect(page.getByRole('region', { name: /^New from/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ace auf Oregon', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: 'Your games' }).getByRole('link').first(),
  ).toHaveAttribute('href', /[?&]by=user-bruder/);

  // "See all" opens the library with the same person selected.
  await fresh.getByRole('link', { name: 'See all' }).click();
  await expect(page).toHaveURL(/\/library\?by=user-bruder$/);
  await expect(page.getByRole('combobox', { name: 'Recorded by' })).toHaveValue('user-bruder');
  await expect(tiles(page)).toHaveCount(2);

  // And "Home" in the menu leads back to the same person.
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Home' })
    .click();
  await expect(page).toHaveURL(/\/\?by=user-bruder$/);
  await expect(bruder).toHaveAttribute('aria-pressed', 'true');

  await people.getByRole('button', { name: 'Everyone' }).click();
  await expect(page).not.toHaveURL(/by=/);
  await expect(page.getByRole('region', { name: 'New from Timo' })).toBeVisible();

  // On a phone the chips scroll sideways instead of widening the page.
  await page.setViewportSize({ width: 360, height: 740 });
  await expect(people).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('the home page shows no person filter while one person recorded everything', async ({
  page,
}) => {
  const timo = { id: 'user-timo', name: 'Timo' };
  await serveClips(page, [
    { ...serverClip('a', 'Ace auf Oregon', 1), uploadedBy: timo },
    { ...serverClip('b', 'Clutch auf Villa', 2), uploadedBy: timo },
  ]);
  await page.goto('/?by=user-timo');
  await expect(page.getByRole('region', { name: 'Recently recorded' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Recorded by' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: /^New from/ })).toHaveCount(0);
});
