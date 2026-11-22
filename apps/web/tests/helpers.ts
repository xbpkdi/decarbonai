import type { Page } from "@playwright/test";

export const OUT = process.env.SHOTS_DIR ?? "test-results/shots";

export const PAGES = [
  ["1-live", "/"],
  ["2-agent", "/agent"],
  ["3-receipts", "/receipts"],
  ["4-receipt", "/receipt/1"],
  ["5-developers", "/developers"],
  ["6-methodology", "/methodology"],
] as const;

export function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

/** Pairs of page sections/cards (neither inside the other) whose boxes intersect. */
export async function overlaps(page: Page) {
  return page.evaluate(() => {
    const els = [...document.querySelectorAll<HTMLElement>("main section, main .card, main .strip, footer .foot-band")].filter((e) => e.offsetParent !== null);
    const out: string[] = [];
    const name = (e: HTMLElement) => `${e.tagName.toLowerCase()}.${[...e.classList].join(".")}${e.id ? `#${e.id}` : ""}`;
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        const a = els[i], b = els[j];
        if (a.contains(b) || b.contains(a)) continue;
        const r = a.getBoundingClientRect(), s = b.getBoundingClientRect();
        const w = Math.min(r.right, s.right) - Math.max(r.left, s.left);
        const h = Math.min(r.bottom, s.bottom) - Math.max(r.top, s.top);
        if (w > 1 && h > 1) out.push(`${name(a)} × ${name(b)}`);
      }
    }
    return out;
  });
}

