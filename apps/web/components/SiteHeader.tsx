"use client";

import { usePathname } from "next/navigation";
import { CloseIcon, Mark, MenuIcon } from "@/components/Icons";
import { WalletButton } from "@/components/WalletButton";
import { NETWORK } from "@/lib/config";

const PAGES = [
  ["/", "Live"],
  ["/agent", "Agent"],
  ["/receipts", "Receipts"],
  ["/developers", "Developers"],
  ["/methodology", "Methodology"],
] as const;

function current(path: string) {
  if (path.startsWith("/receipt")) return "/receipts";
  if (path.startsWith("/agent")) return "/agent";
  return path;
}

/** Sticky navbar + mobile sheet. Ticker and block number are filled by the runtime (bindChrome). */
export function SiteHeader() {
  const cur = current(usePathname());
  // Plain anchors: each page boots its own live runtime.
  const links = PAGES.map(([href, label]) => (
    <a key={href} href={href} aria-current={href === cur ? "page" : undefined}>
      {label}
    </a>
  ));
  return (
    <>
      <header className="nav">
        <div className="nav-in">
          <a className="brand" href="/">
            <Mark />
            <span>DecarbonAI</span>
          </a>
          <nav className="nav-links" aria-label="Main">
            {links}
            <span className="nav-underline" aria-hidden="true" />
          </nav>
          <div className="nav-right">
            <span className="chip-net" title="Network">
              <span className="dot-live" />
              {NETWORK.name}
              <span className="blk tnum" data-block />
            </span>
            <span className="ticker" title="Total CO₂e captured, all agents">
              <span className="odo" data-ticker />
              <span className="unit">g CO₂e captured</span>
            </span>
            <WalletButton />
            <button type="button" className="icon-btn menu-btn" data-menu aria-label="Open menu">
              <MenuIcon />
            </button>
          </div>
        </div>
      </header>
      <section className="tape" aria-label="Recent carbon events">
        <div className="tape-track" />
      </section>
      <div className="sheet-bg" data-close />
      <aside className="sheet" aria-label="Menu">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <a className="brand" href="/">
            <Mark />
            <span>DecarbonAI</span>
          </a>
          <button type="button" className="icon-btn" data-close aria-label="Close menu">
            <CloseIcon />
          </button>
        </div>
        <div className="ticker" style={{ justifyContent: "space-between" }}>
          <span className="odo" data-ticker />
          <span className="unit">g CO₂e captured</span>
        </div>
        <span className="chip-net">
          <span className="dot-live" />
          {NETWORK.name}
          <span className="mono dim" style={{ fontSize: 12 }} data-block />
        </span>
        <nav>{links}</nav>
        <div style={{ display: "flex", gap: 10, marginTop: "auto" }}>
          <WalletButton primary />
        </div>
      </aside>
    </>
  );
}
