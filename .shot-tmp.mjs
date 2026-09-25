import { chromium } from 'playwright';
const out = process.argv[2];
const which = process.argv[3] || 'both';
const browser = await chromium.launch();
const runs = [['d', { width: 1440, height: 900 }, 'en-US'], ['m', { width: 390, height: 844 }, 'de-DE']].filter(r => which === 'both' || r[0] === which);
for (const [name, vp, lang] of runs) {
  const ctx = await browser.newContext({ viewport: vp, locale: lang });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(name + ' ERR ' + e.message));
  await page.goto('http://localhost:4317/');
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${out}/${name}-top.png` });
  const n = await page.locator('main > section, footer').count();
  for (let i = 0; i < n; i++) {
    const el = page.locator('main > section, footer').nth(i);
    const box = await el.boundingBox(); const top = await page.evaluate(() => window.scrollY) + box.y;
    for (let y = top - 200; y < top + box.height; y += 300) { await page.evaluate((yy) => window.scrollTo(0, yy), y); await page.waitForTimeout(120); }
    await page.evaluate((yy) => window.scrollTo(0, yy), top - 100);
    await page.waitForTimeout(2600);
    await el.screenshot({ path: `${out}/${name}${i}.png` });
  }
  const wide = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > window.innerWidth + 1 && !e.closest('.tabs') && !e.closest('.shot-crop')).slice(0, 8).map(e => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().right)));
  console.log(name, 'overflow:', JSON.stringify(wide));
  await ctx.close();
}
await browser.close();
