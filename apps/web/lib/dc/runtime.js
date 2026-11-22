/* DecarbonAI v3 runtime: shared state, event stream, formatting, odometer, coin + seal, chrome bindings.
   Two sources feed the same state and events:
   - "live" (default): CarbonAccrued / Retired events from the RetirementPool, polled through /api/snapshot.
   - "mock" (?source=mock): the seeded simulation from the prototype, with the B (burst) / P (pause) rehearsal keys. */

// ---------- seeded random (mock source) ----------
let seed = 0xdeca7b0;
function rand() {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function hex(bytes) {
  let s = "0x";
  for (let i = 0; i < bytes; i++) s += Math.floor(rand() * 256).toString(16).padStart(2, "0");
  return s;
}
const short = (h, a = 6, b = 4) => (h && h.length > a + b + 1 ? `${h.slice(0, a)}…${h.slice(-b)}` : h || "");

// ---------- factors (packages/core v0) ----------
const FACTORS = {
  pue: 1.1, grid: 400, base: 0.05, embodied: 0.005,
  models: {
    "gemini-flash": { label: "Small / flash", out: 1.5, in: 0.15 },
    "gpt-class-standard": { label: "Standard chat", out: 3, in: 0.3 },
    "claude-sonnet": { label: "Sonnet class", out: 6, in: 0.6 },
    "claude-opus": { label: "Opus class", out: 12, in: 1.2 },
    "reasoning-heavy": { label: "Long reasoning", out: 50, in: 5 },
  },
};
function gramsPerCall(model, tin, tout) {
  const f = FACTORS.models[model];
  const wh = FACTORS.base + (tout / 1000) * f.out + (tin / 1000) * f.in;
  return { wh, g: (wh / 1000) * FACTORS.grid * FACTORS.pue + FACTORS.embodied };
}

// ---------- mock agents (simulation only) ----------
const MOCK_AGENTS = [
  { id: 42, name: "Claude research agent", note: "Buys paid search and market data through the DecarbonAI MCP server.", payer: "0x7a3f9c1e5b2d48a6c0e9f17b3d5a2c8e4f6b1d09", model: "claude-sonnet", tok: [3000, 1500], res: ["/v1/search", "/v1/market/quote", "/v1/filings"], price: 10000, w: 0.66, since: Date.UTC(2026, 10, 12) },
  { id: 17, name: "Weather oracle buyer", note: "Pays a weather API every minute for crop alerts.", payer: "0x2b8e4d6f1a3c5e7092b4d6f8a1c3e5079b2d4f61", model: "gemini-flash", tok: [800, 300], res: ["/v1/forecast", "/v1/rainfall"], price: 2000, w: 0.2, since: Date.UTC(2026, 10, 9) },
  { id: 88, name: "Thai news summariser", note: "Summarises Thai-language news for a Bangkok newsroom.", payer: "0x9d1c3e5a7f2b4d6e8a0c2e4f6b8d1a3c5e7f9b20", model: "gpt-class-standard", tok: [6000, 900], res: ["/v1/summarize", "/v1/translate"], price: 5000, w: 0.14, since: Date.UTC(2026, 10, 15) },
];

// ---------- formatting ----------
const fmt = {
  g: (mg, d = 1) => (mg / 1000).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }),
  mass(mg) { const g = mg / 1000; return g >= 1000 ? `${(g / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 })} kg` : `${g.toLocaleString("en-US", { maximumFractionDigits: g < 10 ? 2 : 1 })} g`; },
  usd: (u, d = 4) => `$${(u / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: d })}`,
  time: (t) => new Date(t).toLocaleTimeString("en-GB", { hour12: false }),
  date: (t) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
  dt: (t) => new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok" }) + " ICT",
  no: (n) => `No. ${String(n).padStart(4, "0")}`,
  count: (n) => n.toLocaleString("en-US"),
};

