/* Interactions: footer pool grid, terminal proof on Developers, Methodology flow chain,
   Agent "pay one call". Runs after rich.js. Nothing here loops: motion runs once or on a real event. */
export default function init(DC) {
  const page = document.querySelector("main")?.dataset.page || "index";
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- footer band: the featured agent's pool fills a 1 kg grid (1 square = 1/100 kg) ----------
  // Still until a real accrual lands: only then do the new squares pop in. At 1 kg the grid becomes the mark with its receipt.
  function grams(viz) {
    if (DC.failed) return;
    const F = DC.FEATURED, per = DC.THRESHOLD_MG / 100;
    const fig = viz.querySelector(".grams"), blk = viz.querySelector(".blk"), grid = viz.querySelector(".grid");
    const label = viz.querySelector(".gv"), done = viz.querySelector(".done");
    const cells = Array.from({ length: 100 }, () => grid.appendChild(document.createElement("i")));
    let shown = 0, holding = false;
    function paint(animate) {
      const p = Math.min(DC.state.pending[F] || 0, DC.THRESHOLD_MG), on = Math.floor(p / per);
      cells.forEach((c, i) => { c.classList.toggle("on", i < on); c.classList.toggle("new", animate && !reduced && i >= shown && i < on); });
      shown = on;
      label.textContent = `${DC.fmt.count(Math.round(p / 1000))} g`;
    }
    function full(r) {
      holding = true;
      label.textContent = "1 kg";
      done.innerHTML = `1 kg retired<br>→ Receipt ${DC.fmt.no(r.n)}`;
      blk.classList.add("full"); fig.classList.add("full");
      setTimeout(() => {
        blk.classList.remove("full"); fig.classList.remove("full");
        done.textContent = "";
        holding = false; shown = 0; paint(false);
      }, 4000);
    }
    DC.on("accrual", (c) => { if (c.agent === F && !holding && !DC.replaying) paint(true); });
    DC.on("retired", (r) => { if (r.agent === F && !holding && !DC.replaying) full(r); });
    paint(false);
    viz.hidden = false;
  }

  // ---------- Developers: Claude Code terminal proof in the hero (plays once on screen; Replay plays it again) ----------
  function terminal(host) {
    const term = document.createElement("div");
    term.className = "term";
    term.innerHTML = `<div class="term-bar"><i></i><i></i><i></i><span>Illustration · replay</span><button class="term-replay" type="button">Replay</button></div><div class="term-body" aria-live="polite"></div>`;
    host.appendChild(term);
    const body = term.querySelector(".term-body");
    const { fmt } = DC;
    let run = 0;
    async function play() {
      const id = ++run;
      const wait = (ms) => new Promise((r) => setTimeout(r, reduced ? 0 : ms));
      const alive = () => id === run;
      // Live: an illustration around the latest real CarbonAccrued. Mock: a simulated call that also feeds the stream.
      const last = DC.mock ? null : DC.state.feed[0];
      const agentId = last ? last.agent : DC.mock ? 42 : 0;
      const mg = last ? last.mg : Math.round(DC.gramsPerCall("claude-sonnet", 3000, 1500).g * 1000 * (0.92 + Math.random() * 0.16));
      const sur = last ? last.sur : DC.surchargeFor(mg), tx = last ? last.tx : DC.mock ? DC.hex(32) : null;
      body.innerHTML = `<div class="ln"><span class="pr">&gt;</span> <span class="typed"></span><span class="caret"></span></div>`;
      const typed = body.querySelector(".typed");
      const prompt = 'Use paid_inference to summarise "x402 on Avalanche" for my notes';
      for (let i = 0; i <= prompt.length && alive(); i++) { typed.textContent = prompt.slice(0, i); await wait(22); }
      body.querySelector(".caret").remove();
      const out = [
        [500, `<span class="tool">⏺ decarbonai · paid_inference</span> <span class="dim">(MCP)</span>`],
        [700, `<span class="br">⎿</span> GET /v1/infer?prompt=…&amp;model=…`],
        [600, `<span class="br">⎿</span> <span class="warn">402 Payment Required</span>  $0.010 + <span class="red">${fmt.usd(sur, 5)} carbon</span> <span class="dim">(${(mg / 1000).toFixed(2)} g CO₂e)</span>`],
        [800, `<span class="br">⎿</span> signed x402 payment${agentId ? ` · agent #${agentId}` : ""} · ${DC.TOKEN.name}`],
        [1100, `<span class="br">⎿</span> settled via x402 facilitator on ${DC.NET.name}`],
        [500, `<span class="br">⎿</span> <span class="dim">later, in a meter batch:</span> <span class="lime">+${(mg / 1000).toFixed(2)} g recorded</span>${tx ? ` <span class="red">${DC.short(tx, 8, 6)}</span>` : ""} · pool ${fmt.count(Math.round(Math.min((DC.state.pending[agentId] || 0) + (last ? 0 : mg), DC.THRESHOLD_MG) / 1000))} / ${fmt.count(DC.THRESHOLD_MG / 1000)} g`],
        [700, `<span class="tool">⏺</span> [simulated completion] The server answers 402 with a price, the agent signs a ${DC.TOKEN.name} transfer (EIP-3009) and a facilitator settles it.`],
      ];
      for (const [ms, html] of out) {
        await wait(ms); if (!alive()) return;
        body.insertAdjacentHTML("beforeend", `<div class="ln in">${html}</div>`);
        if (DC.mock && html.includes("settled")) DC.payOnce(42);
      }
    }
    term.querySelector(".term-replay").addEventListener("click", play);
    new IntersectionObserver(([e], o) => { if (e.isIntersecting) { play(); o.disconnect(); } }, { threshold: 0.4 }).observe(term);
  }

  // ---------- Methodology: the chain from tokens to dollars, tied to the calculator ----------
  function flowChain(host) {
    const el = document.createElement("div");
    el.className = "chain card";
    el.innerHTML = `<span class="eyebrow">One call, end to end</span><ol id="chainList"></ol>`;
    host.appendChild(el);
    const paint = () => {
      const val = (id) => +document.getElementById(id)?.value || 0;
      const model = document.querySelector("#seg [aria-pressed='true']")?.dataset.m || "claude-sonnet";
      const tin = val("tin"), tout = val("tout");
      const { wh, g } = DC.gramsPerCall(model, tin, tout), mg = Math.round(g * 1000);
      const steps = [
        ["Tokens", `${DC.fmt.count(tin)} in · ${DC.fmt.count(tout)} out`, ""],
        ["Energy", `${wh.toFixed(2)} Wh`, ""],
        ["Carbon", `${g.toFixed(3)}<small>g CO₂e</small>`, "lime"],
        ["On-chain", `recorded as ${DC.fmt.count(mg)} mg, in a later batch`, "red"],
        ["Surcharge", `${DC.fmt.usd(DC.surchargeFor(mg), 5)} in the same x402 payment`, ""],
      ];
      el.querySelector("ol").innerHTML = steps.map(([k, v, c]) => `<li class="${c}"><span class="k">${k}</span><span class="v">${v}</span></li>`).join("");
    };
    paint();
    document.addEventListener("input", paint);
    document.getElementById("seg")?.addEventListener("click", () => setTimeout(paint, 0));
  }

  // ---------- per page ----------
  function start() {
    const foot = document.querySelector(".foot-band");
    if (foot) {
      const viz = foot.querySelector(".viz");
      if (viz) grams(viz);
      // The logo mark assembles once when the band comes into view.
      new IntersectionObserver(([e], o) => { if (e.isIntersecting) { foot.classList.add("drawn"); o.disconnect(); } }, { threshold: 0.4 }).observe(foot);
    }

    if (page === "developers") {
      const head = document.querySelector(".page-head");
      const wrap = head.querySelector(".wrap");
      const left = document.createElement("div");
      while (wrap.firstChild) left.appendChild(wrap.firstChild);
      wrap.appendChild(left);
      wrap.classList.add("hero-split");
      terminal(wrap);
    }
    if (page === "methodology") {
      const wrap = document.querySelector(".page-head .wrap");
      const left = document.createElement("div");
      while (wrap.firstChild) left.appendChild(wrap.firstChild);
      wrap.appendChild(left);
      wrap.classList.add("hero-split");
      flowChain(wrap);
    }
    if (page === "agent") {
      const id = Number(document.querySelector("main").dataset.id);
      // Live: only the demo agent's page can pay, with the server-side test wallet. Mock: any agent.
      // Payments off: say so on every agent page, as Developers does, instead of leaving the control silently missing.
      const title = document.querySelector("#h-tl")?.parentElement;
      if (!DC.mock && !DC.NET.testnet) {
        // Mainnet has no pay button: point at the recorded call and receipt, and at Fuji for a live one.
        const last = DC.state.history[id]?.at(-1), rc = DC.state.receipts.find((r) => r.agent === id);
        const rec = [last && `Last call ${DC.hashLink(last.tx, 6, 4)}`, rc && `latest receipt <a href="/receipt/${rc.n}" style="color:var(--mint)">${DC.fmt.no(rc.n)}</a>`].filter(Boolean).join(" · ");
        title?.insertAdjacentHTML("beforeend", `<span class="demo-off">${rec ? `${rec}. ` : ""}To pay one call yourself, switch to <a href="/agent?network=fuji" style="color:var(--mint)">Fuji testnet</a> (test USDC).</span>`);
        return;
      }
      if (!DC.mock && !DC.demoReady) {
        title?.insertAdjacentHTML("beforeend", `<span class="demo-off">Live payments from this page are switched off on this deployment.</span>`);
        return;
      }
      if (!DC.mock && DC.demoAgentId !== id) return;
      title?.insertAdjacentHTML("beforeend", `<button class="btn btn-primary btn-sm" id="payOne" type="button">Pay one call as #${id}</button>`);
      const btn = document.getElementById("payOne");
      btn?.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          const c = await DC.payOnce(id);
          DC.toast(c.simulated
            ? `Paid $${(c.price / 1e6).toFixed(3)} + ${DC.fmt.usd(c.sur, 5)} carbon · +${(c.mg / 1000).toFixed(2)} g`
            : `Paid on ${DC.NET.short}: +${(c.mg / 1000).toFixed(2)} g. Recorded on-chain with the next meter batch.`);
        } catch (e) {
          // A server refusal carries its own message; anything else is a bug, never shown raw.
          DC.toast(e instanceof TypeError || !e?.message ? "Payment could not be sent. Nothing was paid." : e.message);
        } finally {
          btn.disabled = false;
        }
      });
    }
  }
  start();
}
