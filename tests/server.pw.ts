import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import type { Clip } from '../src/domain/models';
test('Sammlungen funktionieren auch ohne die nur über HTTPS verfügbare randomUUID-Methode', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window.crypto, 'randomUUID', { value: undefined, configurable: true }),
  );
  await page.goto('/collections');
  await page.getByRole('button', { name: 'Neue Sammlung', exact: true }).click();
  await page.getByLabel('Titel', { exact: true }).fill('Heimnetz-Sammlung');
  await page.getByRole('button', { name: 'Sammlung erstellen', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Heimnetz-Sammlung', exact: true })).toBeVisible();
});
test('Client-Ergebnis erscheint, bleibt bearbeitbar und wird nach erkanntem Spiel gefiltert', async ({
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
    return route.fulfill({ status: 404, json: { error: 'Test-Endpunkt fehlt' } });
  });
  await page.goto(`/clips/${clip.id}`);
  await expect(page.getByRole('heading', { name: 'Dein Moment, zusammengefasst' })).toBeVisible();
  await expect(page.getByText('Bildstichprobe, ohne Ton', { exact: false })).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Lokal auf deinem Aufnahme-PC analysiert/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Titel übernehmen', exact: true }).click();
  await expect(page.locator('h1')).toHaveText('Erkannter Testmoment');
  await page.getByRole('button', { name: 'Beschreibung bearbeiten', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Beschreibung bearbeiten' })
    .fill('Meine korrigierte Beschreibung');
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect.poll(() => clip.description).toBe('Meine korrigierte Beschreibung');
  await page.goto('/library?game=name%3ATestspiel');
  await expect(page.locator('.stream-grid .stream-tile--clip')).toHaveCount(1);
  await expect(
    page
      .getByRole('group', { name: 'Nach Spiel filtern' })
      .getByRole('button', { name: /^Testspiel/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/devices');
  await expect(page.getByRole('link', { name: 'Windows-Client herunterladen' })).toHaveAttribute(
    'href',
    '/api/downloads/windows',
  );
  await page.goto(`/clips/${clip.id}`);
  await expect(page.getByRole('heading', { name: 'Dein Moment, zusammengefasst' })).toBeVisible();
  await mkdir('artifacts/visual', { recursive: true });
  await page.screenshot({ path: 'artifacts/visual/client-analysis-web.png', fullPage: true });
  expect(errors).toEqual([]);
});
