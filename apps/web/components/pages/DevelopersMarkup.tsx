import { NETWORK, DEPLOYMENT } from "@/lib/config";

/* Server-rendered markup for the Developers page; lib/dc/pages/developers.js fills and animates it. */
const INSTALL = "git clone https://github.com/xbpkdi/decarbonai && cd decarbonai && npm install";

export function DevelopersMarkup() {
  return (
    <>
      <header className="page-head">
    <div className="wrap">
      <span className="eyebrow">Developers · x402 middleware · MCP</span>
      <h1 className="display">Meter carbon on every x402 call</h1>
      <p className="lead">Add one middleware to a paid API on Avalanche. Each payment carries a carbon surcharge priced from the call's tokens, and the pool retires credit for the payer when it fills.</p>
      <div className="card install"><span className="dollar">$</span><code id="cmd">{INSTALL}</code><button type="button" className="btn btn-outline btn-sm copy" data-copy-text={INSTALL}>Copy</button></div>
      <p className="dim install-note">Installs from GitHub today: the packages live in the repo&apos;s npm workspace. npm release soon.</p>
    </div>
  </header>

  <div className="wrap">
    <section className="section" aria-labelledby="h-try">
      <div className="section-title"><h2 id="h-try">Try it: pay for one call</h2><span className="dim" style={{ fontSize: "13px" }}>Run calls the paid demo API on {NETWORK.short} with a test agent wallet</span></div>
      <div className="two">
        <div className="card" style={{ overflow: "hidden" }}>
          <div className="tabs" role="tablist"><button type="button" className="tab" role="tab" aria-selected="true" data-code="server">server.ts</button><button type="button" className="tab" role="tab" aria-selected="false" data-code="agent">agent.ts</button><span className="sp"></span><button type="button" className="btn btn-outline btn-sm copy" id="copyCode">Copy</button></div>
          <pre className="code" id="code"></pre>
        </div>
        <div className="card run bar-red">
          <div className="card-h"><h3>Response</h3><button type="button" className="btn btn-primary btn-sm" id="run">Run</button></div>
          <div className="out" id="out"><div className="empty">Press Run. The agent receives a 402 with the carbon line in the quote, pays once in test USDC, and gets the answer plus a Snowtrace link.</div></div>
          <div className="sur" id="sur"><div><div className="k2">Call price</div><div className="v2" id="price">$0.010</div></div><div><div className="k2">Carbon surcharge</div><div className="v2" id="surV" style={{ color: "var(--avax)" }}>$0</div></div><div><div className="k2">gCO₂e</div><div className="v2" id="gV" style={{ color: "var(--mint)" }}>0 g</div></div></div>
        </div>
      </div>
    </section>

    <section className="section" id="mcp" aria-labelledby="h-mcp">
      <div className="section-title"><h2 id="h-mcp">Give Claude a wallet (MCP)</h2><span className="dim" style={{ fontSize: "13px" }}>The server the live demo runs</span></div>
      <div className="card" style={{ overflow: "hidden" }}>
        <div className="tabs" role="tablist"><button type="button" className="tab" role="tab" aria-selected="true" data-mcp="code">Claude Code</button><button type="button" className="tab" role="tab" aria-selected="false" data-mcp="desktop">Claude Desktop</button><button type="button" className="tab" role="tab" aria-selected="false" data-mcp="cursor">Cursor</button><span className="sp"></span><button type="button" className="btn btn-outline btn-sm copy" id="copyMcp">Copy</button></div>
        <pre className="code" id="mcpCode"></pre>
      </div>
      <div className="tools">
        <div className="card tool"><code>paid_inference</code><p>Calls the paid API over x402. The payment carries the carbon surcharge; returns the answer, the carbon breakdown and Snowtrace links.</p></div>
        <div className="card tool"><code>carbon_status</code><p>Reads this agent's account on the RetirementPool: calls, grams accrued, kg retired, progress to the next seal and its receipts.</p></div>
        <div className="card tool"><code>estimate_carbon</code><p>Free. Estimates grams of CO₂e and the surcharge for a call before paying.</p></div>
      </div>
    </section>

    <section className="section" aria-labelledby="h-c">
      <div className="section-title"><h2 id="h-c">Contracts on {NETWORK.name}</h2><span className="dim mono" style={{ fontSize: "12px" }}>chain id {DEPLOYMENT.chainId}</span></div>
      <div className="card" style={{ overflowX: "auto", position: "relative" }}><table className="tbl"><thead><tr><th>Contract</th><th>Role</th><th className="r">Address</th></tr></thead><tbody id="ct"></tbody></table></div>
    </section>
  </div>
    </>
  );
}
