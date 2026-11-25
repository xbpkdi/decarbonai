import { NETS, type Net, short } from "@/lib/config";

/* Server-rendered markup for the Developers page; lib/dc/pages/developers.js fills and animates it. */
const INSTALL = "git clone https://github.com/xbpkdi/decarbonai && cd decarbonai && npm install";

/** `demo`: live demo payments are configured on this deployment. */
export function DevelopersMarkup({ net, demo }: { net: Net; demo: boolean }) {
  const { deployment: DEPLOYMENT, unbacked: UNBACKED } = net;
  const NETWORK = net;
  // Run always pays on Fuji, so name Fuji's token, not this network's.
  const RUN = NETS.fuji;
  return (
    <>
      <header className="page-head">
    <div className="wrap">
      <span className="eyebrow">Developers · x402 middleware · MCP</span>
      <h1 className="display">Meter carbon on every x402 call</h1>
      <p className="lead">One Hono middleware plus a meter we authorise. Each payment includes a carbon surcharge based on the token limits you declare. {NETWORK.testnet ? `On ${NETWORK.short} the` : "The"} pool burns a {UNBACKED ? "mock" : "backed"} credit per 1 kg.</p>
      <div className="card install"><span className="dollar">$</span><code id="cmd">{INSTALL}</code><button type="button" className="btn btn-outline btn-sm copy" data-copy-text={INSTALL}>Copy</button></div>
      <p className="dim install-note">Install from GitHub. The packages are not on npm yet.</p>
    </div>
  </header>

  <div className="wrap">
    <section className="section" aria-labelledby="h-try">
      <div className="section-title"><h2 id="h-try">Try it: pay for one call</h2><span className="dim" style={{ fontSize: "13px" }}>{!net.testnet ? "Runs on Fuji testnet with test USDC" : demo ? `Run calls the paid demo API on ${NETWORK.short} with a test agent wallet` : "Live demo payments are off on this deployment"}</span></div>
      <div className="two">
        <div className="card" style={{ overflow: "hidden" }}>
          <div className="tabs" role="tablist"><button type="button" className="tab" role="tab" aria-selected="true" data-code="server">server.ts</button><button type="button" className="tab" role="tab" aria-selected="false" data-code="agent">agent.ts</button><span className="sp"></span><button type="button" className="btn btn-outline btn-sm copy" id="copyCode">Copy</button></div>
          <pre className="code" id="code"></pre>
        </div>
        <div className="card run bar-red">
          <div className="card-h"><h3>Response</h3><button type="button" className={demo ? "btn btn-primary btn-sm" : "btn btn-outline btn-sm run-off"} id="run">{demo ? "Run" : "Run · off"}</button></div>
          <div className="out" id="out"><div className="empty">Press Run. The agent gets a 402 quote with the carbon price in it, pays once in {RUN.token.name} ({NETWORK.testnet ? "" : "on Fuji, "}our faucet token, {short(RUN.deployment.paymentToken ?? "")}) and gets a simulated answer and a Snowtrace link.</div></div>
          <div className="sur" id="sur"><div><div className="k2">{demo ? "Call price" : "Example price"}</div><div className="v2" id="price">$0.010</div></div><div><div className="k2">Carbon surcharge</div><div className="v2" id="surV" style={{ color: "var(--avax)" }}>{demo ? "$0" : "–"}</div></div><div><div className="k2">CO₂e</div><div className="v2" id="gV" style={{ color: "var(--mint)" }}>{demo ? "0 g" : "–"}</div></div></div>
        </div>
      </div>
    </section>

    <section className="section" id="mcp" aria-labelledby="h-mcp">
      <div className="section-title"><h2 id="h-mcp">Give Claude a wallet (MCP)</h2><span className="dim" style={{ fontSize: "13px" }}>The MCP server in the repo ({NETWORK.testnet ? NETWORK.short : "set up for the Fuji demo"})</span></div>
      <div className="card" style={{ overflow: "hidden" }}>
        <div className="tabs" role="tablist"><button type="button" className="tab" role="tab" aria-selected="true" data-mcp="code">Claude Code</button><button type="button" className="tab" role="tab" aria-selected="false" data-mcp="desktop">Claude Desktop</button><button type="button" className="tab" role="tab" aria-selected="false" data-mcp="cursor">Cursor</button><span className="sp"></span><button type="button" className="btn btn-outline btn-sm copy" id="copyMcp">Copy</button></div>
        <pre className="code" id="mcpCode"></pre>
      </div>
      <div className="tools">
        <div className="card tool"><code>paid_inference</code><p>Calls the paid API over x402. The payment includes the carbon surcharge. Returns a simulated completion, the carbon breakdown and Snowtrace links.</p></div>
        <div className="card tool"><code>carbon_status</code><p>Reads this agent's account on the RetirementPool: calls, grams metered, kg retired (mock credit on Fuji), progress to the next receipt, and its receipts.</p></div>
        <div className="card tool"><code>estimate_carbon</code><p>Free. Estimates grams of CO₂e and the surcharge for a call before paying.</p></div>
      </div>
    </section>

    <section className="section" aria-labelledby="h-c">
      <div className="section-title"><h2 id="h-c">Contracts on {NETWORK.name}</h2><span className="dim mono" style={{ fontSize: "12px" }}>chain id {DEPLOYMENT.chainId}</span></div>
      <div className="card" style={{ overflowX: "auto", position: "relative" }}><table className="tbl ct-tbl"><thead><tr><th>Contract</th><th>Role</th><th className="r">Address</th></tr></thead><tbody id="ct"></tbody></table></div>
    </section>
  </div>
    </>
  );
}
