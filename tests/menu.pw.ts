import { test, expect } from '@playwright/test';

for (const width of [1440, 390])
  test(`profile menu moves neither header nor content at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const trigger = page.locator('.profile-button:visible, .mobile-more:visible');
    const measure = () =>
      page.evaluate(() => ({
        header: document.querySelector('.header-inner')!.getBoundingClientRect().toJSON(),
        hero: document.querySelector('.stream-hero-content')!.getBoundingClientRect().toJSON(),
        viewport: document.documentElement.clientWidth,
        scroll: window.scrollY,
      }));
    await expect(page.locator('.stream-hero-content')).toBeVisible();
    const before = await measure();
    await trigger.click();
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(page.locator('body')).not.toHaveAttribute('data-scroll-locked');
    const opened = await measure();
    for (const item of ['header', 'hero'] as const) {
      expect(opened[item].x).toBeCloseTo(before[item].x, 1);
      expect(opened[item].width).toBeCloseTo(before[item].width, 1);
    }
    expect(opened.viewport).toBe(before.viewport);
    expect(opened.scroll).toBe(before.scroll);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect((await measure()).header.x).toBeCloseTo(before.header.x, 1);
  });
