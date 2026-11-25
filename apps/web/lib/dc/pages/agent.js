export default function init(DC) {
  const { state, fmt, AGENTS, agentById, THRESHOLD_MG, hashLink, on } = DC;
  const $ = (s) => document.querySelector(s);
  const id = Number(document.querySelector("main").dataset.id) || 0;
  const a = agentById(id);

  const registered = { true: `ERC-8004 agent #${id}`, false: "Not in the ERC-8004 registry" }[document.querySelector("main").dataset.registered];
  $("#eb").textContent = DC.mock ? `Simulated agent #${a.id} · rehearsal only` : registered ? `${registered} · ${DC.NET.name}` : DC.NET.name;
  $("#name").textContent = id || !DC.failed ? a.title : "Agent";
  $("#meta").innerHTML = [
    a.payer && `<div><dt>Wallet</dt><dd>${DC.addrLink(a.payer)}</dd></div>`,
    state.history[a.id]?.length && `<div><dt>First paid call</dt><dd>${fmt.date(state.history[a.id][0].t)}</dd></div>`,
    a.model && `<div><dt>Model class</dt><dd>${DC.FACTORS.models[a.model].label}</dd></div>`,
  ].filter(Boolean).join("");
  $("#tabs").innerHTML = AGENTS.filter((x) => x.id === a.id || state.history[x.id]?.length).map((x) => `<a href="/agent/${x.id}" aria-current="${x.id === a.id}">#${x.id} ${x.name}</a>`).join("");

  function paint() {
    if (DC.failed) {
      $("#note").textContent = DC.READ_FAILED;
      $("#stats").innerHTML = ["Paid calls", "Carbon metered", DC.RETIRED, "Surcharge paid"].map((k) => `<div class="card stat"><div class="k">${k}</div><div class="v">–</div><div class="n">not read</div></div>`).join("");
      $("#toGo").textContent = "–";
      $("#nxNote").textContent = DC.READ_FAILED;
      DC.scaleBar($("#scale"), 0);
      $("#rc").innerHTML = `<tr><td colspan="5" class="muted">${DC.READ_FAILED}</td></tr>`;
      return;
    }
    const ac = state.acct[a.id], rs = state.receipts.filter((r) => r.agent === a.id);
    // No calls: one card with where to go next instead of zero stats, an empty timeline and empty tables.
    const empty = !ac.calls;
    document.querySelector("main").toggleAttribute("data-empty", empty);
    $("#empty").hidden = !empty;
    if (empty) paintEmpty();
    const retiredMg = rs.reduce((s, r) => s + r.mg, 0);
    $("#note").textContent = a.note || (ac.calls ? `Pays a demo x402 API on ${DC.NET.short}; our meter batches the surcharges into the pool.` : "No calls recorded by this pool.");
    $("#stats").innerHTML = [
      ["Paid calls", fmt.count(ac.calls), "", "reported by the trusted meter", ""],
      ["Carbon metered", fmt.g(ac.mg, 1), "g", "CO₂e, mid estimate", ""],
      [DC.RETIRED, fmt.count(retiredMg / 1e6), "kg", `${rs.length} soulbound receipts`, "bar-mint"],
      ["Surcharge paid", fmt.usd(ac.sur, 3), "", `${DC.TOKEN.symbol}, pulled into the pool in batches`, ""],
    ].map(([k, v, u, n, c]) => `<div class="card stat ${c}"><div class="k">${k}</div><div class="v tnum">${v}${u ? `<span class="u">${u}</span>` : ""}</div><div class="n">${n}</div></div>`).join("");
    // Hero: the next receipt forming. Receipt numbers are global, so the next one is the highest minted + 1.
    const p = Math.min(state.pending[a.id] || 0, THRESHOLD_MG);
    const next = state.receipts.reduce((m, r) => Math.max(m, r.n), 0) + 1;
    const since = rs.length ? ` since ${fmt.no(rs[0].n)}` : " so far";
    $("#toGo").textContent = fmt.count(Math.round((THRESHOLD_MG - p) / 1000));
    $("#nxNo").textContent = fmt.no(next);
    $("#nxFill").style.height = `${(p / THRESHOLD_MG) * 100}%`;
    $("#nxNote").textContent = `${fmt.mass(p)} of ${fmt.mass(THRESHOLD_MG)} metered${since}. Mints as a soulbound ${DC.NET.testnet ? "testnet " : ""}receipt${DC.UNBACKED ? " (mock credit)" : ""} at ${fmt.mass(THRESHOLD_MG)}.`;
    DC.scaleBar($("#scale"), p);
    $("#rc").innerHTML = rs.map((r) => `<tr><td><a href="/receipt/${r.n}" class="mono" style="color:var(--mint)">${fmt.no(r.n)}</a></td><td class="muted">${fmt.dt(r.t)}</td><td class="r">${fmt.mass(r.mg)}</td><td class="r">${fmt.count(r.calls)}</td><td class="r">${hashLink(r.tx)}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">No receipts yet.</td></tr>`;
  }
  function paintEmpty() {
    const metered = AGENTS.filter((x) => x.id !== a.id && state.acct[x.id]?.calls).sort((x, y) => state.acct[y.id].calls - state.acct[x.id].calls);
    const top = metered[0];
    const label = (x) => `#${x.id}${x.title !== `Agent #${x.id}` ? ` (${x.name})` : ""}`;
    const facts = (x) => { const n = state.receipts.filter((r) => r.agent === x.id).length; return `${fmt.count(state.acct[x.id].calls)} calls, ${fmt.count(n)} ${DC.NET.testnet ? "testnet " : ""}receipt${n === 1 ? "" : "s"}`; };
    const who = !top ? `No agent has been metered on ${DC.NET.short} yet.`
      : metered.length === 1 ? `The only agent metered so far is ${label(top)}: ${facts(top)}.`
      : `${metered.length} agents have been metered so far; the most active is ${label(top)}: ${facts(top)}.`;
    $("#emEb").textContent = `Agent #${a.id} · ${DC.NET.name}`;
    $("#emNote").textContent = `This pool has recorded no x402 calls for agent #${a.id}, so there is no footprint, timeline or receipt to show. ${who}`;
    $("#emActs").innerHTML = `${top ? `<a class="btn btn-primary" href="/agent/${top.id}">Open agent #${top.id}</a>` : ""}<a class="btn btn-outline" href="/developers">How an agent gets metered</a>`;
  }
  paint();

  // ---------- footprint timeline ----------
  const host = $("#tl"), cv = $("#tlc"), ctx = cv.getContext("2d"), tip = $("#tip");
  let W, H, pts = [], hover = null, colors;
  const fresh = new Map();
  function readColors() { const cs = getComputedStyle(document.documentElement); colors = Object.fromEntries(["--smoke", "--mint", "--avax", "--line", "--text-3", "--mint-glow", "--font-mono"].map((k) => [k, cs.getPropertyValue(k).trim()])); }
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
    ctx.font = `500 11px ${colors["--font-mono"]}, monospace`; ctx.textAlign = "center";
    Object.entries(groups).forEach(([n, xs]) => {
      const x0 = Math.min(...xs) - 4, x1 = Math.max(...xs) + 4;
      ctx.fillStyle = colors["--mint-glow"]; ctx.globalAlpha = 0.35; ctx.fillRect(x0, 34, x1 - x0, H - 50); ctx.globalAlpha = 1;
      ctx.fillStyle = colors["--mint"]; ctx.fillRect(x0, 34, x1 - x0, 2);
      ctx.fillText(fmt.no(Number(n)), (x0 + x1) / 2, 24);
    });
    // axis
    ctx.strokeStyle = colors["--line"]; ctx.beginPath(); ctx.moveTo(20, H - 14); ctx.lineTo(W - 20, H - 14); ctx.stroke();
    if (!pts.length) {
      ctx.fillStyle = colors["--text-3"]; ctx.textAlign = "center"; ctx.fillText(DC.failed ? DC.READ_FAILED : "No paid calls from this agent yet", W / 2, H / 2);
      return;
    }
    ctx.fillStyle = colors["--text-3"]; ctx.textAlign = "left"; ctx.fillText(`first call · ${fmt.date(pts[0].c.t)}`, 20, H - 2); ctx.textAlign = "right"; ctx.fillText(`call ${fmt.count(pts.length)} · ${DC.isFresh() ? "now" : `last ${DC.ago(pts[pts.length - 1].c.t)}`}`, W - 20, H - 2);
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
  }
  // The timeline is still between changes: draw once per change instead of every frame.
  let queued = false;
  const redraw = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; draw(); }); };
  function pick(e, reach) {
    const r = host.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bd = reach;
    for (const p of pts) { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = p; } }
    if (best !== hover) redraw();
    hover = best;
    if (best) {
      tip.innerHTML = `<div class="mono dim">${fmt.dt(best.c.t)}</div><div style="margin-top:3px"><b>${(best.c.mg / 1000).toFixed(2)} g</b> CO₂e · ${best.c.receipt ? `<span style="color:var(--mint)">covered by ${fmt.no(best.c.receipt)}</span>` : '<span class="dim">pending</span>'}</div><div class="mono" style="color:var(--avax);margin-top:3px">${DC.short(best.c.tx, 10, 6)} ↗</div>`;
      tip.style.left = best.x + "px"; tip.style.top = best.y + "px"; tip.classList.add("on");
    } else tip.classList.remove("on");
  }
  // Mouse: hover shows the tooltip, click opens the tx. Touch: the first tap on a dot shows it, a second tap opens it.
  let touchOpen = true;
  host.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") pick(e, 18); });
  host.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") { touchOpen = true; return; }
    const prev = hover;
    pick(e, 24);
    touchOpen = Boolean(prev && hover === prev);
  });
  host.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") { hover = null; tip.classList.remove("on"); redraw(); } });
  host.addEventListener("click", () => { if (hover && touchOpen && !DC.mock) window.open(`${DC.NET.explorer}/tx/${hover.c.tx}`, "_blank"); });
  readColors(); build(); redraw();
  new ResizeObserver(() => { build(); redraw(); }).observe(host);
  // Labels switch to the mono web font once it loads; the "last … ago" label ages.
  document.fonts?.ready.then(redraw);
  setInterval(redraw, 30_000);

  on("accrual", (c) => { if (c.agent !== a.id) return; fresh.set(c.tx, performance.now()); build(); paint(); redraw(); setTimeout(redraw, 2450); });
  on("retired", (r) => {
    if (r.agent !== a.id) return;
    build(); paint(); redraw();
    const s = $("#settled"); if (s.classList.contains("sparkle")) { s.classList.remove("go"); void s.offsetWidth; s.classList.add("go"); }
    DC.toast(`${DC.mock ? "Simulated: receipt" : "Receipt"} ${fmt.no(r.n)} minted${DC.UNBACKED ? " (mock lot, no ERC-8004 feedback)" : ""}`);
  });
}
