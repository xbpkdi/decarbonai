/* Interactions: fan lines, terminal proof on Developers, stats strip, Methodology flow chain,
   Agent "pay one call". Runs after rich.js. */
export default function init(DC) {
  const page = document.querySelector("main")?.dataset.page || "index";
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  // ---------- fan lines: many agent points converge on one pool point and turn green ----------
  function fanLines(host, { onSolid = false, target = [0.86, 0.5], count = 64, seed = 3 } = {}) {
    const c = document.createElement("canvas");
    c.className = "fan";
    c.setAttribute("aria-hidden", "true");
    host.prepend(c);
    const ctx = c.getContext("2d");
    let W = 0, H = 0, mx = -1e4, my = -1e4, lines = [], pulses = [], visible = true, colA, colB, t = 0;
    let s = seed * 9301;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    function size() {
      const r = host.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
      W = r.width; H = r.height; c.width = W * dpr; c.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      s = seed * 9301;
      lines = Array.from({ length: count }, () => {
        const edge = rnd();
        const x = edge < 0.55 ? rnd() * W * 0.55 : rnd() * W * 0.08;
        const y = edge < 0.55 ? (rnd() < 0.5 ? -10 + rnd() * H * 0.2 : H * 0.8 + rnd() * H * 0.2) : rnd() * H;
        return { x, y, bend: (rnd() - 0.5) * H * 0.5 };
      });
      pulses = Array.from({ length: 9 }, () => ({ i: Math.floor(rnd() * count), p: rnd(), v: 0.18 + rnd() * 0.22 }));
      colA = onSolid ? "rgba(20,26,6," : "rgba(125,133,128,";
      colB = onSolid ? "rgba(20,26,6," : `rgba(${css("--mint-rgb")},`;
    }
    const pt = (L, k) => {
      const tx = W * target[0], ty = H * target[1];
      let cx = (L.x + tx) / 2, cy = (L.y + ty) / 2 + L.bend;
      // the cursor pulls each line's bend a little
      const d = Math.hypot(cx - mx, cy - my), f = Math.max(0, 1 - d / 260) * 0.35;
      cx += (mx - cx) * f; cy += (my - cy) * f;
      const u = 1 - k;
      return [u * u * L.x + 2 * u * k * cx + k * k * tx, u * u * L.y + 2 * u * k * cy + k * k * ty];
    };
    function draw(dt) {
      ctx.clearRect(0, 0, W, H);
      ctx.lineWidth = 1;
      const seg = 4;
      for (const L of lines) {
        for (let b = 0; b < seg; b++) {
          ctx.beginPath();
          for (let j = 0; j <= 6; j++) { const k = (b + j / 6) / seg; const [x, y] = pt(L, k); j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
          const k = (b + 0.5) / seg;
          ctx.strokeStyle = k < 0.55 ? colA + (onSolid ? 0.1 : 0.22) * (0.6 + k) + ")" : colB + (onSolid ? 0.28 : 0.55) * k + ")";
          ctx.stroke();
        }
      }
      // pulses travel toward the pool
      for (const P of pulses) {
        P.p += P.v * dt; if (P.p > 1) { P.p = 0; P.i = Math.floor(Math.random() * lines.length); }
        const [x, y] = pt(lines[P.i], P.p);
        ctx.fillStyle = P.p < 0.55 ? colA + "0.8)" : colB + "1)";
        ctx.beginPath(); ctx.arc(x, y, P.p < 0.55 ? 1.6 : 2.4, 0, 7); ctx.fill();
      }
      // the pool point
      const tx = W * target[0], ty = H * target[1];
      ctx.fillStyle = colB + (onSolid ? "0.5)" : "0.9)");
      ctx.beginPath(); ctx.arc(tx, ty, 5 + Math.sin(t * 2) * 1.2, 0, 7); ctx.fill();
      ctx.strokeStyle = colB + "0.35)"; ctx.beginPath(); ctx.arc(tx, ty, 14 + Math.sin(t * 2) * 2, 0, 7); ctx.stroke();
    }
    let last = performance.now();
    function loop(now) {
      const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
      if (visible) draw(reduced ? 0 : dt);
      if (!reduced) requestAnimationFrame(loop);
    }
    size(); requestAnimationFrame(loop);
    new ResizeObserver(size).observe(host);
    new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(host);
    host.addEventListener("pointermove", (e) => { const r = host.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top; });
    host.addEventListener("pointerleave", () => { mx = my = -1e4; });
  }

  // ---------- stats strip ----------
  function statsStrip(afterEl) {
    const { state } = DC;
    const el = document.createElement("section");
    el.className = "strip";
    el.setAttribute("aria-label", "Network totals");
    const cells = [
      ["Paid calls", () => state.calls, 0, ""],
      ["g CO₂e retired", () => state.retiredMg / 1000, 0, "lime"],
      ["Receipts sealed", () => state.receipts.length, 0, ""],
      ["Agents settling", () => DC.AGENTS.length, 0, ""],
    ];
    el.innerHTML = `<div class="wrap strip-in">${cells.map(([k, , , c], i) => `<div class="cell ${c}"><span class="odo" data-i="${i}"></span><span class="k">${k}</span></div>`).join("")}</div>`;
    afterEl.after(el);
    const odos = cells.map(([, f, d], i) => DC.odometer(el.querySelector(`[data-i="${i}"]`), { decimals: d, value: 0 }));
    const paint = () => cells.forEach(([, f], i) => odos[i].set(f()));
    // roll up from zero once the strip is on screen
    new IntersectionObserver(([e], o) => { if (e.isIntersecting) { setTimeout(paint, 120); o.disconnect(); } }, { threshold: 0.3 }).observe(el);
    DC.on("accrual", paint); DC.on("retired", paint);
  }

  // ---------- Developers: Claude Code terminal proof in the hero ----------
  function terminal(host) {
    const term = document.createElement("div");
    term.className = "term";
    term.innerHTML = `<div class="term-bar"><i></i><i></i><i></i><span>claude · ~/research-agent</span><button class="term-replay" type="button">Replay</button></div><div class="term-body" aria-live="polite"></div>`;
    host.appendChild(term);
    const body = term.querySelector(".term-body");
    const { fmt } = DC;
    let run = 0;
    async function play() {
      const id = ++run;
      const wait = (ms) => new Promise((r) => setTimeout(r, reduced ? 0 : ms));
      const alive = () => id === run;
      // Live: replays the latest real CarbonAccrued. Mock: a simulated call that also feeds the stream.
      const last = DC.mock ? null : DC.state.feed[0];
      const agentId = last ? last.agent : 42;
      const mg = last ? last.mg : Math.round(DC.gramsPerCall("claude-sonnet", 3000, 1500).g * 1000 * (0.92 + Math.random() * 0.16));
      const sur = last ? last.sur : DC.surchargeFor(mg), tx = last ? last.tx : DC.hex(32);
      body.innerHTML = `<div class="ln"><span class="pr">&gt;</span> <span class="typed"></span><span class="caret"></span></div>`;
      const typed = body.querySelector(".typed");
      const prompt = 'Use paid_inference to summarise "x402 on Avalanche" for my notes';
      for (let i = 0; i <= prompt.length && alive(); i++) { typed.textContent = prompt.slice(0, i); await wait(22); }
      body.querySelector(".caret").remove();
      const out = [
        [500, `<span class="tool">⏺ decarbonai · paid_inference</span> <span class="dim">(MCP)</span>`],
        [700, `<span class="br">⎿</span> GET /v1/infer?model=claude-sonnet`],
        [600, `<span class="br">⎿</span> <span class="warn">402 Payment Required</span>  $0.010 + <span class="red">${fmt.usd(sur, 5)} carbon</span> <span class="dim">(${(mg / 1000).toFixed(2)} g CO₂e)</span>`],
        [800, `<span class="br">⎿</span> signed x402 payment · agent #${agentId} · ${DC.NET.testnet ? "test USDC" : "USDC"}`],
        [1100, `<span class="br">⎿</span> settled on ${DC.NET.name}  <span class="red">${DC.short(tx, 8, 6)} ↗</span>`],
        [500, `<span class="br">⎿</span> <span class="lime">CarbonAccrued +${(mg / 1000).toFixed(2)} g</span> · pool ${fmt.count(Math.round(Math.min((DC.state.pending[agentId] || 0) + (last ? 0 : mg), DC.THRESHOLD_MG) / 1000))} / ${fmt.count(DC.THRESHOLD_MG / 1000)} g`],
        [700, `<span class="tool">⏺</span> x402 lets an agent pay per request inside HTTP: the server answers 402 with a price, the agent signs a USDC transfer, a facilitator settles it on Avalanche…`],
      ];
      for (const [ms, html] of out) {
        await wait(ms); if (!alive()) return;
        body.insertAdjacentHTML("beforeend", `<div class="ln in">${html}</div>`);
        if (DC.mock && html.includes("settled")) DC.payOnce(42);
      }
      await wait(9000); if (alive()) play();
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
        ["On-chain", `${DC.fmt.count(mg)} mg in CarbonAccrued`, "red"],
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
    if (foot) fanLines(foot, { onSolid: true, target: [0.58, 0.52], count: 48, seed: 7 });

    if (page === "developers") {
      const head = document.querySelector(".page-head");
      head.classList.add("has-fan", "dev-hero");
      fanLines(head, { target: [0.97, 0.62], count: 70, seed: 3 });
      const wrap = head.querySelector(".wrap");
      const left = document.createElement("div");
      while (wrap.firstChild) left.appendChild(wrap.firstChild);
      wrap.appendChild(left);
      wrap.classList.add("hero-split");
      terminal(wrap);
    }
    if (["receipts", "methodology"].includes(page)) {
      statsStrip(document.querySelector(".page-head"));
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
      if (!DC.mock && DC.demoAgentId !== id) return;
      const title = document.querySelector("#h-tl")?.parentElement;
      if (!DC.mock && !DC.demoReady) {
        title?.insertAdjacentHTML("beforeend", `<span class="demo-off">Live payments from this page are switched off on this deployment.</span>`);
        return;
      }
      title?.insertAdjacentHTML("beforeend", `<button class="btn btn-primary btn-sm" id="payOne" type="button">Pay one call as #${id}</button>`);
      const btn = document.getElementById("payOne");
      btn?.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          const c = await DC.payOnce(id);
          DC.toast(c.simulated
            ? `Paid $${(c.price / 1e6).toFixed(3)} + ${DC.fmt.usd(c.sur, 5)} carbon · +${(c.mg / 1000).toFixed(2)} g`
            : `Paid on ${DC.NET.short}: +${(c.mg / 1000).toFixed(2)} g. CarbonAccrued lands with the next meter batch.`);
        } catch (e) {
          DC.toast(e.message);
        } finally {
          btn.disabled = false;
        }
      });
    }
  }
  start();
}