// ---------- odometer ----------
function odometer(el, { decimals = 0, value = 0 } = {}) {
  el.classList.add("odo");
  let cur = null;
  function render(v) {
    const str = v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    if (cur && cur.length === str.length) {
      [...str].forEach((ch, i) => {
        const node = el.children[i];
        if (/\d/.test(ch) && node.classList.contains("d")) node.firstChild.style.transform = `translateY(calc(${-Number(ch)} * var(--cell)))`;
        else if (!/\d/.test(ch)) node.textContent = ch;
      });
    } else {
      el.innerHTML = "";
      [...str].forEach((ch) => {
        if (/\d/.test(ch)) {
          const d = document.createElement("span"); d.className = "d";
          const col = document.createElement("span");
          col.innerHTML = Array.from({ length: 10 }, (_, k) => `<b>${k}</b>`).join("");
          col.style.transform = `translateY(calc(${-Number(ch)} * var(--cell)))`;
          d.appendChild(col); el.appendChild(d);
        } else { const s = document.createElement("span"); s.className = "s"; s.textContent = ch; el.appendChild(s); }
      });
    }
    cur = str;
    el.setAttribute("aria-label", str);
  }
  render(value);
  return { set: render };
}

// ---------- icons ----------
const I = {
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>`,
  play: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>`,
  arr: `<span class="arr">↗</span>`,
};

let toastEl, toastT;
function toast(msg) {
  if (!toastEl) { toastEl = document.createElement("div"); toastEl.className = "toast"; toastEl.setAttribute("role", "status"); document.body.appendChild(toastEl); }
  toastEl.textContent = msg; toastEl.classList.add("on");
  clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove("on"), 2600);
}

let sealId = 0;
function sealSVG(n, cls = "") {
  const id = `seal${++sealId}`;
  return `<svg class="seal ${cls}" viewBox="0 0 120 120" aria-hidden="true">
    <defs><path id="${id}" d="M60 60m-43 0a43 43 0 1 1 86 0a43 43 0 1 1-86 0"/></defs>
    <circle cx="60" cy="60" r="56" fill="none" stroke="currentColor" stroke-width="3"/>
    <circle cx="60" cy="60" r="50" fill="none" stroke="currentColor" stroke-width="1"/>
    <circle cx="60" cy="60" r="31" fill="currentColor" fill-opacity=".14" stroke="currentColor" stroke-width="1.2"/>
    <text style="font-family:var(--f-mono)" font-size="9.4" font-weight="600" letter-spacing="2.2" fill="currentColor"><textPath href="#${id}">SOULBOUND · ERC-5192 · AVALANCHE ·</textPath></text>
    <text x="60" y="56" text-anchor="middle" style="font-family:var(--f-mono)" font-size="8" fill="currentColor">No.</text>
    <text x="60" y="72" text-anchor="middle" style="font-family:var(--f-display)" font-size="19" fill="currentColor">${String(n).padStart(4, "0")}</text>
  </svg>`;
}

const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Builds the runtime for one page load and exposes it as window.DC.
 * cfg: { source, snapshot, net, contracts, method, agentNames, featured, demoAgentId, creditNote }
 */
