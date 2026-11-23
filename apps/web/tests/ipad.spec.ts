import { expect, test } from "@playwright/test";
import { OUT, overlaps, PAGES, watchConsole } from "./helpers";

// Runs in the "ipad-webkit" project (Safari engine, touch).
const IPADS = [
  ["laptop-1440x900", 1440, 900],
  ["ipad-1180x820", 1180, 820],
  ["ipad-1366x1024", 1366, 1024],
  ["ipad-portrait-820x1180", 820, 1180],
] as const;

test.describe("iPad (WebKit)", () => {
  for (const [vp, width, height] of IPADS) {
    for (const [name, path] of PAGES) {
      test(`${name} ${vp}`, async ({ page }) => {
        const errors = watchConsole(page);
        await page.setViewportSize({ width, height });
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(2500);
        await page.evaluate(async () => {
          for (let y = 0; y < document.body.scrollHeight; y += 500) {
            window.scrollTo(0, y);
            await new Promise((r) => setTimeout(r, 100));
          }
          window.scrollTo(0, 0);
        });
        await page.waitForTimeout(1000);
        expect(await overlaps(page)).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
        // Code panels scroll inside themselves instead of being clipped by their card.
        for (const pre of await page.locator("pre.code").all()) {
          const clipped = await pre.evaluate((el) => el.getBoundingClientRect().right > (el.closest(".card") as HTMLElement).getBoundingClientRect().right + 1);
          expect(clipped).toBe(false);
        }
        await page.screenshot({ path: `${OUT}/ipad/${vp}-${name}.png`, fullPage: true });
        expect(errors).toEqual([]);
      });
    }
  }
});
