"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect } from "react";
import { DEFAULT_NET, NET_IDS, type Net, type NetId, NETS, netHref } from "@/lib/config";

const NetContext = createContext<Net>(NETS[DEFAULT_NET]);
const KEY = "dc-network";

/** The network this page was rendered for (middleware.ts picked it). */
export const useNet = () => useContext(NetContext);

function remember(id: NetId) {
  try {
    localStorage.setItem(KEY, id);
  } catch {}
}

/**
 * Keeps the choice in the URL and localStorage (middleware.ts keeps the cookie from ?network=):
 * - localStorage says another network than this page (cookie lost): reload on that one;
 * - on Fuji, ?network=fuji stays in the address bar and is added to internal links when clicked.
 */
export function NetProvider({ id, children }: { id: NetId; children: React.ReactNode }) {
  useEffect(() => {
    const url = new URL(location.href);
    const asked = url.searchParams.get("network");
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(KEY);
    } catch {}
    if (!asked && stored && stored !== id && NET_IDS.includes(stored as NetId)) {
      location.replace(netHref(stored as NetId, url.pathname, url.search));
      return;
    }
    remember(id);
    if (id === DEFAULT_NET ? asked : asked !== id) {
      if (id === DEFAULT_NET) url.searchParams.delete("network");
      else url.searchParams.set("network", id);
      history.replaceState(history.state, "", url);
    }
    if (id === DEFAULT_NET) return;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element).closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.origin !== location.origin || a.pathname.startsWith("/api/")) return;
      if (!new URLSearchParams(a.search).has("network")) a.href = netHref(id, a.pathname, a.search) + a.hash;
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [id]);
  return <NetContext.Provider value={NETS[id]}>{children}</NetContext.Provider>;
}

/** Header chip toggle: "Avalanche mainnet" / "Fuji testnet". Plain links, so it works before the runtime boots. */
export function NetSwitch() {
  const net = useNet();
  const path = usePathname();
  return (
    // biome-ignore lint/a11y/useSemanticElements: two links styled as a toggle inside the chip
    <span className="net-switch" role="group" aria-label="Network">
      {NET_IDS.map((id) => (
        <a
          key={id}
          href={netHref(id, path)}
          aria-current={id === net.id ? "true" : undefined}
          onClick={() => remember(id)}
          title={id === net.id ? `Showing ${NETS[id].name}` : `Show ${NETS[id].name}`}
        >
          <span className="ns-long">{NETS[id].label}</span>
          <span className="ns-short">{id === "mainnet" ? "Mainnet" : "Fuji"}</span>
        </a>
      ))}
    </span>
  );
}

/** The network part of the vanilla runtime's config (lib/dc/runtime.js createDC). */
export function runtimeNet(net: Net) {
  const D = net.deployment;
  return {
    net: { id: net.id, name: net.name, short: net.short, explorer: net.explorer, testnet: net.testnet, calls: net.calls, lot: net.lot },
    contracts: Object.fromEntries(net.contractList.map(([name, address]) => [name.startsWith("DCO2") ? "DCO2" : name, address])),
    method: { version: D.methodologyVersion, hash: D.methodologyHash },
    thresholdMg: D.thresholdMg,
    pricePerTonne: D.pricePerTonne,
    creditNote: net.creditNote,
    unbacked: net.unbacked,
    token: net.token,
    featured: net.featured,
  };
}
