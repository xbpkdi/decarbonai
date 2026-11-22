/* Live dashboard: odometer, pool scale bar, Capture canvas scene, tx feed, latest receipt + seal. */
export default function init(DC) {
  const { state, fmt, agentById, THRESHOLD_MG, hashLink, coinHTML, on, reduced } = DC;
  const $ = (s) => document.querySelector(s);
  const F = DC.FEATURED; // the agent whose pool fills on stage
  const pending = () => state.pending[F] || 0;
  const fa = agentById(F);
  $("#poolAgent").innerHTML = `${fa.name} <span class="mono dim">#${fa.id}</span>`;
  $("#poolAgentLink").href = `/agent/${fa.id}`;
  $("#lblAgent").textContent = fa.id ? `ERC-8004 #${fa.id}` : "x402 payer";
  if (!DC.mock) {
    $("#lblVia").textContent = fa.title;
    $(".feed th.c-res").textContent = "Payer";
    $(".feed th.c-price").textContent = "Block";
  }

  // ---------- hero + pool ----------
  const big = DC.odometer($("#big"), { decimals: 1, value: state.totalMg / 1000 });
  const togo = DC.odometer($("#togo"), { value: Math.round((THRESHOLD_MG - pending()) / 1000) });
  let retiring = false;

  function paintHero() {
    $("#line").innerHTML = `captured from <b>${fmt.count(state.calls)}</b> paid x402 calls · <b class="mint">${fmt.mass(state.retiredMg)}</b> retired · <b>${fmt.usd(state.surcharge, 2)}</b> carbon surcharge`;
  }
  function paintPool() {
    const p = Math.min(pending(), THRESHOLD_MG);
    togo.set(Math.max(0, Math.round((THRESHOLD_MG - p) / 1000)));
    DC.scaleBar($("#scale"), p);
    $("#pooled").textContent = `${fmt.mass(p)} of 1 kg pooled`;
    $("#lbl-pool").innerHTML = `<span class="mint">${fmt.g(p, 0)}</span> / 1,000 g`;
  }
  // Big numbers roll at most every 600 ms so a 100-call burst stays readable.
  let heroQueued = false;
  function queueHero() {
    if (heroQueued) return;
    heroQueued = true;
    setTimeout(() => { heroQueued = false; big.set(state.totalMg / 1000); paintHero(); paintPool(); }, 600);
  }
  paintHero(); paintPool();

  // ---------- feed ----------
  const feed = $("#feed");
  function row(c, fresh) {
    const a = agentById(c.agent);
    const tr = document.createElement("tr");
    if (fresh) tr.className = "new";
    tr.innerHTML = `<td class="c-time mono dim"><span class="tick${fresh ? " hot" : ""}"></span>${fmt.time(c.t)}</td>
      <td class="agent">${a.name} <span class="dim mono">#${a.id}</span></td>
      <td class="c-res mono dim">${DC.mock ? c.res : DC.short(c.payer)}</td>
      <td class="r c-price">${DC.mock ? fmt.usd(c.price, 3) : `<span class="mono dim">${fmt.count(c.block)}</span>`}</td>
      <td class="r"><b style="font-weight:600">${(c.mg / 1000).toFixed(2)}</b> <span class="dim">g</span></td>
      <td class="r c-sur">${fmt.usd(c.sur, 5)}</td>
      <td class="r">${hashLink(c.tx, 6, 4)}</td>`;
    return tr;
  }
  state.feed.slice(0, 14).forEach((c) => feed.appendChild(row(c, false)));
  function pushRow(c) {
    const tr = row(c, true);
    feed.prepend(tr);
    // red tick cools to grey
    requestAnimationFrame(() => requestAnimationFrame(() => tr.querySelector(".tick").classList.remove("hot")));
    while (feed.children.length > 14) feed.lastChild.remove();
  }

  // ---------- latest receipt ----------
  function paintLatest(r, stamp) {
    if (!r) {
      $("#latest").innerHTML = `<div class="coin-wrap" style="opacity:.35">${coinHTML({ n: 0, mg: THRESHOLD_MG }, { seal: false })}</div>
        <div style="min-width:0"><span class="eyebrow">Latest receipt · soulbound</span><h2 id="h-latest" style="margin-top:6px">No receipt yet</h2>
        <p class="muted" style="margin-top:10px;font-size:14px">The first receipt is minted when an agent's pool reaches ${fmt.mass(THRESHOLD_MG)}.</p></div>`;
      $("#lbl-seal").textContent = "First seal at 1 kg";
      return;
    }
    const a = agentById(r.agent);
    $("#latest").innerHTML = `<div class="coin-wrap">${coinHTML(r)}</div>
      <div style="min-width:0">
        <span class="eyebrow">Latest receipt · soulbound</span>
        <h2 id="h-latest" style="margin-top:6px">${fmt.no(r.n)}</h2>
        <dl>
          <dt>Retired</dt><dd><b style="color:var(--mint)">${fmt.mass(r.mg)} CO₂e</b></dd>
          <dt>Agent</dt><dd>${a.name} <span class="mono dim">#${a.id}</span></dd>
          <dt>Calls covered</dt><dd class="tnum">${fmt.count(r.calls)} paid x402 calls</dd>
          <dt>Credit</dt><dd>DCO2 lot ${r.lot}${DC.NET.testnet ? ' <span class="pill pill-mock" style="height:20px;font-size:11px">mock</span>' : ""}</dd>
          <dt>Tx</dt><dd>${hashLink(r.tx, 8, 6)}</dd>
        </dl>
        <div class="acts"><a class="btn btn-primary btn-sm" href="/receipt/${r.n}">Open receipt</a><a class="btn btn-outline btn-sm" href="/receipts">All receipts</a></div>
      </div>`;
    $("#lbl-seal").innerHTML = `Receipt <span class="red">${fmt.no(r.n)}</span>`;
    if (stamp && window.gsap && !reduced) {
      const seal = $("#latest .seal");
      gsap.fromTo(seal, { scale: 2.4, rotate: -40, opacity: 0 }, { scale: 1, rotate: -12, opacity: 1, duration: 0.7, ease: "back.out(2.2)" });
      gsap.fromTo("#latest", { boxShadow: "0 0 0 0 rgba(232,65,66,0.6)" }, { boxShadow: "0 0 0 18px rgba(232,65,66,0)", duration: 0.9, ease: "power2.out" });
      gsap.fromTo("#latest .coin", { scale: 0.7, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.6, ease: "back.out(1.6)" });
    }
  }
  paintLatest(state.receipts.find((r) => r.agent === F) || state.receipts[0], false);

  // ---------- Capture scene (canvas 2D) ----------
  const canvas = $("#scene"), ctx = canvas.getContext("2d");
  const host = canvas.parentElement;
  let W = 0, H = 0, dpr = 1, nodes = [], R = 60, colors = {};
  const particles = [], rings = [], crystals = [], coins = [];
  let level = Math.min(1, pending() / THRESHOLD_MG), bump = 0, flash = 0, sealFlash = 0;

  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    colors = { line: v("--line-2"), text: v("--text"), text3: v("--text-3"), mint: v("--mint"), avax: v("--avax"), surface: v("--surface"), tile: v("--tile") };
  }
  function layout() {
    const r = host.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = r.width; H = r.height;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const narrow = W < 640;
    if (narrow) {
      // Phone: a zig-zag so the vessel stays large.
      nodes = [{ x: W * 0.22, y: H * 0.2 }, { x: W * 0.72, y: H * 0.2 }, { x: W * 0.32, y: H * 0.62 }, { x: W * 0.78, y: H * 0.62 }];
      R = Math.min(64, W * 0.17);
    } else {
      const cy = H * 0.44;
      nodes = [{ x: W * 0.08, y: cy }, { x: W * 0.31, y: cy }, { x: W * 0.62, y: cy }, { x: W * 0.9, y: cy }];
      R = Math.max(36, Math.min(H * 0.3, W * 0.07));
    }
    document.querySelectorAll(".node-label").forEach((el) => {
      const i = Number(el.dataset.node), n = nodes[i];
      const off = i === 2 ? R + 14 : 34;
      el.style.left = n.x + "px"; el.style.top = n.y + off + "px";
      el.style.width = narrow ? "150px" : "220px";
    });
  }

  // point along agent -> x402 -> pool, s in [0,1]
  function along(s) {
    const a = nodes[0], b = nodes[1], c = nodes[2];
    const l1 = Math.hypot(b.x - a.x, b.y - a.y), l2 = Math.hypot(c.x - b.x, c.y - b.y);
    const d = s * (l1 + l2);
    if (d <= l1) { const k = d / l1; return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, nx: -(b.y - a.y) / l1, ny: (b.x - a.x) / l1 }; }
    const k = (d - l1) / l2;
    return { x: b.x + (c.x - b.x) * k, y: b.y + (c.y - b.y) * k, nx: -(c.y - b.y) / l2, ny: (c.x - b.x) / l2 };
  }

  function emitCall() {
    if (reduced || !nodes.length) return;
    rings.push({ n: 0, t: 0, color: "avax", max: 64 });
    setTimeout(() => rings.push({ n: 1, t: 0, color: "avax", max: 44 }), 380);
    const count = 10 + Math.floor(Math.random() * 7);
    for (let i = 0; i < count; i++) {
      if (particles.length > 600) break;
      particles.push({ s: -Math.random() * 0.08, v: 0.32 + Math.random() * 0.22, amp: 8 + Math.random() * 18, ph: Math.random() * 6.28, f: 2 + Math.random() * 3, size: 1.6 + Math.random() * 2 });
    }
  }
  function sealSequence() {
    if (reduced) return;
    flash = 1;
    const p = nodes[2];
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      crystals.push({ x: p.x + Math.cos(a) * R * 1.25, y: p.y + Math.sin(a) * R * 1.25, t: 0 });
    }
    setTimeout(() => coins.push({ t: 0 }), 520);
  }

  function mix(c1, c2, k) {
    const p = (c) => { const m = c.match(/\d+(\.\d+)?/g); if (c.startsWith("#")) { const h = c.slice(1); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; } return m.slice(0, 3).map(Number); };
    const a = p(c1), b = p(c2);
    return `rgb(${a.map((x, i) => Math.round(x + (b[i] - x) * k)).join(",")})`;
  }
  function diamond(x, y, s, rot) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.beginPath();
    ctx.moveTo(0, -s * 1.3); ctx.lineTo(s, 0); ctx.lineTo(0, s * 1.3); ctx.lineTo(-s, 0); ctx.closePath(); ctx.fill(); ctx.restore();
  }

  let last = performance.now(), time = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now; time += dt;
    ctx.clearRect(0, 0, W, H);
    const [A, B, P, S] = nodes;
    const target = retiring ? 1 : Math.min(1, pending() / THRESHOLD_MG);
    level += (target - level) * Math.min(1, dt * 3);

    // track
    ctx.lineWidth = 1.5; ctx.strokeStyle = colors.line;
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.lineTo(P.x, P.y); ctx.stroke();
    ctx.setLineDash([4, 6]); ctx.beginPath(); ctx.moveTo(P.x, P.y); ctx.lineTo(S.x, S.y); ctx.stroke(); ctx.setLineDash([]);

    // nodes 0, 1, 3
    [[A, colors.text], [B, colors.text], [S, colors.avax]].forEach(([n, c], i) => {
      ctx.fillStyle = colors.surface; ctx.beginPath(); ctx.arc(n.x, n.y, 22, 0, 7); ctx.fill();
      ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(n.x, n.y, 22, 0, 7); ctx.stroke();
    });
    // glyphs: agent (smoke dot cluster), x402 ($), seal (ring)
    ctx.fillStyle = colors.text; ctx.font = "600 15px JetBrains Mono, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("AI", A.x, A.y + 1); ctx.fillText("$", B.x, B.y + 1);
    ctx.fillStyle = colors.avax;
    if (sealFlash > 0) { ctx.globalAlpha = sealFlash; ctx.beginPath(); ctx.arc(S.x, S.y, 22, 0, 7); ctx.fill(); ctx.globalAlpha = 1; sealFlash -= dt * 0.8; }
    ctx.strokeStyle = colors.avax; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(S.x, S.y, 12, 0, 7); ctx.stroke();

    // rings
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i]; r.t += dt / 0.9;
      if (r.t >= 1) { rings.splice(i, 1); continue; }
      const n = nodes[r.n];
      ctx.strokeStyle = r.color === "avax" ? colors.avax : colors.mint;
      ctx.globalAlpha = 1 - r.t; ctx.lineWidth = 2.5 * (1 - r.t) + 0.5;
      ctx.beginPath(); ctx.arc(n.x, n.y, 22 + (r.max - 22) * r.t, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
    }

    // vessel
    ctx.save();
    ctx.shadowColor = colors.mint; ctx.shadowBlur = 24 * level + 40 * flash;
    ctx.strokeStyle = flash > 0.05 ? colors.mint : colors.line; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(P.x, P.y, R, 0, 7); ctx.stroke(); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.arc(P.x, P.y, R - 4, 0, 7); ctx.clip();
    ctx.fillStyle = colors.tile; ctx.globalAlpha = 0.6; ctx.fillRect(P.x - R, P.y - R, R * 2, R * 2); ctx.globalAlpha = 1;
    const surf = P.y + R - 2 * R * level;
    const grad = ctx.createLinearGradient(0, surf, 0, P.y + R);
    grad.addColorStop(0, colors.mint); grad.addColorStop(1, mix(colors.mint, colors.surface, 0.65));
    ctx.fillStyle = grad; ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.moveTo(P.x - R, P.y + R);
    for (let x = -R; x <= R; x += 3) {
      const y = surf + Math.sin(x * 0.06 + time * 2.2) * (1.6 + bump) + Math.sin(x * 0.11 - time * 1.4) * bump * 0.6;
      ctx.lineTo(P.x + x, y);
    }
    ctx.lineTo(P.x + R, P.y + R); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
    // suspended crystals inside the liquid
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    for (let i = 0; i < 14 * level; i++) {
      const x = P.x + Math.sin(i * 7.3 + time * 0.4) * R * 0.7, y = P.y + R - (((i * 37) % 100) / 100) * 2 * R * level * 0.9 - 4;
      diamond(x, y, 2.2, time * 0.5 + i);
    }
    if (flash > 0) { ctx.fillStyle = colors.mint; ctx.globalAlpha = flash * 0.5; ctx.fillRect(P.x - R, P.y - R, R * 2, R * 2); ctx.globalAlpha = 1; flash = Math.max(0, flash - dt * 1.4); }
    ctx.restore();
    bump = Math.max(0, bump - dt * 4);

    // particles: smoke -> mint, dots -> diamonds near the pool
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.s += p.v * dt;
      if (p.s < 0) continue;
      if (p.s >= 1) { particles.splice(i, 1); bump = Math.min(6, bump + 0.35); continue; }
      const q = along(p.s);
      const wob = Math.sin(time * p.f + p.ph) * p.amp * (1 - p.s) * 0.8;
      const x = q.x + q.nx * wob, y = q.y + q.ny * wob;
      const k = Math.max(0, Math.min(1, (p.s - 0.42) / 0.42));
      ctx.fillStyle = k < 1 ? mix("#7d8580", colors.mint, k) : colors.mint;
      ctx.globalAlpha = 0.55 + 0.45 * k;
      const dist = Math.hypot(x - P.x, y - P.y);
      if (dist < 140) diamond(x, y, p.size * 1.25, time * 2 + p.ph);
      else { ctx.beginPath(); ctx.arc(x, y, p.size * (1.3 - k * 0.3), 0, 7); ctx.fill(); }
      ctx.globalAlpha = 1;
    }

    // seal: crystals compress, a coin flies to the seal node
    for (let i = crystals.length - 1; i >= 0; i--) {
      const c = crystals[i]; c.t += dt / 0.5;
      if (c.t >= 1) { crystals.splice(i, 1); continue; }
      const e = c.t * c.t;
      ctx.fillStyle = colors.mint; diamond(c.x + (P.x - c.x) * e, c.y + (P.y - c.y) * e, 3.5 * (1 - e) + 1, c.t * 6);
    }
    for (let i = coins.length - 1; i >= 0; i--) {
      const c = coins[i]; c.t += dt / 0.8;
      if (c.t >= 1) { coins.splice(i, 1); sealFlash = 1; rings.push({ n: 3, t: 0, color: "avax", max: 80 }); continue; }
      const e = 1 - Math.pow(1 - c.t, 3);
      const x = P.x + (S.x - P.x) * e, y = P.y + (S.y - P.y) * e - Math.sin(e * Math.PI) * 30;
      ctx.save(); ctx.shadowColor = colors.mint; ctx.shadowBlur = 20; ctx.fillStyle = colors.mint;
      ctx.beginPath(); ctx.arc(x, y, 11, 0, 7); ctx.fill(); ctx.restore();
    }

    requestAnimationFrame(frame);
  }

  readColors(); layout();
  new ResizeObserver(layout).observe(host);
  requestAnimationFrame(frame);

  // ---------- events ----------
  on("accrual", (c) => {
    pushRow(c);
    queueHero();
    if (c.agent === F) emitCall();
    paintPay(c);
  });
  on("full", ({ agent }) => {
    if (agent !== F) return;
    retiring = true;
    const pill = $("#poolState"); pill.textContent = `Sealing on ${DC.NET.short}`; pill.classList.add("retiring");
    $("#lbl-seal").innerHTML = `<span class="red">Burning ${fmt.mass(THRESHOLD_MG)} DCO2…</span>`;
  });
  on("retired", (r) => {
    if (r.agent !== F) return;
    sealSequence();
    setTimeout(() => {
      retiring = false;
      const pill = $("#poolState"); pill.textContent = "Filling"; pill.classList.remove("retiring");
      paintLatest(r, true); big.set(state.totalMg / 1000); paintHero(); paintPool();
    }, 1350);
  });
  function paintPay(c) {
    if (!c) { $("#lbl-pay").textContent = "Waiting for a payment"; return; }
    $("#lbl-pay").innerHTML = `${c.price != null ? `${fmt.usd(c.price, 3)} + ` : ""}<span class="red">${fmt.usd(c.sur, 5)} carbon</span>`;
  }
  paintPay(state.feed[0]);

  // Rehearsal keys (simulated stream only)
  if (!DC.mock) return;
  $(".scene-keys").hidden = false;
  window.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "b") { DC.burst(100); DC.toast(`Burst: 100 paid calls from agent #${F}`); }
    if (e.key === "p") DC.toast(DC.pause() ? "Stream paused" : "Stream resumed");
  });
}
