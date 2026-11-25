export default function init(DC) {
  const { fmt, NET, I } = DC;
  const $ = (s) => document.querySelector(s);
  const main = document.querySelector("main");
  const API = main.dataset.api;
  const REPO_DIR = "/path/to/decarbonai";
  // No hosted API or demo agent configured: show placeholders, never localhost or someone else's agent id.
  const AGENT = DC.demoAgentId || "&lt;your-agent-id&gt;";
  const API_ENV = API || "&lt;your-paid-api-url&gt;";
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
  baseAmount: <span class="n">10_000n</span>,                <span class="c">// 0.01 ${DC.TOKEN.symbol} in base units</span>
  meter,
}));

app.get(<span class="s">"/v1/infer"</span>, (c) => {
  <span class="k">const</span> carbon = c.get(<span class="s">"carbon"</span>); <span class="c">// { model, mgCO2e, surcharge, ... }</span>
  <span class="k">return</span> c.json({ completion, gCO2e: Number(carbon.mgCO2e) / <span class="n">1000</span> });
});`,
    agent: `<span class="k">import</span> { createPayingFetch } <span class="k">from</span> <span class="s">"@decarbonai/x402-carbon/client"</span>;

<span class="k">const</span> agent = <span class="f">createPayingFetch</span>({
  privateKey: process.env.AGENT_PRIVATE_KEY,
  agentId: ${DC.demoAgentId ? `<span class="n">${AGENT}n</span>,${" ".repeat(Math.max(1, 18 - String(AGENT).length))}<span class="c">// our demo agent; use your own ERC-8004 id</span>` : `BigInt(process.env.AGENT_ID), <span class="c">// your ERC-8004 id, sent as x-agent-id</span>`}
  maxAmountPerPayment: <span class="n">100_000n</span>, <span class="c">// never pay more than $0.10</span>
});

