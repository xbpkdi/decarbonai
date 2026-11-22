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
  function paintTotals() {
    const kg = state.receipts.reduce((s, r) => s + r.mg, 0) / 1e6;
    $("#totals").innerHTML = `<div><div class="v tnum">${state.receipts.length}</div><div class="k">Receipts</div></div><div><div class="v tnum" style="color:var(--mint)">${fmt.count(kg)}<span style="font-family:var(--f-ui);font-size:18px;color:var(--text-2)"> kg</span></div><div class="k">CO₂e retired</div></div><div><div class="v tnum">${AGENTS.length}</div><div class="k">Agents</div></div>`;
    if (!state.receipts.length) $("#wall").innerHTML = `<p class="muted">No receipts yet. The first one is minted when an agent's pool reaches ${fmt.mass(DC.THRESHOLD_MG)}.</p>`;
  }
  function paintChips() {
    const opts = [["all", "All agents", state.receipts.length], ...agentsWithReceipts().map((a) => [String(a.id), `#${a.id} ${a.name}`, state.receipts.filter((r) => r.agent === a.id).length])];
    $("#chips").innerHTML = opts.map(([v, l, n]) => `<button class="chip" aria-pressed="${filter === v}" data-v="${v}">${l}<span class="n">${n}</span></button>`).join("");
  }
  function applyFilter() { document.querySelectorAll(".spec").forEach((s) => s.classList.toggle("hidden", filter !== "all" && s.dataset.agent !== filter)); }
  const agentsWithReceipts = () => DC.AGENTS.filter((a) => state.receipts.some((r) => r.agent === a.id));
  state.receipts.forEach((r) => $("#wall").appendChild(card(r)));
  paintTotals(); paintChips();
  $("#chips").addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (!b) return; filter = b.dataset.v; paintChips(); applyFilter(); });

  // "Simulate a retirement" only exists on the simulated stream.
  if (DC.mock) $("#sim").addEventListener("click", () => DC.forceRetire(AGENTS[Math.floor(Math.random() * 3)].id));
  else $("#sim").remove();
  on("retired", (r) => {
    $("#wall > p")?.remove();
    const el = card(r);
    $("#wall").prepend(el);
    paintTotals(); paintChips(); applyFilter();
    if (window.gsap && !reduced) {
      gsap.from(el, { y: -60, opacity: 0, duration: 0.7, ease: "bounce.out" });
      gsap.fromTo(el.querySelector(".seal"), { scale: 2.6, rotate: -50, opacity: 0 }, { scale: 1, rotate: -12, opacity: 1, duration: 0.6, delay: 0.55, ease: "back.out(2.4)" });
    }
    DC.toast(`${fmt.no(r.n)} minted and sealed`);
  });
}
