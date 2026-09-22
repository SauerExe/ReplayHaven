import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('artifacts/visual', { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
  ...(process.env.HTTPS_PROXY
    ? { proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } }
    : {}),
});
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173');
await page.locator('.hero-art').waitFor();
await page.evaluate(() => document.fonts.ready);
const report = { viewports: [], pages: [], errors };
for (const width of [390, 768, 1440, 1920]) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : width === 768 ? 1024 : 1080 });
  await page.screenshot({ path: `artifacts/visual/home-${width}.png`, fullPage: true });
  report.viewports.push({
    width,
    scrollWidth: await page.evaluate(() => document.documentElement.scrollWidth),
    images: await page
      .locator('img')
      .evaluateAll((imgs) =>
        imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src),
      ),
  });
}
for (const width of [390, 768, 1440, 1920]) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  for (const route of [
    '/library',
    '/collections',
    '/collections/clutches',
    '/devices',
    '/settings',
    '/clips/elden-1',
  ]) {
    await page.goto(`http://localhost:5173${route}`);
    await page.locator('h1').waitFor();
    await page.screenshot({
      path: `artifacts/visual/${route.replaceAll('/', '-')}-${width}.png`,
      fullPage: true,
    });
    report.pages.push({
      route,
      width,
      title: await page.locator('h1').innerText(),
      overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    });
  }
}
try {
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2, {
    timeout: 30000,
  });
  await page.locator('video').evaluate((v) => v.play());
  await page.waitForFunction(() => document.querySelector('video')?.currentTime > 3, {
    timeout: 20000,
  });
  await page.locator('video').evaluate((v) => v.pause());
  report.video = await page.locator('video').evaluate((v) => ({
    duration: v.duration,
    currentTime: v.currentTime,
    readyState: v.readyState,
    width: v.videoWidth,
    height: v.videoHeight,
  }));
} catch (e) {
  report.video = {
    error: e.message,
    ui: await page
      .locator('.player-error')
      .textContent()
      .catch(() => null),
  };
}
await writeFile('artifacts/visual/browser-report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
