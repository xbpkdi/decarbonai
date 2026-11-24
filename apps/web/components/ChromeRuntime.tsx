"use client";

import { useEffect } from "react";
import { runtimeNet, useNet } from "@/components/Net";
import { AGENT_NAMES, DEMO_AGENT_ID } from "@/lib/config";

/** Pages without a page runtime (404): boots the header, tape and menu, so the meter chip, block number, event tape and menu work. */
export function ChromeRuntime() {
  const net = useNet();
  useEffect(() => {
    let done = false;
    (async () => {
      const [{ createDC, bindChrome }, rich] = await Promise.all([import("@/lib/dc/runtime.js"), import("@/lib/dc/rich.js")]);
      const snap = await fetch(`/api/snapshot?network=${net.id}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (done) return;
      const DC = createDC({
        source: "live",
        snapshot: snap,
        ...runtimeNet(net),
        agentNames: AGENT_NAMES,
        demoAgentId: DEMO_AGENT_ID,
        demoReady: false,
      });
      bindChrome(DC);
      rich.default(DC);
    })();
    return () => {
      done = true;
    };
  }, [net]);
  return null;
}
