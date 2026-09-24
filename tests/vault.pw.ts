import { test, expect, type Page } from '@playwright/test';
/** Clip-Kacheln im Raster von Bibliothek und Sammlung. */
const tiles = (page: Page) => page.locator('.stream-grid .stream-tile--clip');
test('Fehlende Medien, Verarbeitungszustand und leere Bibliothek sind bedienbar', async ({
  page,
}) => {
  await page.goto('/library');
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('replayhaven.v1')!);
    state.clips[0].videoSource = undefined;
    state.clips[0].thumbnail = '/missing-artwork.webp';
    state.clips[1].status = 'processing';
    localStorage.setItem('replayhaven.v1', JSON.stringify(state));
  });
  await page.goto('/clips/elden-1');
  await expect(page.getByRole('heading', { name: 'Keine Videodatei vorhanden' })).toBeVisible();
  await page.goto('/clips/elden-2');
  await expect(page.getByRole('heading', { name: 'Clip wird verarbeitet' })).toBeVisible();
  await page.goto('/library?status=processing');
  await expect(tiles(page)).toHaveCount(1);
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('replayhaven.v1')!);
    state.clips = [];
    state.collections = [];
    localStorage.setItem('replayhaven.v1', JSON.stringify(state));
  });
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Noch keine Clips' })).toBeVisible();
  await page.getByRole('button', { name: 'Clip hinzufügen', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});
test('Suche, Filter und Favoriten bleiben konsistent und gespeichert', async ({ page }) => {
  await page.goto('/library');
  await page.getByRole('textbox', { name: 'Bibliothek durchsuchen' }).fill('Clutch');
  await page
    .getByRole('group', { name: 'Nach Spiel filtern' })
    .getByRole('button', { name: /^Counter-Strike 2/ })
    .click();
  await expect(tiles(page)).toHaveCount(4);
  await page.getByRole('button', { name: 'Favoriten', exact: true }).click();
  await expect(tiles(page)).toHaveCount(1);
  await tiles(page)
    .first()
    .getByRole('button', { name: /aus Favoriten entfernen/ })
    .click();
  await expect(page.getByRole('heading', { name: 'Keine Treffer' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Keine Treffer' })).toBeVisible();
  await page.getByRole('button', { name: 'Filter zurücksetzen', exact: true }).click();
  await expect(tiles(page)).toHaveCount(20);
});
test('Sammlung erstellen, befüllen, umbenennen und nach Neuladen öffnen', async ({ page }) => {
  await page.goto('/collections');
  await page.getByRole('button', { name: 'Neue Sammlung', exact: true }).click();
  await page.getByLabel('Titel', { exact: true }).fill('Unsere beste Runde');
  await page.getByRole('button', { name: 'Sammlung erstellen', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Unsere beste Runde' })).toBeVisible();
  await page.getByRole('button', { name: 'Clips hinzufügen', exact: true }).first().click();
  await page.getByRole('checkbox', { name: 'Dieser Boss hatte andere Pläne', exact: true }).check();
  await page.getByRole('button', { name: 'Hinzufügen', exact: true }).click();
  await expect(tiles(page)).toHaveCount(1);
  await page.reload();
  await expect(tiles(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'Aktionen für Dieser Boss hatte andere Pläne' }).click();
  await page.getByRole('menuitem', { name: 'Umbenennen' }).click();
  await page.getByLabel('Titel', { exact: true }).fill('Unser Highlight');
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await page.reload();
  await expect(tiles(page).locator('.stream-tile-title')).toHaveText('Unser Highlight');
  await page.getByRole('button', { name: 'Aus Sammlung entfernen' }).click();
  await expect(tiles(page)).toHaveCount(0);
  await page.goto('/library?q=Unser%20Highlight');
  await expect(tiles(page)).toHaveCount(1);
});
test('Mehrfachauswahl löscht erst nach Bestätigung', async ({ page }) => {
  await page.goto('/library?game=cs2');
  await page.getByRole('button', { name: 'Auswählen', exact: true }).click();
  await page.getByRole('button', { name: 'Alle auswählen', exact: true }).click();
  await page.getByRole('button', { name: 'Auswahl löschen' }).click();
  await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(tiles(page)).toHaveCount(4);
  await page.getByRole('button', { name: 'Auswahl löschen' }).click();
  await page.getByRole('button', { name: 'Endgültig löschen' }).click();
  await expect(tiles(page)).toHaveCount(0);
  await page.reload();
  await expect(tiles(page)).toHaveCount(0);
});
test('Echtes externes Video spielt und setzt tatsächlichen Fortschritt fort', async ({ page }) => {
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
  await expect(page.getByRole('button', { name: 'Fortsetzen', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Fortsetzen', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate((v) => v.currentTime)).toBeGreaterThan(8);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Weiterschauen', exact: true })).toBeVisible();
});
test('Lokale Datei, Formatfehler und ehrliche Freigabevorschau', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Clip hochladen', exact: true }).click();
  await page.getByLabel('Videodateien auswählen').setInputFiles({
    name: 'invalid.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('not a video'),
  });
  await expect(page.getByText(/Dieses Format wird nicht unterstützt/)).toBeVisible();
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
    .getByLabel('Videodateien auswählen')
    .setInputFiles({ name: 'local-test.webm', mimeType: 'video/webm', buffer: Buffer.from(bytes) });
  await expect(page.getByText('Lokale Vorschau bereit')).toBeVisible({ timeout: 20000 });
  await page.getByRole('link', { name: 'local-test.webm abspielen' }).click();
  await expect(page.getByRole('heading', { name: 'local-test', exact: true })).toBeVisible();
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    return video && video.readyState >= 2;
  });
  await page.locator('video').evaluate((v) => v.play());
  await expect.poll(() => page.locator('video').evaluate((v) => v.currentTime)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Clip teilen', exact: true }).click();
  await expect(page.getByText(/Öffentliches Teilen ist noch nicht verfügbar/)).toBeVisible();
  await page.getByRole('link', { name: 'Vorschau', exact: true }).click();
  await expect(page.locator('.share-page')).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Freigabe nicht verfügbar' })).toBeVisible();
});
test('Mobile Menüs, Filter, Fokus und Fehlerseiten', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Mobile Navigation' })
    .getByRole('link', { name: 'Bibliothek' })
    .click();
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await expect(page.getByLabel('Status filtern')).toBeVisible();
  await page
    .getByRole('group', { name: 'Nach Spiel filtern' })
    .getByRole('button', { name: /^ELDEN RING/ })
    .click();
  await expect(tiles(page)).toHaveCount(4);
  await page
    .getByRole('navigation', { name: 'Mobile Navigation' })
    .getByRole('button', { name: 'Profilmenü' })
    .click();
  await page.getByRole('menuitem', { name: 'Einstellungen' }).click();
  await expect(page.getByRole('heading', { name: 'Einstellungen', exact: true })).toBeVisible();
  await page.getByRole('switch', { name: 'Bewegung reduzieren' }).click();
  await page.reload();
  await expect(page.getByRole('switch', { name: 'Bewegung reduzieren' })).toBeChecked();
  await page.getByRole('button', { name: 'Clip hochladen', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/clips/unknown');
  await expect(page.getByRole('heading', { name: 'Clip nicht gefunden' })).toBeVisible();
  await page.goto('/unknown');
  await expect(page.getByRole('heading', { name: 'Hier ist kein Clip gelandet.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