export function createDC(cfg) {
  const { net: NET, contracts: CONTRACTS, method: METHOD } = cfg;
  const mock = cfg.source === "mock";
  const snap = cfg.snapshot;
  const THRESHOLD_MG = snap?.thresholdMg || cfg.thresholdMg || 1_000_000;
  const PRICE_PER_TONNE = snap?.pricePerTonne || cfg.pricePerTonne || 25_000_000; // USDC base units per tonne
  const surchargeFor = (mg) => Math.ceil((mg * PRICE_PER_TONNE) / 1e9);

  const hashLink = (h, a, b, cls = "") => `<a class="hash ${cls}" href="${NET.explorer}/tx/${h}" target="_blank" rel="noreferrer" data-copy="${h}" title="${h}">${short(h, a, b)}${I.arr}</a>`;
  const addrLink = (h) => `<a class="hash" href="${NET.explorer}/address/${h}" target="_blank" rel="noreferrer" title="${h}">${short(h)}${I.arr}</a>`;

  // ---------- agents ----------
  const AGENTS = mock ? MOCK_AGENTS.map((a) => ({ ...a, title: a.name })) : [];
  const agentById = (id) => AGENTS.find((a) => a.id === id) || ensureAgent(id);
  function ensureAgent(id, payer, t) {
    let a = AGENTS.find((x) => x.id === id);
    if (!a) {
      const named = cfg.agentNames[String(id)];
      a = { id, name: named || (id ? "Agent" : "Unregistered payer"), title: named || (id ? `Agent #${id}` : "Unregistered payer"), note: "Pays for x402 calls on Avalanche; every payment carries its carbon surcharge into the RetirementPool.", payer: payer || "", model: null, since: t || Date.now() };
      AGENTS.push(a);
      state.pending[id] ??= 0;
      state.acct[id] ??= { calls: 0, mg: 0, sur: 0 };
      state.history[id] ??= [];
    }
    if (payer) a.payer = payer;
    return a;
  }

  // ---------- state ----------
  const state = {
    totalMg: 0, calls: 0, surcharge: 0, retiredMg: 0, block: snap?.block || 0,
    pending: {}, acct: {}, feed: [], receipts: [], history: {},
  };
  AGENTS.forEach((a) => { state.pending[a.id] = 0; state.acct[a.id] = { calls: 0, mg: 0, sur: 0 }; state.history[a.id] = []; });

  function apply(c) {
    ensureAgent(c.agent, c.payer, c.t);
    state.totalMg += c.mg; state.calls++; state.surcharge += c.sur;
    state.pending[c.agent] += c.mg;
    const ac = state.acct[c.agent]; ac.calls++; ac.mg += c.mg; ac.sur += c.sur;
    state.history[c.agent].push({ t: c.t, mg: c.mg, tx: c.tx, receipt: null });
    state.feed.unshift(c); if (state.feed.length > 30) state.feed.length = 30;
  }
  // A retirement covers the agent's oldest open calls (`calls` of them on-chain; all open ones in the mock).
  function retire(agentId, t, ev) {
    ensureAgent(agentId, ev?.payer, t);
    const n = ev ? ev.n : state.receipts.length + 1;
    const open = state.history[agentId].filter((h) => h.receipt === null);
    const covered = ev ? open.slice(0, ev.calls) : open;
    covered.forEach((h) => (h.receipt = n));
    const sur = covered.reduce((s, h) => s + surchargeFor(h.mg), 0);
    const mg = ev ? ev.mg : THRESHOLD_MG;
    const r = { n, agent: agentId, mg, calls: ev ? ev.calls : covered.length, t, tx: ev ? ev.tx : hex(32), sur, lot: ev ? ev.lot : 1, payer: ev?.payer || agentById(agentId).payer };
    state.pending[agentId] = Math.max(0, state.pending[agentId] - mg); state.retiredMg += mg;
    state.receipts.unshift(r);
    return r;
  }

  // ---------- events ----------
  const listeners = {};
  const on = (ev, fn) => ((listeners[ev] ||= []).push(fn), () => (listeners[ev] = listeners[ev].filter((f) => f !== fn)));
  const emit = (ev, data) => (listeners[ev] || []).forEach((fn) => fn(data));

  let paused = false, burstLeft = 0, timer = null;
  const retiring = new Set();
  const controls = {};

  if (mock) {
    const makeCall = (a, t) => {
      const base = gramsPerCall(a.model, a.tok[0], a.tok[1]).g * 1000;
      const mg = Math.round(base * (0.82 + rand() * 0.36));
      state.block += 1 + Math.floor(rand() * 3);
      return { id: hex(8), tx: hex(32), t, agent: a.id, payer: a.payer, mg, sur: surchargeFor(mg), res: a.res[Math.floor(rand() * a.res.length)], price: a.price, block: state.block };
    };
    // History: one week, merged and sorted, so receipts number in time order.
    state.block = 38422936;
    const start = Date.UTC(2026, 10, 14, 2, 0), end = Date.now() - 15 * 60_000;
    const plan = [], target = { 42: 3, 17: 1, 88: 2 };
    AGENTS.forEach((a) => {
      const per = gramsPerCall(a.model, a.tok[0], a.tok[1]).g * 1000;
      const n = Math.ceil((target[a.id] * THRESHOLD_MG) / per);
      for (let i = 0; i < n; i++) plan.push({ a, t: start + ((i + 0.5) / n) * (end - start) });
    });
    plan.sort((x, y) => x.t - y.t);
    plan.forEach(({ a, t }) => { apply(makeCall(a, t)); if (state.pending[a.id] >= THRESHOLD_MG) retire(a.id, t); });
    // Featured agent opens the demo at about 81% of its pool.
    const f = AGENTS[0], per = gramsPerCall(f.model, f.tok[0], f.tok[1]).g * 1000;
    const need = Math.max(0, Math.floor((THRESHOLD_MG * 0.81 - state.pending[42]) / per));
    for (let i = 0; i < need; i++) apply(makeCall(f, end + (i / need) * 14 * 60_000));
    for (let i = 0; i < 8; i++) apply(makeCall(AGENTS[1 + (i % 2)], Date.now() - (8 - i) * 15_000));
    state.feed.sort((x, y) => y.t - x.t);

    const sealIfFull = (a) => {
      if (state.pending[a.id] >= THRESHOLD_MG && !retiring.has(a.id)) {
        retiring.add(a.id);
        emit("full", { agent: a.id });
        setTimeout(() => { retiring.delete(a.id); emit("retired", retire(a.id, Date.now())); }, 2200);
      }
    };
    const tick = () => {
      if (!paused) {
        let a = AGENTS[0];
        if (burstLeft > 0) burstLeft--;
        else { let r = rand(); for (const x of AGENTS) { if ((r -= x.w) <= 0) { a = x; break; } } }
        const c = makeCall(a, Date.now());
        apply(c); emit("accrual", c); sealIfFull(a);
      }
      timer = setTimeout(tick, burstLeft > 0 ? 70 : 1600 + rand() * 1800);
    };
    controls.start = () => { if (!timer) timer = setTimeout(tick, 1200); };
    controls.burst = (n = 100) => { burstLeft += n; clearTimeout(timer); timer = setTimeout(tick, 50); };
    controls.payOnce = async (agentId = 42) => {
      const a = AGENTS.find((x) => x.id === agentId) || AGENTS[0];
      const c = makeCall(a, Date.now());
      apply(c); emit("accrual", c); sealIfFull(a);
      return { simulated: true, mg: c.mg, sur: c.sur, price: c.price, tx: c.tx };
    };
    controls.forceRetire = (agentId = 42) => {
      state.pending[agentId] = Math.max(state.pending[agentId], THRESHOLD_MG);
      emit("full", { agent: agentId });
      setTimeout(() => emit("retired", retire(agentId, Date.now())), 900);
    };
    setInterval(() => { if (!paused) { state.block += 1; emit("block", state.block); } }, 2000);
  } else {
    // ---------- live: replay the chain history, then poll for new events ----------
    const toCall = (a) => ({ ...a, res: "x402 call", price: null });
    const merge = (accruals, retirements) => {
      const evs = [...accruals.map((a) => ({ k: 0, b: a.block, v: a })), ...retirements.map((r) => ({ k: 1, b: r.block, v: r }))];
      return evs.sort((x, y) => x.b - y.b || x.k - y.k);
    };
    const seen = new Set();
    let lastBlock = 0;
    const ingest = (s, live) => {
      merge(s.accruals, s.retirements).forEach(({ k, v }) => {
        const key = k ? `r${v.n}` : `a${v.id}${v.tx}`;
        if (seen.has(key)) return;
        seen.add(key);
        lastBlock = Math.max(lastBlock, v.block);
        if (k === 0) { const c = toCall(v); apply(c); if (live) emit("accrual", c); }
        else if (live) { emit("full", { agent: v.agent }); setTimeout(() => emit("retired", retire(v.agent, v.t, v)), 1400); }
        else retire(v.agent, v.t, v);
      });
      if (s.block && s.block !== state.block) { state.block = s.block; emit("block", s.block); }
    };
    if (snap) ingest(snap, false);
    state.feed.sort((x, y) => y.t - x.t);
    let polling = false;
    const poll = async () => {
      clearTimeout(timer);
      if (polling) return;
      polling = true;
      if (!paused && document.visibilityState === "visible") {
        try {
          const res = await fetch(`/api/snapshot?since=${lastBlock}`, { cache: "no-store" });
          if (res.ok) ingest(await res.json(), true);
        } catch { /* keep the last state; the next poll retries */ }
      }
      polling = false;
      timer = setTimeout(poll, 5000);
    };
    controls.start = () => { if (!timer) timer = setTimeout(poll, snap ? 4000 : 0); };
    controls.burst = () => {};
    controls.forceRetire = () => {};
    // A real paid call through the demo API; its CarbonAccrued lands with the next meter batch.
    controls.payOnce = async () => {
      const res = await fetch("/api/demo/pay", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Demo payment failed (${res.status})`);
      setTimeout(poll, 6000);
      return { simulated: false, mg: Number(body.quote?.mgCO2e || 0), sur: Number(body.quote?.surcharge || 0), price: Number(body.quote?.baseAmount || 0), tx: body.tx, raw: body };
    };
  }

  const featuredId = () => {
    if (cfg.featured && state.acct[cfg.featured]) return cfg.featured;
    return state.feed[0]?.agent ?? AGENTS[0]?.id ?? cfg.featured ?? 0;
  };

  const DC = {
    source: mock ? "mock" : "live", mock, state, AGENTS, agentById, CONTRACTS, METHOD, NET, FACTORS, THRESHOLD_MG, PRICE_PER_TONNE,
    gramsPerCall, surchargeFor, fmt, short, hex, rand, on, emit, odometer, I, hashLink, addrLink, toast, sealSVG, coinHTML, reduced,
    scaleBar: (el, mg) => scaleBar(el, mg, THRESHOLD_MG), creditNote: cfg.creditNote, demoAgentId: cfg.demoAgentId,
    FEATURED: featuredId(), startStream: () => controls.start(), burst: (n) => controls.burst(n), forceRetire: (id) => controls.forceRetire(id),
    payOnce: (id) => controls.payOnce(id), pause: () => (paused = !paused),
  };
  window.DC = DC;
  return DC;

  function coinHTML(r, { seal = true, size = "" } = {}) {
    const kg = r.mg / 1e6;
    return `<div class="coin ${size}" data-coin>
      <div class="coin-face">
        <span class="coin-eyebrow">Retired</span>
        <span class="coin-kg">${kg.toLocaleString("en-US", { maximumFractionDigits: 3 })} kg</span>
        <span class="coin-unit">CO₂e</span>
        <span class="coin-no">${fmt.no(r.n)}</span>
      </div>
      ${seal ? sealSVG(r.n) : ""}
    </div>`;
  }
}

function scaleBar(el, mg, threshold) {
  if (!el.children.length) {
    el.classList.add("scale");
    el.setAttribute("role", "meter");
    el.setAttribute("aria-label", "Pool fill");
    el.innerHTML = Array.from({ length: 10 }, () => `<span class="slot"><i></i></span>`).join("");
  }
  const f = Math.min(1, mg / threshold) * 10;
  [...el.children].forEach((s, i) => { const v = Math.max(0, Math.min(1, f - i)); s.firstChild.style.transform = `scaleX(${v})`; s.classList.toggle("full", v >= 1); });
  el.setAttribute("aria-valuenow", Math.round(mg / 1000)); el.setAttribute("aria-valuemin", 0); el.setAttribute("aria-valuemax", threshold / 1000);
}

/** Behaviour for the server-rendered navbar, menu sheet and footer. */
export function bindChrome(DC) {
  const { state, fmt, on, toast: say } = DC;
  const header = document.querySelector(".nav");
  const nl = header?.querySelector(".nav-links"), ul = nl?.querySelector(".nav-underline");
  if (nl && ul) {
    const place = (a) => { if (!a) { ul.style.width = 0; return; } ul.style.left = `${a.offsetLeft + 10}px`; ul.style.width = `${a.offsetWidth - 20}px`; };
    const active = nl.querySelector('[aria-current="page"]');
    requestAnimationFrame(() => place(active));
    nl.querySelectorAll("a").forEach((a) => a.addEventListener("mouseenter", () => place(a)));
    nl.addEventListener("mouseleave", () => place(active));
  }
  const tickers = [...document.querySelectorAll("[data-ticker]")].map((el) => odometer(el, { decimals: 1, value: state.totalMg / 1000 }));
  on("accrual", () => tickers.forEach((t) => t.set(state.totalMg / 1000)));
  const paintBlock = (b) => document.querySelectorAll("[data-block]").forEach((el) => (el.textContent = b ? `#${fmt.count(b)}` : ""));
  paintBlock(state.block);
  on("block", paintBlock);

  const body = document.body;
  document.querySelector("[data-menu]")?.addEventListener("click", () => body.classList.add("sheet-open"));
  document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => body.classList.remove("sheet-open")));

  // copy-on-click for hash chips (cmd/ctrl-click opens Snowtrace)
  document.addEventListener("click", (e) => {
    const h = e.target.closest?.(".hash[data-copy]");
    if (!h || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    navigator.clipboard?.writeText(h.dataset.copy).catch(() => {});
    h.classList.add("copied"); setTimeout(() => h.classList.remove("copied"), 900);
    say("Copied tx hash. Cmd-click opens Snowtrace.");
  });
}
