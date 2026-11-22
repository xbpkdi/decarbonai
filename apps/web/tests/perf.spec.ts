import { expect, test } from "@playwright/test";
import { watchConsole } from "./helpers";

// Runs alone after the other projects so the frame timing is not skewed by parallel browsers.
test("live mock source: rehearsal stream, no errors, frame budget", async ({ page }) => {
  const errors = watchConsole(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?source=mock");
  await page.waitForTimeout(2500);
  await expect(page.locator(".scene-keys")).toBeVisible();
  await page.keyboard.press("b");
  // Mean frame time over 2 s while the burst runs (60 fps = 16.7 ms).
  const ms = await page.evaluate(
    () =>
      new Promise<number>((done) => {
        const t: number[] = [];
        const step = (now: number) => {
          t.push(now);
          if (now - t[0] < 2000) requestAnimationFrame(step);
          else done((t[t.length - 1] - t[0]) / (t.length - 1));
        };
        requestAnimationFrame(step);
      }),
  );
  console.log(`mean frame time on Live during a burst: ${ms.toFixed(1)} ms`);
  expect(ms).toBeLessThan(25);
  await page.goto("/?source=live");
  expect(errors).toEqual([]);
});

