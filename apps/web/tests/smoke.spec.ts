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

// Copy audit: an unbacked pool writes no ERC-8004 feedback, for any agent id.
for (const id of [1, 360]) {
  test(`agent ${id} claims no reputation from the mock lot`, async ({ page }) => {
    await page.goto(`/agent/${id}`);
    await expect(page.locator("#settled")).toHaveText("No feedback yet");
    await expect(page.locator("#repN")).toHaveText("0");
  });
}

// Copy audit: samples never present localhost or a third party's agent as ours.
test("developer samples use placeholders when nothing is hosted", async ({ page }) => {
  test.skip(Boolean(process.env.NEXT_PUBLIC_DEMO_API_URL || process.env.NEXT_PUBLIC_DEMO_AGENT_ID), "hosted demo configured");
  await page.goto("/developers");
  const samples = page.locator("#code, #mcpCode");
  for (const tab of ["server", "agent"]) {
    await page.locator(`[data-code="${tab}"]`).click();
    for (const text of await samples.allTextContents()) expect(text).not.toMatch(/localhost|\b42\b/);
  }
  for (const tab of ["code", "desktop", "cursor"]) {
    await page.locator(`[data-mcp="${tab}"]`).click();
    await expect(page.locator("#mcpCode")).toContainText("<your-paid-api-url>");
    await expect(page.locator("#mcpCode")).not.toContainText("localhost");
  }
});

test("demo payments refuse without full settings", async ({ request }) => {
  test.skip(Boolean(process.env.DEMO_AGENT_PRIVATE_KEY), "demo configured");
  expect((await request.post("/api/demo/pay")).status()).toBe(503);
});

// Copy audit: a v1 certificate link never opens a v2 receipt.
for (const id of ["demo", "1", "0f8fad5b-d9cb-469f-a165-70867728950e"]) {
  test(`old certificate ${id} explains itself`, async ({ page }) => {
    const res = await page.goto(`/certificate/${id}`);
    expect(res?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe(`/certificate/${id}`);
    await expect(page.locator("h1")).toHaveText("Not carried over.");
  });
}

// Simulated hashes must not look verifiable.
test("mock receipt is not presented as verified", async ({ page }) => {
  await page.goto("/receipt/1?source=mock");
  await expect(page.locator("#checks li").last()).toHaveAttribute("data-s", "warn", { timeout: 15_000 });
  await expect(page.locator(".verified")).toContainText("Simulated checks.");
  await expect(page.locator('#info a[href*="/tx/"], #checks a[href*="/tx/"]')).toHaveCount(0);
});
