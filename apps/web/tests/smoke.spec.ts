import { expect, test } from "@playwright/test";
import { OUT, overlaps, PAGES, watchConsole } from "./helpers";

for (const [name, path] of PAGES) {
  test(`${name} desktop`, async ({ page }) => {
    const errors = watchConsole(page);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3500);
    // Walk the page so scroll reveals and counters run before the full-page capture.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 500) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 120));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(1200);
    await expect(page.locator("header.nav")).toBeVisible();
    expect(await overlaps(page)).toEqual([]);
    if (name === "1-live") {
      // The stage fits one 1920x1080 screen.
      const bottom = await page.locator(".stage").evaluate((el) => el.getBoundingClientRect().bottom);
      expect(bottom).toBeLessThanOrEqual(1080);
      await page.screenshot({ path: `${OUT}/${name}-1920.png` });
    } else {
      await page.screenshot({ path: `${OUT}/${name}-1920.png`, fullPage: true });
    }
    expect(errors).toEqual([]);
  });
}

for (const [name, path] of [PAGES[0], PAGES[3]]) {
  test(`${name} phone`, async ({ page }) => {
    const errors = watchConsole(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${OUT}/${name}-phone-390.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
}
