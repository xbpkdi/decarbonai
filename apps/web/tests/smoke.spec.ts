import { expect, test, type Page } from "@playwright/test";

const OUT = process.env.SHOTS_DIR ?? "test-results/shots";

const PAGES = [
  ["1-live", "/"],
  ["2-agent", "/agent"],
  ["3-receipts", "/receipts"],
  ["4-receipt", "/receipt/1"],
  ["5-developers", "/developers"],
  ["6-methodology", "/methodology"],
] as const;

function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

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
