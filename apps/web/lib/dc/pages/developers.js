export default function init(DC) {
  const { fmt, NET, I } = DC;
  const $ = (s) => document.querySelector(s);
  const main = document.querySelector("main");
  const API = main.dataset.api;
  const REPO_DIR = "/path/to/decarbonai";
  const CODE = {
    server: `<span class="k">import</span> { Hono } <span class="k">from</span> <span class="s">"hono"</span>;
<span class="k">import</span> { CarbonMeter, carbonPayment, AccrualStore } <span class="k">from</span> <span class="s">"@decarbonai/x402-carbon"</span>;
<span class="k">import</span> { FUJI, fujiClient } <span class="k">from</span> <span class="s">"@decarbonai/chain"</span>;

<span class="k">const</span> app = <span class="k">new</span> Hono();
<span class="c">// The meter batches each payment's grams into CarbonAccrued on the RetirementPool.</span>
<span class="k">const</span> meter = <span class="k">new</span> CarbonMeter(fujiClient(), process.env.METER_PRIVATE_KEY, FUJI, {
  store: <span class="k">new</span> AccrualStore(<span class="s">".data/accruals.sqlite"</span>),
});
meter.start();

<span class="c">// One middleware: x402 paywall + carbon surcharge in the same payment.</span>
app.use(<span class="s">"/v1/infer"</span>, <span class="f">carbonPayment</span>({
  route: <span class="s">"GET /v1/infer"</span>,
  description: <span class="s">"Paid inference with a carbon surcharge"</span>,
  payTo: process.env.PAY_TO_ADDRESS, <span class="c">// merchant wallet the pool pulls surcharges from</span>
  baseAmount: <span class="n">10_000n</span>,                <span class="c">// $0.01 in USDC base units</span>
  meter,
}));

app.get(<span class="s">"/v1/infer"</span>, (c) => {
  <span class="k">const</span> carbon = c.get(<span class="s">"carbon"</span>); <span class="c">// { model, mgCO2e, surcharge, ... }</span>
  <span class="k">return</span> c.json({ completion, gCO2e: Number(carbon.mgCO2e) / <span class="n">1000</span> });
});`,
    agent: `<span class="k">import</span> { createPayingFetch } <span class="k">from</span> <span class="s">"@decarbonai/x402-carbon/client"</span>;

<span class="k">const</span> agent = <span class="f">createPayingFetch</span>({
  privateKey: process.env.AGENT_PRIVATE_KEY,
  agentId: <span class="n">42n</span>,                 <span class="c">// ERC-8004 id, sent as x-agent-id</span>
  maxAmountPerPayment: <span class="n">100_000n</span>, <span class="c">// never pay more than $0.10</span>
});

<span class="k">const</span> res = <span class="k">await</span> agent.fetch(
  <span class="s">"${API}/v1/infer?prompt=hello&amp;model=claude-sonnet"</span>
);
<span class="c">// The 402 quote already includes the carbon line; the agent pays once.</span>`,
  };
  // The MCP server ships in the repo (packages/mcp-server); node runs its TypeScript directly (Node 22.18+).
  const SERVER = `${REPO_DIR}/packages/mcp-server/src/server.ts`;
  const MCP = {
    code: `<span class="c"># from the cloned repo</span>
claude mcp add decarbonai \\
  --env AGENT_PRIVATE_KEY=0x… \\
  --env AGENT_ID=42 \\
  --env API_URL=${API} \\
  -- node "$PWD/packages/mcp-server/src/server.ts"`,
    desktop: `{
  <span class="s">"mcpServers"</span>: {
    <span class="s">"decarbonai"</span>: {
      <span class="s">"command"</span>: <span class="s">"node"</span>,
      <span class="s">"args"</span>: [<span class="s">"${SERVER}"</span>],
      <span class="s">"env"</span>: { <span class="s">"AGENT_PRIVATE_KEY"</span>: <span class="s">"0x…"</span>, <span class="s">"AGENT_ID"</span>: <span class="s">"42"</span>, <span class="s">"API_URL"</span>: <span class="s">"${API}"</span> }
    }
  }
}`,
    cursor: `<span class="c">// .cursor/mcp.json</span>
{
  <span class="s">"mcpServers"</span>: {
    <span class="s">"decarbonai"</span>: {
      <span class="s">"command"</span>: <span class="s">"node"</span>,
      <span class="s">"args"</span>: [<span class="s">"${SERVER}"</span>],
      <span class="s">"env"</span>: { <span class="s">"AGENT_PRIVATE_KEY"</span>: <span class="s">"0x…"</span>, <span class="s">"API_URL"</span>: <span class="s">"${API}"</span> }
    }
  }
}`,
  };
  const plain = (h) => { const d = document.createElement("div"); d.innerHTML = h; return d.textContent; };
  let cur = "server", curM = "code";
  const showCode = () => ($("#code").innerHTML = CODE[cur]);
  const showMcp = () => ($("#mcpCode").innerHTML = MCP[curM]);
  showCode(); showMcp();
  document.querySelectorAll("[data-code]").forEach((b) => b.addEventListener("click", () => { cur = b.dataset.code; document.querySelectorAll("[data-code]").forEach((x) => x.setAttribute("aria-selected", x === b)); showCode(); }));
  document.querySelectorAll("[data-mcp]").forEach((b) => b.addEventListener("click", () => { curM = b.dataset.mcp; document.querySelectorAll("[data-mcp]").forEach((x) => x.setAttribute("aria-selected", x === b)); showMcp(); }));

  function flash(btn, text) {
    navigator.clipboard?.writeText(text).catch(() => {});
    btn.classList.add("ok"); const t = btn.textContent; btn.textContent = "Copied";
    setTimeout(() => { btn.classList.remove("ok"); btn.textContent = t; }, 1200);
  }
  document.querySelector("[data-copy-text]")?.addEventListener("click", (e) => flash(e.currentTarget, e.currentTarget.dataset.copyText));
  $("#copyCode").addEventListener("click", (e) => flash(e.currentTarget, plain(CODE[cur])));
  $("#copyMcp").addEventListener("click", (e) => flash(e.currentTarget, plain(MCP[curM])));

  // Run: live pays the demo API on Fuji for real (server-side test wallet); mock simulates the round trip.
  const runBtn = $("#run");
  runBtn.innerHTML = `${I.play}<span>Run</span>`;
  let busy = false;
  const show = (lines, delays) => {
    $("#out").innerHTML = lines.map((l) => `<div class="l">${l}</div>`).join("");
    [...document.querySelectorAll("#out .l")].forEach((el, i) => setTimeout(() => el.classList.add("on"), DC.reduced ? 0 : delays[i] ?? 0));
  };
  const lines = ({ path, mg, sur, price, tx, agent, json, secs }) => [
    `<span class="dim">→</span> GET ${path}`,
    `<span class="st402">← 402 Payment Required</span>  price ${fmt.usd(price, 3)} + <span class="red">${fmt.usd(sur, 5)} carbon</span> (${(mg / 1000).toFixed(2)} g CO₂e)`,
    `<span class="dim">→</span> signing x402 payment${agent ? ` from agent #${agent}` : ""} (${NET.testnet ? "test USDC" : "USDC"}, EIP-3009)`,
    `<span class="dim">→</span> facilitator settled on ${NET.short}${secs ? ` in ${secs} s` : ""}  ${tx ? DC.hashLink(tx, 10, 6) : '<span class="dim">tx pending</span>'}`,
    `<span class="st200">← 200 OK</span>`,
    `<span class="json">${json}</span>`,
  ];
  const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  runBtn.addEventListener("click", async () => {
    if (busy) return; busy = true; runBtn.disabled = true;
    try {
      if (DC.mock) {
        const c = await DC.payOnce(42);
        show(lines({ path: "/v1/infer?prompt=hello&amp;model=claude-sonnet", mg: c.mg, sur: c.sur, price: 10000, tx: c.tx, agent: 42, secs: "1.9",
          json: esc(JSON.stringify({ completion: "Avalanche x402 lets agents pay per call…", carbon: { gCO2e: +(c.mg / 1000).toFixed(3), surcharge: fmt.usd(c.sur, 5), methodology: DC.METHOD.version } }, null, 2)) }), [0, 450, 900, 1900, 2300, 2500]);
        $("#surV").textContent = fmt.usd(c.sur, 5); $("#gV").textContent = `${(c.mg / 1000).toFixed(2)} g`;
      } else {
        $("#out").innerHTML = `<div class="l on"><span class="dim">→</span> paying the demo API on ${NET.name}…</div>`;
        const c = await DC.payOnce(DC.demoAgentId);
        const b = c.raw;
        show(lines({ path: esc(b.path), mg: c.mg, sur: c.sur, price: c.price, tx: c.tx, agent: b.agentId, secs: (b.ms / 1000).toFixed(1), json: esc(JSON.stringify(b.body, null, 2)) }), [0, 250, 500, 750, 1000, 1150]);
        $("#surV").textContent = fmt.usd(c.sur, 5); $("#gV").textContent = `${(c.mg / 1000).toFixed(2)} g`;
        $("#price").textContent = fmt.usd(c.price, 3);
        DC.toast("Paid on Fuji. The pool's CarbonAccrued lands with the next meter batch.");
      }
    } catch (e) {
      $("#out").innerHTML = `<div class="l on"><span class="red">${esc(e.message)}</span></div>`;
    } finally {
      busy = false; runBtn.disabled = false;
    }
  });

  $("#ct").innerHTML = DC.CONTRACT_LIST.map(([k, v, role]) => `<tr><td><b style="font-weight:600">${k}</b></td><td class="muted" style="white-space:normal">${role}</td><td class="r">${DC.addrLink(v)}</td></tr>`).join("");
}
