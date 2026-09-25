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
