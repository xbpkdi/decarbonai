import { LIVE_WORD } from "@/lib/copy";

/* Rich layer: atmosphere, carbon tape, big type, one solid block per page, key-card border,
   scroll reveals and counters. Always on. */
export default function init(DC) {
  const page = document.querySelector("main")?.dataset.page || "index";
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const PAGES = {
    index: { word: LIVE_WORD, solid: "#latest", key: ".pool" },
    agent: { word: "Footprint", solid: null, key: "#tl" },
    receipts: { word: "Sealed", solid: ".wall .spec", key: ".bar" },
    receipt: { word: null, solid: null, key: "#checks" },
    developers: { word: "Per call", solid: ".install", key: ".run" },
    methodology: { word: "The math", solid: ".calc .res", key: ".calc" },
  };

  function atmosphere() {
    // On Live the haze clears up as more carbon is retired.
    const haze = () => document.documentElement.style.setProperty("--haze", page === "index" ? Math.min(0.85, 0.32 + (DC.state.retiredMg / 1e6) * 0.06).toFixed(2) : "0.5");
    haze();
    DC.on("retired", haze);
    // The aurora drifts at most ~8 px/s. As a CSS animation it made the compositor redraw the whole
    // screen (and re-blur the nav over it) every display frame, on every page, forever. Stepping the same
    // path 12 times a second moves each soft blob under a pixel per step and lets idle frames go.
    const aur = [...document.querySelectorAll(".atmo .aur")];
    if (reduced || aur.length !== 3) return;
    // [period s, translate vw, translate vh, scale, reversed] = the drift1/drift2 keyframes in globals.css
    const path = [[32, 8, 6, 1.12, false], [38, -10, 8, 0.92, false], [44, 8, 6, 1.12, true]];
    const ease = (k) => {
      // ease-in-out, cubic-bezier(0.42, 0, 0.58, 1): solve x(t) = k, return y(t)
      const bz = (t, a, b) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
      let lo = 0, hi = 1, t = k;
      for (let i = 0; i < 18; i++) { t = (lo + hi) / 2; if (bz(t, 0.42, 0.58) < k) lo = t; else hi = t; }
      return bz(t, 0, 1);
    };
    const step = () => {
      if (document.hidden) return;
      const s = performance.now() / 1000;
      aur.forEach((el, i) => {
        const [p, x, y, sc, rev] = path[i];
        let k = (s / p) % 2;
        if (k > 1) k = 2 - k; // alternate
        const e = ease(rev ? 1 - k : k);
        el.style.transform = `translate(${(x * e).toFixed(3)}vw, ${(y * e).toFixed(3)}vh) scale(${(1 + (sc - 1) * e).toFixed(4)})`;
      });
    };
    step();
    document.documentElement.classList.add("aur-js");
    setInterval(step, 1000 / 12);
  }

  function tape() {
    const { state, fmt, agentById, short } = DC;
    const t = document.querySelector(".tape");
    if (!t) return;
    const items = [];
    // Anything before today carries its date.
    const day = (e) => (fmt.isToday(e.t) ? "" : `<span class="dim">${fmt.day(e.t)}</span>`);
    const acc = (c) => `<span class="tape-item"><span class="rd"></span><span class="h">${short(c.tx, 6, 4)}</span><span class="g">+${(c.mg / 1000).toFixed(2)} g</span>${c.n > 1 ? `<span class="dim">${c.n} calls</span>` : ""}<span>${agentById(c.agent).title}</span>${day(c)}</span>`;
    const ret = (r) => `<span class="tape-item ret"><span class="dm"></span>Receipt ${fmt.no(r.n)} minted<span class="dim">${fmt.mass(r.mg)} · ${agentById(r.agent).title}</span>${day(r)}</span>`;
    DC.groupByTx(state.feed).slice(0, 14).forEach((c, i) => { items.push(acc(c)); if (i === 4 && state.receipts[0]) items.push(ret(state.receipts[0])); if (i === 10 && state.receipts[1]) items.push(ret(state.receipts[1])); });
    const track = t.querySelector(".tape-track");
    // A static row headed by the date of the newest event; it does not loop.
    const label = () => {
      if (DC.mock) return "Simulated events";
      const e = state.feed[0];
      if (!e) return `${DC.NET.short} events`;
      return `Last ${DC.NET.short} events · ${fmt.isToday(e.t) ? "today" : fmt.day(e.t)}`;
    };
    const render = (fresh) => {
      const html = items.length ? items.slice(0, 22).join("") : `<span class="tape-item"><span class="rd"></span>${DC.failed ? DC.READ_FAILED : `Waiting for the next paid call on ${DC.NET.name}`}</span>`;
      track.innerHTML = `<span class="tape-lbl">${label()}</span>${html}`;
      if (fresh && !reduced) track.querySelector(".tape-item")?.classList.add("fresh");
    };
    render(false);
    let last = null;
    // Replayed events are history, not news: the tape ignores them.
    DC.on("accrual", (c) => {
      if (DC.replaying) return;
      if (last && last.tx === c.tx) { last.n++; last.mg += c.mg; items[0] = acc(last); }
      else { last = { ...c, n: 1 }; items.unshift(acc(last)); }
      items.length = Math.min(items.length, 40); render(true);
    });
    DC.on("retired", (r) => { if (DC.replaying) return; items.unshift(ret(r)); render(true); });
  }

  function bigType(cfg) {
    if (page === "receipt") {
      const h = document.querySelector("#rt");
      if (h) { h.classList.add("mega"); h.style.fontSize = "clamp(72px, 7.4vw, 150px)"; h.innerHTML = `${h.textContent}<span class="dot red">.</span>`; }
      return;
    }
    if (!cfg.word) return;
    const mega = `<div class="mega${page === "index" ? " mega-live" : ""}" aria-hidden="true">${cfg.word}<span class="dot">.</span></div>`;
    if (page === "index") {
      // Status pill and eyebrow share one row above the headline.
      document.querySelector(".hero .eyebrow-row").insertAdjacentHTML("afterend", mega);
    } else {
      const head = document.querySelector(".page-head .eyebrow");
      head?.insertAdjacentHTML("afterend", mega);
    }
  }

  function solidAndKey(cfg) {
    if (cfg.solid) document.querySelector(cfg.solid)?.classList.add("solid");
    const key = cfg.key && document.querySelector(cfg.key);
    const keyCard = key && (key.classList.contains("card") ? key : key.closest(".card"));
    if (keyCard) {
      keyCard.classList.add("key");
      // The border sweeps once on load and once more when real data changes, never in a loop.
      let swept = performance.now();
      const sweep = () => { if (DC.replaying || performance.now() - swept < 2400) return; swept = performance.now(); keyCard.classList.toggle("again"); };
      DC.on("accrual", sweep); DC.on("retired", sweep);
    }
    if (page === "receipts") {
      // the newest coin stays the solid block, also after a new one drops in
      DC.on("retired", () => setTimeout(() => { document.querySelectorAll(".wall .spec.solid").forEach((s) => s.classList.remove("solid")); document.querySelector(".wall .spec")?.classList.add("solid"); }, 50));
    }
    if (page === "receipt") {
      // When every check has resolved, a solid mint banner confirms it.
      const box = document.querySelector("#checks");
      const banner = document.createElement("div");
      banner.className = "verified";
      banner.innerHTML = `<span>${DC.I.check}</span><div><b>${DC.mock ? "Simulated checks." : `Receipt found on ${DC.NET.name}.`}</b> <span data-verified-note></span></div>`;
      banner.style.cssText = "display:none;align-items:center;gap:14px;margin:0 16px 16px;padding:16px 18px;border-radius:12px;font-size:15px;";
      box.after(banner);
      const check = () => {
        const done = [...box.querySelectorAll("li")].every((li) => li.dataset.s === "ok" || li.dataset.s === "warn");
        banner.style.display = done ? "flex" : "none";
        banner.classList.toggle("solid", done);
        banner.querySelector("span").style.cssText = "width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:var(--mint-ink);color:var(--mint);flex-shrink:0";
        banner.querySelector("svg").style.cssText = "width:16px;height:16px";
      };
      new MutationObserver(check).observe(box, { subtree: true, attributes: true, attributeFilter: ["data-s"], childList: true });
    }
  }

  function reveal() {
    if (page === "index") return; // the stage is live; it does not wait for scroll
    const els = [...document.querySelectorAll("main .section, main .card, main .stats > *, .wall > *, .foot-band, .foot-cols > div")];
    els.forEach((el) => el.classList.add("rv"));
    const io = new IntersectionObserver((entries) => {
      let i = 0;
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.style.setProperty("--d", `${Math.min(i++, 6) * 70}ms`);
        e.target.classList.add("in");
        countUp(e.target);
        io.unobserve(e.target);
      });
    }, { threshold: 0.12 });
    els.forEach((el) => io.observe(el));
    if (reduced) els.forEach((el) => el.classList.add("in"));
  }

  // Numbers roll up from zero the first time they enter the viewport.
  function countUp(root) {
    if (reduced) return;
    root.querySelectorAll(".stat .v, .totals .v").forEach((el) => {
      const node = [...el.childNodes].find((n) => n.nodeType === 3 && /[\d]/.test(n.textContent));
      if (!node || el.dataset.counted) return;
      el.dataset.counted = "1";
      const txt = node.textContent, m = txt.match(/[\d,]+(\.\d+)?/);
      if (!m) return;
      const target = parseFloat(m[0].replace(/,/g, "")), dec = (m[1] || "").length ? m[1].length - 1 : 0;
      const t0 = performance.now();
      const step = (now) => {
        const p = Math.min(1, (now - t0) / 900), v = target * (1 - Math.pow(1 - p, 3));
        node.textContent = txt.replace(m[0], v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec }));
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  function start() {
    const cfg = PAGES[page] || {};
    atmosphere();
    tape();
    bigType(cfg);
    solidAndKey(cfg);
    reveal();
  }
  start();
}
