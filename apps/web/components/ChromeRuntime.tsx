"use client";

import { useEffect } from "react";
import { AGENT_NAMES, CONTRACT_LIST, CREDIT_NOTE, DEMO_AGENT_ID, DEPLOYMENT, NETWORK, TOKEN, UNBACKED } from "@/lib/config";

/** Pages without a page runtime (404): boots the header, tape and menu, so the meter chip, block number, event tape and menu work. */
export function ChromeRuntime() {
  useEffect(() => {
    let done = false;
    (async () => {
      const [{ createDC, bindChrome }, rich] = await Promise.all([import("@/lib/dc/runtime.js"), import("@/lib/dc/rich.js")]);
      const snap = await fetch("/api/snapshot").then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (done) return;
      const contracts = Object.fromEntries(CONTRACT_LIST.map(([name, address]) => [name.startsWith("DCO2") ? "DCO2" : name, address]));
      const DC = createDC({
        source: "live",
        snapshot: snap,
        net: { name: NETWORK.name, short: NETWORK.short, explorer: NETWORK.explorer, testnet: NETWORK.testnet },
        contracts,
        method: { version: DEPLOYMENT.methodologyVersion, hash: DEPLOYMENT.methodologyHash },
        thresholdMg: DEPLOYMENT.thresholdMg,
        pricePerTonne: DEPLOYMENT.pricePerTonne,
        agentNames: AGENT_NAMES,
        featured: DEMO_AGENT_ID,
        demoAgentId: DEMO_AGENT_ID,
        creditNote: CREDIT_NOTE,
        unbacked: UNBACKED,
        token: TOKEN,
        demoReady: false,
      });
      bindChrome(DC);
      rich.default(DC);
    })();
    return () => {
      done = true;
    };
  }, []);
  return null;
}
