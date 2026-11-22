import { expect, test } from "@playwright/test";
import { OUT, overlaps, PAGES, revealAll, watchConsole } from "./helpers";

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

// Regression (QA B1/B3): laptop 1440x900 in Chromium, every page, no overlaps or clipped code.
for (const [name, path] of PAGES) {
  test(`${name} 1440x900`, async ({ page }) => {
    const errors = watchConsole(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2500);
    await revealAll(page);
    expect(await overlaps(page)).toEqual([]);
    for (const el of await page.locator("pre.code, .install code").all()) {
      const clipped = await el.evaluate((n) => n.getBoundingClientRect().right > (n.closest(".card") as HTMLElement).getBoundingClientRect().right + 1);
      expect(clipped).toBe(false);
    }
    await page.screenshot({ path: `${OUT}/laptop/${name}-1440x900.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
}

// Regression (QA M5): an anchor jump lands its heading below the sticky nav + tape.
test("anchor heading clears nav and tape", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/developers#mcp");
  await page.waitForTimeout(2000);
  await page.evaluate(() => document.getElementById("mcp")?.scrollIntoView());
  await page.waitForTimeout(500);
  const [heading, tape] = await Promise.all([
    page.locator("#h-mcp").evaluate((e) => e.getBoundingClientRect().top),
    page.locator(".tape").evaluate((e) => e.getBoundingClientRect().bottom),
  ]);
  expect(heading).toBeGreaterThanOrEqual(tape);
});

// Regression (QA M1): the simulated stream is labelled and one click from live data.
test("mock mode is visibly simulated", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?source=mock");
  await page.waitForTimeout(2000);
  await expect(page.locator(".hero .pill-sim")).toHaveText("SIMULATED");
  await expect(page.locator("[data-block]").first()).toHaveText("");
  await page.locator(".sim-banner a").click();
  await page.waitForTimeout(2000);
  await expect(page.locator(".sim-banner")).toHaveCount(0);
  await expect(page.locator(".hero .pill").first()).not.toHaveText("SIMULATED");
});
