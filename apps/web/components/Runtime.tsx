"use client";

import { useEffect } from "react";
import { runtimeNet, useNet } from "@/components/Net";
import { AGENT_NAMES, DEMO_AGENT_ID } from "@/lib/config";
import type { Snapshot } from "@/lib/types";

export type PageKey = "index" | "agent" | "receipts" | "receipt" | "developers" | "methodology";

const PAGES = {
  index: () => import("@/lib/dc/pages/live.js"),
  agent: () => import("@/lib/dc/pages/agent.js"),
  receipts: () => import("@/lib/dc/pages/receipts.js"),
  receipt: () => import("@/lib/dc/pages/receipt.js"),
  developers: () => import("@/lib/dc/pages/developers.js"),
  methodology: () => import("@/lib/dc/pages/methodology.js"),
} satisfies Record<PageKey, () => Promise<{ default: (dc: unknown) => void }>>;

/** ?source=mock switches to the simulated stream (rehearsal); it sticks for the tab until ?source=live. */
function pickSource(): "live" | "mock" {
  const q = new URLSearchParams(location.search).get("source");
  try {
    if (q === "mock" || q === "live") sessionStorage.setItem("dc-source", q);
    return sessionStorage.getItem("dc-source") === "mock" ? "mock" : "live";
  } catch {
    return q === "mock" ? "mock" : "live";
  }
}

let booted = false;

/** The server marks <html data-demo="1"> when the demo payment env vars are set. */
function useDemoReady() {
  return typeof document !== "undefined" && document.documentElement.dataset.demo === "1";
}

/** Boots the page's vanilla runtime once the server-rendered markup is hydrated. */
export function Runtime({ page, snapshot }: { page: PageKey; snapshot: Snapshot | null }) {
  const net = useNet();
  // Demo payments run on Fuji only; mainnet pages show recorded calls instead.
  const demoReady = useDemoReady() && net.testnet;
  useEffect(() => {
    if (booted) return; // React dev mode runs effects twice; the runtime owns the DOM after the first.
    booted = true;
    // Wake the sleeping demo API before someone presses Run / Pay one call.
    if (demoReady && (page === "developers" || page === "agent")) fetch("/api/demo/pay").catch(() => {});
    (async () => {
      const [{ createDC, bindChrome }, rich, extras, pageMod, gsap] = await Promise.all([
        import("@/lib/dc/runtime.js"),
        import("@/lib/dc/rich.js"),
        import("@/lib/dc/extras.js"),
        PAGES[page](),
        import("gsap"),
      ]);
      (window as unknown as { gsap: unknown }).gsap = gsap.gsap;
      const source = pickSource();
      let snap = snapshot;
      if (!snap && source === "live") snap = await fetch(`/api/snapshot?network=${net.id}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const DC = createDC({
        source,
        snapshot: snap,
        ...runtimeNet(net),
        agentNames: AGENT_NAMES,
        demoAgentId: DEMO_AGENT_ID,
        demoReady,
      });
      Object.assign(DC, { CONTRACT_LIST: net.contractList });
      const banner = (cls: string, html: string) => {
        const el = document.createElement("div");
        el.className = cls;
        el.setAttribute("role", "status");
        el.innerHTML = html;
        document.body.appendChild(el);
      };
      if (source === "live" && !snap) banner("sim-banner read-failed", `Could not read ${net.name}. Numbers are hidden until it answers. Retrying…`);
      if (source === "mock") {
        document.documentElement.dataset.source = "mock";
        banner("sim-banner", `Simulated data · rehearsal only <a href="${location.pathname}?source=live">Back to live chain data</a>`);
      }
      pageMod.default(DC);
      bindChrome(DC);
      rich.default(DC);
      extras.default(DC);
      DC.startStream();
    })();
  }, [page, snapshot, demoReady, net]);
  return null;
}
