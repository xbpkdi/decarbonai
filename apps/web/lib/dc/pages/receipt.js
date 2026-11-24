import QRCode from "qrcode";

export default function init(DC) {
  const { state, fmt, agentById, CONTRACTS, METHOD, NET, I, reduced } = DC;
  const $ = (s) => document.querySelector(s);
  const n = Number(document.querySelector("main").dataset.n);
  const KIND = DC.UNBACKED ? "Testnet receipt (mock credit)" : "Retirement receipt";
  const r = state.receipts.find((x) => x.n === n);
  if (!r) {
    $("#info").innerHTML = `<span class="eyebrow">${KIND} · ${NET.name}</span><h1 class="display" id="rt">${fmt.no(n || 0)}</h1>
      <p class="lead" style="margin-top:18px">${DC.failed ? `${DC.READ_FAILED} This receipt has not been checked.` : `This receipt has not been minted on ${NET.name} yet, or the chain index is still catching up.`}</p>
      <div class="acts"><a class="btn btn-outline" href="/receipts">All receipts</a></div>`;
    document.querySelector(".verify-grid").hidden = true;
    return;
  }
  const a = agentById(r.agent);

  $("#tilt").innerHTML = DC.coinHTML(r) ;
  $("#tilt .coin").insertAdjacentHTML("beforeend", '<span class="glare" aria-hidden="true"></span>');
  $("#info").innerHTML = `<span class="eyebrow">${DC.mock ? "Simulated receipt · rehearsal only" : `${KIND} · ${NET.name}`}</span>
    <h1 class="display" id="rt">${fmt.no(r.n)}</h1>
    <dl>
      <dt>${DC.RETIRED}</dt><dd><b style="color:var(--mint);font-size:18px">${fmt.mass(r.mg)} CO₂e</b></dd>
      <dt>Agent</dt><dd><a href="/agent/${a.id}" style="text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--line-2)">${a.name}</a> <span class="mono dim">ERC-8004 #${a.id}</span></dd>
      <dt>Beneficiary</dt><dd>${DC.addrLink(r.payer || a.payer)}</dd>
      <dt>Calls covered</dt><dd class="tnum">${fmt.count(r.calls)} paid x402 calls</dd>
      <dt>Surcharge paid</dt><dd class="tnum">${fmt.usd(r.sur).slice(1)} ${DC.TOKEN.symbol}${NET.testnet ? " (testnet)" : ""}</dd>
      <dt>Credit burned</dt><dd>DCO2 lot ${r.lot}${DC.UNBACKED ? ' <span class="pill pill-mock">testnet mock credit</span>' : ""}</dd>
      <dt>Minted at</dt><dd>${fmt.dt(r.t)}</dd>
    </dl>
    <div class="acts">${DC.mock ? "" : `<a class="btn btn-primary" href="${NET.explorer}/tx/${r.tx}" target="_blank" rel="noreferrer">View on Snowtrace ↗</a>`}<a class="btn btn-outline" href="/receipts">All receipts</a><span class="pill pill-settled pill-dot">ERC-5192 locked</span></div>`;

  // What this receipt covers: the calls the runtime assigned to it (the agent's oldest open calls), grouped by meter batch.
  const mine = (state.history[r.agent] || []).filter((h) => h.receipt === r.n);
  const batches = [];
  for (const h of mine) { const b = batches[batches.length - 1]; if (b && b.tx === h.tx) { b.n++; b.mg += h.mg; } else batches.push({ tx: h.tx, t: h.t, n: 1, mg: h.mg }); }
  if (batches.length) {
    const found = mine.length === r.calls ? fmt.count(r.calls) : `${fmt.count(mine.length)} of ${fmt.count(r.calls)}`;
    $("#covSub").textContent = `${found} metered calls in ${batches.length} meter batch${batches.length === 1 ? "" : "es"} · agent #${r.agent} · ${DC.mock ? "simulated batches" : "each batch links to its CarbonAccrued tx"}`;
    $("#covBs").innerHTML = batches.map((b) => `<div class="cov-b"><div class="cov-dots" aria-hidden="true">${"<i></i>".repeat(b.n)}</div>
      <div class="cov-m"><b>${fmt.count(b.n)}</b> call${b.n === 1 ? "" : "s"} · ${fmt.g(b.mg, 1)} g</div>
      <div class="cov-m">${new Date(b.t).toISOString().slice(11, 19)} UTC</div>
      <div class="cov-m">${DC.hashLink(b.tx, 6, 4)}</div></div>`).join("");
    $("#cov").hidden = false;
  }

  // tilt
  const tilt = $("#tilt"), coin = $("#tilt .coin");
  if (!reduced) {
    const stage = tilt.parentElement;
    stage.addEventListener("pointermove", (e) => {
      const b = tilt.getBoundingClientRect();
      const x = (e.clientX - b.left) / b.width - 0.5, y = (e.clientY - b.top) / b.height - 0.5;
      tilt.classList.add("live");
      tilt.style.transform = `rotateY(${x * 28}deg) rotateX(${-y * 28}deg)`;
      coin.style.setProperty("--gx", `${(x + 0.5) * 100}%`); coin.style.setProperty("--gy", `${(y + 0.5) * 100}%`);
    });
    stage.addEventListener("pointerleave", () => { tilt.classList.remove("live"); tilt.style.transform = "rotateY(-10deg) rotateX(6deg)"; });
    tilt.style.transform = "rotateY(-10deg) rotateX(6deg)";
    if (window.gsap) gsap.from(".tilt .seal", { scale: 2.4, rotate: -50, opacity: 0, duration: 0.7, delay: 0.4, ease: "back.out(2.2)" });
  }

  // Verification: live reads the receipt back from the chain; the simulation ticks through the same steps, marked as simulated.
  const steps = [
    { t: "The pool emitted Retired", d: `The event index lists <span class="mono">Retired</span> for receipt ${r.n} in ${DC.hashLink(r.tx, 10, 6)}, and CarbonReceipt holds its record.`, ok: (v) => v.exists, res: ["record found"] },
    { t: "The receipt is soulbound", d: `CarbonReceipt ${DC.addrLink(CONTRACTS.CarbonReceipt)} returns <span class="mono">locked(${r.n}) = true</span> (ERC-5192).`, ok: (v) => v.locked, res: ["locked() = true", "not locked"] },
    { t: "The grams follow a published method", d: `Expected methodology hash <span class="mono" style="word-break:break-all">${METHOD.hash}</span>, published as <a href="/methodology" style="color:var(--mint)">${METHOD.version}</a>.`, after: (v) => `This receipt stores methodology hash <span class="mono" style="word-break:break-all">${v.methodologyHash}</span>, ${v.methodologyActive ? "active" : "not active"} on the pool as <a href="/methodology" style="color:var(--mint)">${v.methodologyVersion}</a>${v.methodologyHash?.toLowerCase() === METHOD.hash.toLowerCase() ? ", the version this site publishes" : ""}.`, ok: (v) => v.methodologyActive, res: ["hash registered", "hash not active"] },
    DC.UNBACKED
      ? { t: "A credit lot was burned", d: `DCO2 lot ${r.lot} on ${DC.addrLink(CONTRACTS.DCO2)}. A <b style="color:var(--warn)">testnet mock credit</b>, not a real tonne. Mainnet lots are backed 1:1 by retired credits.`, ok: () => true, warn: true, res: ["mock credit"] }
      : { t: "A credit lot was burned", d: `DCO2 lot ${r.lot} on ${DC.addrLink(CONTRACTS.DCO2)}, minted 1:1 against a credit retired off-chain.`, ok: (v) => v.backed, res: ["backed lot", "lot not backed"] },
  ];
  async function readChain() {
    if (DC.mock) return { exists: true, locked: true, methodologyActive: true, backed: true };
    const res = await fetch(`/api/receipt/${r.n}`, { cache: "no-store" });
    if (!res.ok) throw new Error("read failed");
    const v = await res.json();
    return v.exists ? v : null;
  }
  const ms = [900, 700, 800, 700];
  let runId = 0;
  async function run() {
    const id = ++runId;
    // Hold the card's height while the rows reset, so the page does not jump (WebKit has no scroll anchoring).
    const card = $("#checks").closest(".card") || $("#checks");
    card.style.minHeight = `${card.offsetHeight}px`;
    $("#checks").innerHTML = steps.map((s, i) => `<li data-s="wait" data-i="${i}"><span class="st">${i + 1}</span><div><div class="t">${s.t}</div><div class="d">${s.d}</div></div><span class="res">waiting</span></li>`).join("");
    const wait = (t) => new Promise((ok) => setTimeout(ok, reduced ? 0 : t));
    const chain = readChain().catch(() => null);
    await wait(500);
    for (let i = 0; i < steps.length; i++) {
      if (id !== runId) return;
      const li = $(`#checks li[data-i="${i}"]`), s = steps[i];
      li.dataset.s = "run"; li.querySelector(".st").textContent = ""; li.querySelector(".res").textContent = DC.mock ? "simulating…" : `reading ${NET.short}…`;
      const [v] = await Promise.all([chain, wait(ms[i])]);
      if (id !== runId) return;
      const pass = v ? s.ok(v) : false;
      const warn = s.warn || DC.mock;
      li.dataset.s = !pass ? "fail" : warn ? "warn" : "ok";
      if (v && s.after && !DC.mock) li.querySelector(".d").innerHTML = s.after(v);
      li.querySelector(".st").innerHTML = !pass ? "×" : warn ? "!" : I.check;
      li.querySelector(".res").textContent = !v ? "could not read" : DC.mock ? "simulated" : pass ? s.res[0] : s.res[1];
    }
    card.style.minHeight = "";
    const note = document.querySelector("[data-verified-note]");
    if (note) note.textContent = DC.mock ? "Nothing was read from chain." : `Lock and active methodology read from chain; ${DC.UNBACKED ? "mock credit" : "backed credit lot"}.`;
  }
  run();
  $("#rerun").addEventListener("click", run);

  // QR + share
  const url = `${location.origin}/receipt/${r.n}`;
  QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#080a09", light: "#ffffff" } }).then((svg) => { $("#qr").innerHTML = svg; });
  $("#share").addEventListener("click", async () => {
    if (navigator.share) {
      try { await navigator.share({ title: `DecarbonAI receipt ${fmt.no(r.n)}`, text: `${fmt.mass(r.mg)} ${DC.UNBACKED ? "mock " : ""}CO₂e receipt on ${NET.name}`, url }); return; } catch (e) { if (e?.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(url); DC.toast("Receipt link copied"); } catch { DC.toast(`Copy failed. Link: ${url}`); }
  });
}