<span class="k">const</span> res = <span class="k">await</span> agent.fetch(
  ${API ? `<span class="s">"${API}/v1/infer?prompt=hello&amp;model=claude-sonnet"</span>` : `process.env.API_URL + <span class="s">"/v1/infer?prompt=hello&amp;model=claude-sonnet"</span>`}
);
<span class="c">// The 402 quote already includes the carbon line; the agent pays once.</span>`,
  };
  // The MCP server ships in the repo (packages/mcp-server); node runs its TypeScript directly (Node 22.18+).
  const SERVER = `${REPO_DIR}/packages/mcp-server/src/server.ts`;
  const MCP = {
    code: `<span class="c"># from the cloned repo</span>${API ? "" : `
<span class="c"># No public paid API yet. Run your own (npm run api) with a meter the pool admin has authorised.</span>`}
claude mcp add decarbonai \\
  --env AGENT_PRIVATE_KEY=0x… \\
  --env AGENT_ID=${AGENT} \\
  --env API_URL=${API_ENV} \\
  -- node "$PWD/packages/mcp-server/src/server.ts"`,
    desktop: `{
  <span class="s">"mcpServers"</span>: {
    <span class="s">"decarbonai"</span>: {
      <span class="s">"command"</span>: <span class="s">"node"</span>,
      <span class="s">"args"</span>: [<span class="s">"${SERVER}"</span>],
      <span class="s">"env"</span>: { <span class="s">"AGENT_PRIVATE_KEY"</span>: <span class="s">"0x…"</span>, <span class="s">"AGENT_ID"</span>: <span class="s">"${AGENT}"</span>, <span class="s">"API_URL"</span>: <span class="s">"${API_ENV}"</span> }
    }
  }
}`,
    cursor: `<span class="c">// .cursor/mcp.json</span>
{
  <span class="s">"mcpServers"</span>: {
    <span class="s">"decarbonai"</span>: {
      <span class="s">"command"</span>: <span class="s">"node"</span>,
      <span class="s">"args"</span>: [<span class="s">"${SERVER}"</span>],
      <span class="s">"env"</span>: { <span class="s">"AGENT_PRIVATE_KEY"</span>: <span class="s">"0x…"</span>, <span class="s">"API_URL"</span>: <span class="s">"${API_ENV}"</span> }
    }
  }
}`,
  };
  const plain = (h) => { const d = document.createElement("div"); d.innerHTML = h; return d.textContent; };
  let cur = "server", curM = "code";
  const showCode = () => ($("#code").innerHTML = CODE[cur]);
  const showMcp = () => ($("#mcpCode").innerHTML = MCP[curM]);
  showCode(); showMcp();
  // Arrow keys move between tabs (ARIA tabs pattern).
  document.querySelectorAll('[role="tablist"]').forEach((list) => list.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const tabs = [...list.querySelectorAll('[role="tab"]')], i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    next.focus(); next.click();
  }));
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
  runBtn.className = "btn btn-primary btn-sm";
  runBtn.innerHTML = `${I.play}<span>Run</span>`;
  if (!DC.mock && !NET.testnet) {
    // Mainnet: no live pay button. Run stays a Fuji demo; show the recorded mainnet call and receipts instead.
    runBtn.disabled = true;
    runBtn.title = "Runs on Fuji testnet with test USDC";
    runBtn.className = "btn btn-outline btn-sm run-off";
    runBtn.innerHTML = "<span>Run · Fuji only</span>";
    const rs = DC.state.receipts.slice().sort((x, y) => x.n - y.n);
    const links = rs.map((r) => `<a href="/receipt/${r.n}" style="color:var(--mint)">${fmt.no(r.n)}</a>`).join(" · ");
    $("#out").innerHTML = `${recorded()}<p class="dim" style="font-size:13px;margin-top:12px">${links ? `Mainnet receipts: ${links}. ` : ""}Run works on <a href="/developers?network=fuji" style="color:var(--mint)">Fuji testnet</a> with test USDC.</p>`;
  } else if (!DC.mock && !DC.demoReady) {
    // Not configured: say so up front instead of failing on click.
    runBtn.disabled = true;
    runBtn.title = "Live demo payments are switched off on this deployment";
    runBtn.className = "btn btn-outline btn-sm run-off";
    runBtn.innerHTML = "<span>Run · off</span>";
    $("#out").innerHTML = recorded() || `<div class="empty"><div>Live demo payments are switched off on this deployment, so Run is paused.<br>Past ${NET.name} activity is on <a href="/" style="color:var(--mint)">Live</a>.</div></div>`;
  }

  // With payments off, show the last real metered call instead of an empty panel: on-chain facts only, labelled as recorded.
  function recorded() {
    const acc = DC.events.accruals;
    if (!acc.length) return "";
    const last = acc.reduce((a, b) => (b.block > a.block ? b : a));
    const batch = acc.filter((a) => a.tx === last.tx);
    const mg = batch.reduce((s, a) => s + a.mg, 0), sur = batch.reduce((s, a) => s + a.sur, 0);
    const pend = DC.state.pending[last.agent] || 0;
    const who = last.agent ? `Agent #${last.agent}` : "An unregistered payer";
    return `<div class="rec">
      <div class="rec-h"><span class="pill pill-mock">Recorded${NET.testnet ? "" : " test call"} · ${new Date(last.t).toISOString().slice(0, 16).replace("T", " ")} UTC · not a live call</span><span class="mono dim">block ${fmt.count(last.block)}</span></div>
      <ol>
        <li><span class="n">1</span><div><div class="t">${who} paid over x402</div><div class="s">${DC.TOKEN.name} on ${NET.short}, settled by the facilitator first</div></div><div class="v">payer ${DC.short(last.payer)}</div></li>
        <li><span class="n">2</span><div><div class="t">Meter posted CarbonAccrued</div><div class="s">${batch.length} call${batch.length > 1 ? "s" : ""} in this meter batch</div></div><div class="v lime">+${(mg / 1000).toFixed(2)} g CO₂e</div></li>
        <li><span class="n">3</span><div><div class="t">Surcharge counted in the pool</div><div class="s">Pulled from the payTo wallet in batches</div></div><div class="v">${fmt.usd(sur, 5)} ${DC.TOKEN.symbol}</div></li>
        <li><span class="n">4</span><div><div class="t">${last.agent ? `Agent #${last.agent}'s account` : "Payer's account"}</div><div class="s">Next ${DC.UNBACKED ? "mock " : ""}receipt at ${fmt.mass(DC.THRESHOLD_MG)}</div></div><div class="v lime">${fmt.g(pend, 1)} / ${fmt.count(DC.THRESHOLD_MG / 1000)} g</div></li>
      </ol>
      <a class="rec-tx" href="${NET.explorer}/tx/${last.tx}" target="_blank" rel="noreferrer">View tx ${DC.short(last.tx, 8, 6)} on ${NET.explorer.includes("snowtrace") ? "Snowtrace" : "the explorer"} ↗</a>
    </div>`;
  }
  let busy = false;
  const show = (lines, delays) => {
    $("#out").innerHTML = lines.map((l) => `<div class="l">${l}</div>`).join("");
    [...document.querySelectorAll("#out .l")].forEach((el, i) => setTimeout(() => el.classList.add("on"), DC.reduced ? 0 : delays[i] ?? 0));
  };
  const lines = ({ path, mg, sur, price, tx, agent, json, secs }) => [
    `<span class="dim">→</span> GET ${path}`,
    `<span class="st402">← 402 Payment Required</span>  price ${fmt.usd(price, 3)} + <span class="red">${fmt.usd(sur, 5)} carbon</span> (${(mg / 1000).toFixed(2)} g CO₂e)`,
    `<span class="dim">→</span> signing x402 payment${agent ? ` from agent #${agent}` : ""} (${DC.TOKEN.name}, EIP-3009)`,
    `<span class="dim">→</span> facilitator settled on ${NET.short}${secs ? ` · round trip ${secs} s` : ""}  ${tx ? DC.hashLink(tx, 10, 6) : '<span class="dim">tx pending</span>'}`,
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
      $("#out").innerHTML = `<div class="l on"><span class="red">${esc(e instanceof TypeError || !e?.message ? "Payment could not be sent. Nothing was paid." : e.message)}</span></div>`;
    } finally {
      busy = false; runBtn.disabled = false;
    }
  });

  $("#ct").innerHTML = DC.CONTRACT_LIST.map(([k, v, role]) => `<tr><td><b style="font-weight:600">${k}</b></td><td class="muted" style="white-space:normal">${role}</td><td class="r">${DC.addrLink(v)}</td></tr>`).join("");
}
