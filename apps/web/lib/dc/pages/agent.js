export default function init(DC) {
  const { state, fmt, AGENTS, agentById, THRESHOLD_MG, hashLink, on } = DC;
  const $ = (s) => document.querySelector(s);
  const id = Number(document.querySelector("main").dataset.id) || 0;
  const a = agentById(id);

  $("#eb").textContent = `ERC-8004 agent #${a.id} · ${DC.NET.name}`;
  $("#name").textContent = a.title;
  $("#note").textContent = a.note;
  $("#meta").innerHTML = [
    a.payer && `<div><dt>Wallet</dt><dd>${DC.addrLink(a.payer)}</dd></div>`,
    state.history[a.id]?.length && `<div><dt>First paid call</dt><dd>${fmt.date(state.history[a.id][0].t)}</dd></div>`,
    a.model && `<div><dt>Model class</dt><dd>${DC.FACTORS.models[a.model].label}</dd></div>`,
  ].filter(Boolean).join("");
  $("#tabs").innerHTML = AGENTS.filter((x) => x.id === a.id || state.history[x.id]?.length).map((x) => `<a href="/agent/${x.id}" aria-current="${x.id === a.id}">#${x.id} ${x.name}</a>`).join("");

  function paint() {
    const ac = state.acct[a.id], rs = state.receipts.filter((r) => r.agent === a.id);
    const retiredMg = rs.reduce((s, r) => s + r.mg, 0);
    $("#repN").textContent = rs.length;
    $("#stats").innerHTML = [
      ["Paid calls", fmt.count(ac.calls), "", "metered through x402", ""],
      ["Carbon metered", fmt.g(ac.mg, 0), "g", "CO₂e, mid estimate", ""],
      ["Retired", fmt.count(retiredMg / 1e6), "kg", `${rs.length} soulbound receipts`, "bar-mint"],
      ["Surcharge paid", fmt.usd(ac.sur, 3), "", "USDC into the pool", ""],
    ].map(([k, v, u, n, c]) => `<div class="card stat ${c}"><div class="k">${k}</div><div class="v tnum">${v}${u ? `<span class="u">${u}</span>` : ""}</div><div class="n">${n}</div></div>`).join("");
    const p = Math.min(state.pending[a.id], THRESHOLD_MG);
    $("#toGo").textContent = fmt.count(Math.round((THRESHOLD_MG - p) / 1000));
    DC.scaleBar($("#scale"), p);
    $("#rc").innerHTML = rs.map((r) => `<tr><td><a href="/receipt/${r.n}" class="mono" style="color:var(--mint)">${fmt.no(r.n)}</a></td><td class="muted">${fmt.dt(r.t)}</td><td class="r">${fmt.mass(r.mg)}</td><td class="r">${fmt.count(r.calls)}</td><td class="r">${hashLink(r.tx)}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">No receipts yet.</td></tr>`;
  }
  paint();

  // ---------- footprint timeline ----------
  const host = $("#tl"), cv = $("#tlc"), ctx = cv.getContext("2d"), tip = $("#tip");
  let W, H, pts = [], hover = null, colors;
  const fresh = new Map();
  function readColors() { const cs = getComputedStyle(document.documentElement); colors = Object.fromEntries(["--smoke", "--mint", "--avax", "--line", "--text-3", "--mint-glow"].map((k) => [k, cs.getPropertyValue(k).trim()])); }
  function rnd(i) { const x = Math.sin(i * 12.9898) * 43758.5453; return x - Math.floor(x); }
  function build() {
    const r = host.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    W = r.width; H = r.height; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // x is call order, not time, so the pending calls since the last seal get their fair width.
    const h = state.history[a.id] || [], pad = 28, span = Math.max(1, h.length - 1 + 6);
    pts = h.map((c, i) => ({ c, x: pad + (i / span) * (W - pad * 2), y: H * 0.56 + (rnd(i) - 0.5) * H * 0.44 }));
  }
  function draw() {
    ctx.clearRect(0, 0, W, H);
    // retired bands
    const groups = {};
    pts.forEach((p) => { if (p.c.receipt) (groups[p.c.receipt] ||= []).push(p.x); });
    ctx.font = "500 11px JetBrains Mono, monospace"; ctx.textAlign = "center";
    Object.entries(groups).forEach(([n, xs]) => {
      const x0 = Math.min(...xs) - 4, x1 = Math.max(...xs) + 4;
      ctx.fillStyle = colors["--mint-glow"]; ctx.globalAlpha = 0.35; ctx.fillRect(x0, 34, x1 - x0, H - 50); ctx.globalAlpha = 1;
      ctx.fillStyle = colors["--mint"]; ctx.fillRect(x0, 34, x1 - x0, 2);
      ctx.fillText(fmt.no(Number(n)), (x0 + x1) / 2, 24);
    });
    // axis
    ctx.strokeStyle = colors["--line"]; ctx.beginPath(); ctx.moveTo(20, H - 14); ctx.lineTo(W - 20, H - 14); ctx.stroke();
    if (!pts.length) {
      ctx.fillStyle = colors["--text-3"]; ctx.textAlign = "center"; ctx.fillText("No paid calls from this agent yet", W / 2, H / 2);
      requestAnimationFrame(draw);
      return;
    }
    ctx.fillStyle = colors["--text-3"]; ctx.textAlign = "left"; ctx.fillText(`first call · ${fmt.date(pts[0].c.t)}`, 20, H - 2); ctx.textAlign = "right"; ctx.fillText(`call ${fmt.count(pts.length)} · now`, W - 20, H - 2);
    const now = performance.now();
    pts.forEach((p) => {
      const f = fresh.get(p.c.tx);
      if (p.c.receipt) {
        ctx.fillStyle = colors["--mint"]; ctx.globalAlpha = 0.85;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.PI / 4); ctx.fillRect(-2.2, -2.2, 4.4, 4.4); ctx.restore();
      } else {
        ctx.fillStyle = f && now - f < 2400 ? colors["--avax"] : colors["--smoke"]; ctx.globalAlpha = 0.75;
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.4, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
    });
    if (hover) { ctx.strokeStyle = colors["--mint"]; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(hover.x, hover.y, 7, 0, 7); ctx.stroke(); }
    requestAnimationFrame(draw);
  }
  host.addEventListener("pointermove", (e) => {
    const r = host.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bd = 18;
    for (const p of pts) { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = p; } }
    hover = best;
    if (best) {
      tip.innerHTML = `<div class="mono dim">${fmt.dt(best.c.t)}</div><div style="margin-top:3px"><b>${(best.c.mg / 1000).toFixed(2)} g</b> CO₂e · ${best.c.receipt ? `<span style="color:var(--mint)">retired in ${fmt.no(best.c.receipt)}</span>` : '<span class="dim">pending</span>'}</div><div class="mono" style="color:var(--avax);margin-top:3px">${DC.short(best.c.tx, 10, 6)} ↗</div>`;
      tip.style.left = best.x + "px"; tip.style.top = best.y + "px"; tip.classList.add("on");
    } else tip.classList.remove("on");
  });
  host.addEventListener("pointerleave", () => { hover = null; tip.classList.remove("on"); });
  host.addEventListener("click", () => { if (hover) window.open(`${DC.NET.explorer}/tx/${hover.c.tx}`, "_blank"); });
  readColors(); build(); requestAnimationFrame(draw);
  new ResizeObserver(build).observe(host);

  on("accrual", (c) => { if (c.agent !== a.id) return; fresh.set(c.tx, performance.now()); build(); paint(); });
  on("retired", (r) => {
    if (r.agent !== a.id) return;
    build(); paint();
    const s = $("#settled"); s.classList.remove("go"); void s.offsetWidth; s.classList.add("go");
    DC.toast(`New ERC-8004 feedback: carbon-settled, ${fmt.no(r.n)}`);
  });
}
