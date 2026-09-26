import { _electron as electron, expect } from '@playwright/test';
import { mkdir, access } from 'node:fs/promises';
import { resolve } from 'node:path';
const candidates = [
  'release/win-unpacked/ReplayHaven Client.exe',
  'release/win-unpacked.tmp/electron.exe',
  'node_modules/electron/dist/electron.exe',
];
let executablePath;
for (const path of candidates) {
  try {
    await access(path);
    executablePath = resolve(path);
    break;
  } catch {
    /* Try the next installed binary. */
  }
}
if (!executablePath) throw new Error('No Electron binary found for the local client test.');
const env = { ...process.env, REPLAYHAVEN_SMOKE: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const packaged = executablePath.includes('ReplayHaven Client.exe');
const app = await electron.launch({
  executablePath,
  args: packaged ? [] : [resolve('desktop-bundle')],
  env,
  timeout: 30000,
});
try {
  const page = await app.firstWindow();
  // A fresh profile opens the setup wizard over the overview.
  await page.waitForSelector('#wizard:not([hidden])');
  await expect(page.locator('#wizard-title')).not.toBeEmpty();
  await expect(page.locator('#wizard-next')).toBeEnabled();
  const state = await page.evaluate(() => window.vault.call('load'));
  if (!state.ok) throw new Error(state.error);
  expect(state.value.config.onboarded).toBe(false);
  await expect(page.locator('#primary-action')).toBeAttached();
  expect(await page.evaluate(() => typeof window.require)).toBe('undefined');
  expect(state.value.config.token).toBe('');
  // ONNX Runtime and the text recognition models load in the packaged client.
  expect(state.value.texts).toBe('ready');
  if (!state.value.config.folder) {
    const start = await page.evaluate(() => window.vault.call('start'));
    expect(start.ok).toBe(false);
    expect(start.error).toMatch(/recording folder/i);
  }
  const content = await page.content();
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ headless: true });
  try {
    const preview = await browser.newPage({
      viewport: { width: 1040, height: 850 },
      bypassCSP: true,
    });
    await preview.setContent(content.replace(/<script[\s\S]*?<\/script>/g, ''));
    const { readFile } = await import('node:fs/promises');
    await preview.addStyleTag({ content: await readFile('desktop/renderer/style.css', 'utf8') });
    await mkdir('artifacts/visual', { recursive: true });
    await preview.screenshot({ path: 'artifacts/visual/windows-client.png', fullPage: true });
  } finally {
    await browser.close();
  }
  console.log(
    JSON.stringify({
      title: await page.title(),
      folderPicker: await page.locator('#pick-folder').isVisible(),
      localModel: await page.locator('.model strong').textContent(),
      paused: state.value.status.paused,
      nodeIntegration: await page.evaluate(() => typeof window.require),
      savedTokenExposed: !!state.value.config.token,
      texts: state.value.texts,
    }),
  );
} finally {
  await app.evaluate(({ app }) => app.exit(0));
}
