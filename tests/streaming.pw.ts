import { expect, test, type Page } from '@playwright/test';

const PREVIEW = '/streaming-preview.html';
const MARKER = /^\d+:\d{2}, /;

// Die Vorschau läuft ohne Server: Aufrufe an /api und fremde Hosts dürfen scheitern, alles andere nicht.
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

test('Startseite zeigt Hero und Reihen in fester Reihenfolge', async ({ page }) => {
  await page.goto(PREVIEW);
  const hero = page.getByRole('region', { name: 'Ace auf Inferno' });
  await expect(hero.getByRole('heading', { level: 1, name: 'Ace auf Inferno' })).toBeVisible();
  await expect(hero.getByText('KI-Titel · Sicherheit hoch')).toBeVisible();
  await expect(page.locator('.stream-row-title')).toHaveText([
    'Weiterschauen',
    'Neu hinzugefügt',
    'Favoriten',
    'Counter-Strike 2',
    'Apex Legends',
    'Elden Ring',
    'Deine Spiele',
    'Deine Sammlungen',
  ]);
  await expect(
    page
      .getByRole('region', { name: 'Weiterschauen' })
      .locator('.stream-tile-meta', { hasText: 'noch 0:41' }),
  ).toBeVisible();
  const fresh = page.getByRole('region', { name: 'Neu hinzugefügt' });
  await expect(fresh.locator('.stream-badge', { hasText: 'Neu' }).first()).toBeVisible();
  await expect(fresh.locator('.stream-tile-analyzing')).toHaveText('KI analysiert den Clip …');
});

test('Kachel öffnet den Detaildialog, Escape schließt ihn', async ({ page }) => {
  await page.goto(PREVIEW);
  await page
    .getByRole('region', { name: 'Neu hinzugefügt' })
    .getByRole('button', { name: 'Triple Kill auf Mirage', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Triple Kill auf Mirage' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Abspielen', exact: true })).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Favorit' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(dialog.getByText('Gemini (Google)')).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Mehr aus Counter-Strike 2' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('Abspielen öffnet den Player mit einem Marker je Zeitmarke, Escape schließt ihn', async ({
  page,
}) => {
  await page.goto(PREVIEW);
  await page
    .getByRole('region', { name: 'Ace auf Inferno' })
    .getByRole('button', { name: 'Details' })
    .click();
  const detail = page.locator('.stream-detail');
  await expect(detail.locator('.stream-mark')).toHaveCount(5);
  await detail.getByRole('button', { name: 'Abspielen', exact: true }).click();

  const player = page.locator('.stream-player');
  await expect(player).toBeVisible();
  const markers = player.getByRole('button', { name: MARKER });
  await expect(markers).toHaveCount(5);
  await expect(markers.first()).toHaveAccessibleName('0:12, Erster Kill');
  await markers.nth(2).hover();
  await expect(player.locator('.stream-marker-tip', { hasText: 'Triple Kill' })).toBeVisible();
  await expect(player.getByRole('button', { name: /^Zum nächsten Highlight/ })).toBeAttached();
  // Ohne Videodatei bleibt die Steuerung da und sagt, warum nichts läuft.
  await expect(player.getByRole('alert')).toContainText('Keine Videodatei vorhanden');
  await expect(player.getByText('0:00 / 0:54')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(player).toBeHidden();
  await expect(detail).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(detail).toBeHidden();
});

test('Ein Video, das nicht lädt, meldet sich auf Deutsch', async ({ page }) => {
  await page.route(
    (url) => url.pathname === '/kaputt.mp4',
    (route) => route.fulfill({ status: 200, contentType: 'video/mp4', body: 'kein Video' }),
  );
  await page.goto(`${PREVIEW}?video=/kaputt.mp4`);
  await page
    .getByRole('region', { name: 'Ace auf Inferno' })
    .getByRole('button', { name: 'Abspielen', exact: true })
    .click();
  const alert = page.locator('.stream-player').getByRole('alert');
  await expect(alert).toContainText('Das Video lässt sich nicht laden');
  await expect(alert.getByRole('button', { name: 'Erneut versuchen' })).toBeVisible();
});

test('Kacheln sind per Tastatur erreichbar', async ({ page }) => {
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
  // Die Abspiel-Schaltflächen der Kacheln liegen nicht in der Tab-Reihenfolge.
  await page.keyboard.press('Tab');
  const nextTile = page
    .getByRole('region', { name: 'Weiterschauen' })
    .locator('.stream-tile')
    .nth(1);
  const next = nextTile.getByRole('button', { name: 'Plan B: einfach weiterfahren', exact: true });
  await expect(next).toBeFocused();
  // Fokus vergrößert die Kachel wie Hover: gemessene Breite gegenüber der Layoutbreite.
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

test('Bei 390 × 844 läuft die Seite nicht seitlich über', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(PREVIEW);
  await expect(page.locator('.stream-hero')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('Im App-Rahmen hängen Details und Player an der Adresse, Zurück schließt sie', async ({
  page,
}) => {
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 503, json: { error: 'Kein Server in der Vorschau.' } }),
  );
  // Die Beispiel-Clips verweisen auf Trailer im Netz; der Test bleibt lokal.
  await page.route(
    (url) => url.hostname !== 'localhost',
    (route) => route.fulfill({ status: 404, body: '' }),
  );
  await page.goto(`${PREVIEW}?modus=app`);
  await expect(page.locator('.stream-hero')).toBeVisible();
  await page
    .getByRole('region', { name: 'Neu hinzugefügt' })
    .locator('.stream-tile-open')
    .first()
    .click();
  const detail = page.locator('.stream-detail');
  await expect(detail).toBeVisible();
  await expect(page).toHaveURL(/[?&]clip=/);

  await detail.getByRole('button', { name: 'Abspielen', exact: true }).click();
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
