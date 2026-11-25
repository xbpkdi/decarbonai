export default function init(DC) {
  const { state, fmt, AGENTS, agentById, on, reduced } = DC;
  const $ = (s) => document.querySelector(s);
  let filter = "all";

  function card(r) {
    const a = agentById(r.agent);
    const el = document.createElement("a");
    el.href = `/receipt/${r.n}`;
    el.className = "card spec";
    el.dataset.agent = r.agent;
    el.setAttribute("aria-label", `Receipt ${fmt.no(r.n)}, agent ${a.id}`);
    el.innerHTML = `${DC.coinHTML(r)}<div class="meta"><span class="no">${fmt.no(r.n)}</span><span class="d">${fmt.date(r.t)}</span><span class="muted">${a.title}</span><span class="d">${fmt.count(r.calls)} calls</span></div>`;
    return el;
  }
  const CALLS = DC.NET.calls[0].toUpperCase() + DC.NET.calls.slice(1);
  function paintTotals() {
    if (DC.failed) {
      $("#totals").innerHTML = [CALLS, DC.RETIRED, "Receipts sealed", "Agents metered"].map((k) => `<div><div class="v">–</div><div class="k">${k}</div></div>`).join("");
      $("#wall").innerHTML = `<p class="muted">${DC.READ_FAILED}</p>`;
      return;
    }
    const kg = state.receipts.reduce((s, r) => s + r.mg, 0) / 1e6;
    $("#totals").innerHTML = `<div><div class="v tnum">${fmt.count(state.calls)}</div><div class="k">${CALLS}</div></div><div><div class="v tnum lime">${fmt.count(kg)} kg</div><div class="k">${DC.RETIRED}</div></div><div><div class="v tnum">${state.receipts.length}</div><div class="k">Receipts sealed</div></div><div><div class="v tnum">${AGENTS.length}</div><div class="k">Agents metered</div></div>`;
    if (!state.receipts.length && !$("#wall .spec")) $("#wall").insertAdjacentHTML("afterbegin", `<p class="muted">No receipts yet. The first one is minted when an agent's pool reaches ${fmt.mass(DC.THRESHOLD_MG)}.</p>`);
  }

  // The next coin, forming: the featured agent's real pending grams. Dashed and "not minted", so it never reads as a receipt.
  const F = DC.FEATURED;
  const ghost = document.createElement("a");
  ghost.className = "card spec forming";
  ghost.href = `/agent/${F}`;
  ghost.dataset.agent = F;
  function paintGhost() {
    const pend = Math.min(state.pending[F] || 0, DC.THRESHOLD_MG);
    const next = state.receipts.reduce((m, r) => Math.max(m, r.n), 0) + 1;
    const a = agentById(F);
    ghost.setAttribute("aria-label", `${fmt.no(next)} forming, not minted: ${fmt.mass(pend)} of ${fmt.mass(DC.THRESHOLD_MG)}, agent ${a.id}`);
    ghost.innerHTML = `<div class="gc"><div class="lq" style="height:${(pend / DC.THRESHOLD_MG) * 100}%"></div><div class="t"><i>Forming</i><b>${fmt.count(Math.round(pend / 1000))} g</b><i>of ${fmt.mass(DC.THRESHOLD_MG)}</i></div></div>
      <div class="meta"><span class="no">${fmt.no(next)}</span><span class="d">not minted</span><span class="muted">${a.title}</span><span class="d">${fmt.count(Math.round((DC.THRESHOLD_MG - pend) / 1000))} g to go</span></div>`;
  }
  function paintChips() {
    const opts = [["all", "All agents", DC.failed ? "–" : state.receipts.length], ...agentsWithReceipts().map((a) => [String(a.id), `#${a.id} ${a.name}`, state.receipts.filter((r) => r.agent === a.id).length])];
    $("#chips").innerHTML = opts.map(([v, l, n]) => `<button class="chip" aria-pressed="${filter === v}" data-v="${v}">${l}<span class="n">${n}</span></button>`).join("");
  }
  function applyFilter() { document.querySelectorAll(".spec").forEach((s) => s.classList.toggle("hidden", filter !== "all" && s.dataset.agent !== filter)); }
  const agentsWithReceipts = () => DC.AGENTS.filter((a) => state.receipts.some((r) => r.agent === a.id));
  state.receipts.forEach((r) => $("#wall").appendChild(card(r)));
  paintTotals(); paintChips();
  if (!DC.failed && !DC.mock && F) { paintGhost(); $("#wall").appendChild(ghost); on("accrual", paintGhost); }
  $("#chips").addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (!b) return; filter = b.dataset.v; paintChips(); applyFilter(); });

  // "Simulate a retirement" only exists on the simulated stream.
  if (DC.mock) $("#sim").addEventListener("click", () => DC.forceRetire(AGENTS[Math.floor(Math.random() * 3)].id));
  else $("#sim").remove();
  on("retired", (r) => {
    $("#wall > p")?.remove();
    const el = card(r);
    $("#wall").prepend(el);
    if (ghost.isConnected) paintGhost();
    paintTotals(); paintChips(); applyFilter();
    if (window.gsap && !reduced) {
      gsap.from(el, { y: -60, opacity: 0, duration: 0.7, ease: "bounce.out" });
      gsap.fromTo(el.querySelector(".seal"), { scale: 2.6, rotate: -50, opacity: 0 }, { scale: 1, rotate: -12, opacity: 1, duration: 0.6, delay: 0.55, ease: "back.out(2.4)" });
    }
    DC.toast(`${fmt.no(r.n)} minted and sealed`);
  });
}
