import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import type { Clip } from '../src/domain/models';
test('collections work without randomUUID, which is only available over HTTPS', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window.crypto, 'randomUUID', { value: undefined, configurable: true }),
  );
  await page.goto('/collections');
  await page.getByRole('button', { name: 'New collection', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Heimnetz-Sammlung');
  await page.getByRole('button', { name: 'Create collection', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Heimnetz-Sammlung', exact: true })).toBeVisible();
});
test('a client result appears, stays editable and is filtered by the detected game', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let clip: Clip = {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Testaufnahme',
    gameId: 'recording',
    gameName: 'Testspiel',
    thumbnail: '/media/elden-ring-1.webp',
    duration: 120,
    recordedAt: new Date().toISOString(),
    size: 1000000,
    resolution: '1080p',
    tags: ['Test'],
    favorite: false,
    status: 'ready',
    note: '',
    server: true,
    originalName: 'NVIDIA.mp4',
    analysis: {
      status: 'ready',
      provider: 'client',
      model: 'test-fixture',
      input: 'frames',
      result: {
        title: 'Erkannter Testmoment',
        description: 'Diese Beschreibung ist eine Testantwort zur Prüfung der Oberfläche.',
        game: 'Testspiel',
        tags: ['Test'],
        confidence: 'medium',
        uncertainty: 'Testdaten, keine reale Gameplay-Analyse.',
        highlights: [{ seconds: 40, title: 'Teststelle', description: 'Zeitmarke aus Testdaten.' }],
      },
    },
  };
  await page.route('**/api/**', async (route) => {
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
          clientDownloadAvailable: true,
        },
      });
    if (path === '/api/clips') return route.fulfill({ json: [clip] });
    if (path === `/api/clips/${clip.id}` && route.request().method() === 'PATCH') {
      clip = { ...clip, ...route.request().postDataJSON() };
      return route.fulfill({ json: clip });
    }
    return route.fulfill({ status: 404, json: { error: 'Test endpoint missing' } });
  });
  await page.goto(`/clips/${clip.id}`);
  await expect(page.getByRole('heading', { name: 'Your moment, summarized' })).toBeVisible();
  await expect(page.getByText('frame sample, no audio', { exact: false })).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Analyzed locally on your recording PC/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Use title', exact: true }).click();
  await expect(page.locator('h1')).toHaveText('Erkannter Testmoment');
  await page.getByRole('button', { name: 'Edit description', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Edit description' })
    .fill('Meine korrigierte Beschreibung');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => clip.description).toBe('Meine korrigierte Beschreibung');
  await page.goto('/library?game=name%3ATestspiel');
  await expect(page.locator('.stream-grid .stream-tile--clip')).toHaveCount(1);
  await expect(
    page.getByRole('group', { name: 'Filter by game' }).getByRole('button', { name: /^Testspiel/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/devices');
  await expect(page.getByRole('link', { name: 'Download Windows client' })).toHaveAttribute(
    'href',
    '/api/downloads/windows',
  );
  await page.goto(`/clips/${clip.id}`);
  await expect(page.getByRole('heading', { name: 'Your moment, summarized' })).toBeVisible();
  await mkdir('artifacts/visual', { recursive: true });
  await page.screenshot({ path: 'artifacts/visual/client-analysis-web.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('a plain account only watches, and an SSO-only account sets its first password', async ({
  page,
}) => {
  const clip: Clip = {
    id: '22222222-2222-4222-8222-222222222222',
    title: 'Watch only',
    gameId: 'recording',
    gameName: 'Testspiel',
    thumbnail: '/media/elden-ring-1.webp',
    duration: 60,
    recordedAt: new Date().toISOString(),
    size: 1000000,
    resolution: '1080p',
    tags: ['Test'],
    favorite: false,
    status: 'ready',
    note: '',
    server: true,
  };
  const writes: string[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') writes.push(`${request.method()} ${path}`);
    if (path === '/api/auth/state')
      return route.fulfill({
        json: {
          accounts: true,
          setupRequired: false,
          setupNeedsKey: false,
          loggedIn: true,
          kind: 'browser',
          role: 'user',
          user: { id: 'u1', name: 'Viewer', role: 'user', hasPassword: false, oidcLinked: false },
          passwordLogin: true,
          oidc: { enabled: true, name: 'Authentik' },
        },
      });
    if (path === '/api/status')
      return route.fulfill({
        json: {
          connected: true,
          provider: 'local',
          configured: true,
          model: 'test',
          settings: { autoAnalyze: true, autoTitle: true, includeAudio: false },
          queue: 0,
          devices: [],
          playback: { mode: 'web', pending: 3, done: 1 },
        },
      });
    if (path === '/api/clips') return route.fulfill({ json: [clip] });
    if (path === '/api/auth/password') return route.fulfill({ json: { changed: true } });
    return route.fulfill({ json: [] });
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Watch only' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload clip' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Favorite' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Details', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Favorite' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Add tag' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Actions for Watch only' }).click();
  await expect(page.getByRole('menuitem', { name: 'Rename' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  await page.goto('/settings#analysis');
  await expect(page.getByRole('switch', { name: 'Apply AI titles automatically' })).toBeDisabled();
  await expect(page.getByText('Preparing smooth playback: 3 clips left')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Link Authentik' })).toHaveAttribute(
    'href',
    '/api/auth/oidc/start?link=1',
  );
  await page.getByRole('button', { name: 'Set password' }).click();
  await expect(page.getByLabel('Current password')).toHaveCount(0);
  await page.getByLabel('New password').fill('a-new-password');
  await page.locator('.password-form').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Password set')).toBeVisible();
  // Watching must never have sent a change the server would refuse with 403.
  expect(writes).toEqual(['POST /api/auth/password']);
});
