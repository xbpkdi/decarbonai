/* Server-rendered markup for the Live page; lib/dc/pages/live.js fills and animates it. */
import type { Net } from "@/lib/config";
import { LotNote } from "@/components/pages/LotNote";

/** The status pill as of this read; the runtime keeps it current after boot. */
export function LiveMarkup({ net, status }: { net: Net; status: "LIVE" | "IDLE" | "NO DATA" }) {
  const { token: TOKEN } = net;
  const NETWORK = net;
  const BURN = net.unbacked ? "Mock DCO2 burn" : "DCO2 burn";
  return (
    <>
    <section className="hero" aria-labelledby="h-metered">
      <div className="eyebrow-row"><span className={status === "LIVE" ? "pill pill-live" : "pill pill-smoke pill-idle"} id="status">{status}</span><span className="eyebrow" id="h-metered">x402 carbon meter · {NETWORK.testnet ? `${NETWORK.short} testnet` : NETWORK.name}</span></div>
      <h1 className="big"><span className="odo" id="big"></span><span className="unit">g CO₂e</span></h1>
      <p className="line" id="line"></p>
      <LotNote net={net} />
    </section>

    <section className="pool card bar-mint" aria-labelledby="h-pool">
      <div className="card-h"><h2 id="h-pool">Retirement pool</h2><span className="pill pill-smoke state-pill pill-dot" id="poolState">Filling</span></div>
      <div className="card-b">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "12px" }}><span className="muted" style={{ fontSize: "14px" }} id="poolAgent" /><a className="btn-chain btn" href="/agent" id="poolAgentLink" style={{ fontSize: "13px" }}>Agent profile ↗</a></div>
        <div className="togo"><span className="odo" id="togo"></span><span className="unit" style={{ fontSize: "16px" }}>g until the next receipt</span></div>
        <div id="scale"></div>
        <div className="scale-ticks" aria-hidden="true"><span style={{ left: "0" }}>0</span><span style={{ left: "20%" }}>200</span><span style={{ left: "40%" }}>400</span><span style={{ left: "60%" }}>600</span><span style={{ left: "80%" }}>800</span><span style={{ left: "100%" }}>1 kg</span></div>
        <div className="pool-foot"><span id="pooled"></span><span>{BURN} + soulbound receipt at 1 kg</span></div>
      </div>
    </section>

    <section className="scene card" aria-label="Animation: metered calls filling a payer's account in the pool">
      <div className="scene-stage">
        <canvas id="scene" aria-hidden="true" tabIndex={-1}></canvas>
        <div className="scene-legend" aria-hidden="true"><span><i style={{ background: "var(--smoke)" }}></i>Emitted</span><span><i style={{ background: "var(--mint)" }}></i>Pooled</span><span><i style={{ background: "var(--avax)" }}></i>On-chain</span></div>
        <div className="scene-keys" aria-hidden="true" hidden><kbd>B</kbd> burst 100 calls · <kbd>P</kbd> pause</div>
        <div className="rp-note" id="rpNote" hidden>Replay of recorded {NETWORK.short} events · not live</div>
        <div className="node-label" data-node="0"><div className="t">AI agent</div><div className="s" id="lblAgent" /><div className="v" id="lblVia">x402 payer</div></div>
        <div className="node-label" data-node="1"><div className="t">x402 payment</div><div className="s">{TOKEN.name}{TOKEN.symbol !== TOKEN.name && ` (${TOKEN.symbol})`} on {NETWORK.short}</div><div className="v" id="lbl-pay"></div></div>
        <div className="node-label" data-node="2"><div className="t">Retirement pool</div><div className="s">CarbonAccrued</div><div className="v" id="lbl-pool"></div></div>
        <div className="node-label" data-node="3"><div className="t">Seal</div><div className="s">{BURN} · ERC-5192</div><div className="v" id="lbl-seal"></div></div>
      </div>
      <div className="rp" id="replay" hidden></div>
    </section>

    <section className="feed card" aria-labelledby="h-feed">
      <div className="card-h"><h2 id="h-feed">Metered calls</h2><span className="dim" style={{ fontSize: "13px" }}>Each row is one meter batch, posted after the payments settle. ×n is the number of calls in it.</span></div>
      <div className="scroll">
        <table className="tbl">
          <thead><tr><th className="c-time">Time (ICT)</th><th>Agent</th><th className="c-res">Paid for</th><th className="r c-price">Price</th><th className="r">Carbon</th><th className="r c-sur">Surcharge</th><th className="r">Tx</th></tr></thead>
          <tbody id="feed"></tbody>
        </table>
      </div>
    </section>

    <section className="latest card bar-red" aria-labelledby="h-latest" id="latest"></section>

    </>
  );
}
