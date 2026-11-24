export default function init(DC) {
  const { FACTORS, METHOD, NET, fmt, surchargeFor } = DC;
  const $ = (s) => document.querySelector(s);
  $("#hbv").textContent = DC.short(METHOD.hash, 10, 6);
  $("#hb").href = `${NET.explorer}/address/${DC.CONTRACTS.RetirementPool}`;
  let model = "claude-sonnet";
  $("#seg").innerHTML = Object.entries(FACTORS.models).map(([k, m]) => `<button aria-pressed="${k === model}" data-m="${k}">${m.label}</button>`).join("");
  $("#seg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; model = b.dataset.m; document.querySelectorAll("#seg button").forEach((x) => x.setAttribute("aria-pressed", x === b)); calc(); });
  ["tin", "tout", "calls"].forEach((id) => $("#" + id).addEventListener("input", calc));

  function calc() {
    const tin = +$("#tin").value, tout = +$("#tout").value, calls = +$("#calls").value;
    const f = FACTORS.models[model];
    const { wh, g } = DC.gramsPerCall(model, tin, tout);
    const mg = Math.round(g * 1000);
    $("#tinO").textContent = fmt.count(tin); $("#toutO").textContent = fmt.count(tout); $("#callsO").textContent = fmt.count(calls);
    $("#g").textContent = g < 10 ? g.toFixed(2) : g.toFixed(1);
    $("#range").textContent = `Range ${(g * 0.4).toFixed(2)} g to ${(g * 2.5).toFixed(2)} g. The pool accrues the mid value.`;
    $("#sur").textContent = fmt.usd(surchargeFor(mg), 5);
    const day = g * calls;
    $("#day").textContent = day >= 1000 ? (day / 1000).toFixed(2) + " kg" : day.toFixed(0) + " g";
    $("#perkg").textContent = fmt.count(Math.ceil(1000 / g));
    const pos = Math.max(0, Math.min(1, (Math.log10(g) + 1) / 3));
    $("#mk").style.left = pos * 100 + "%";
    $("#formula").innerHTML = `energy = ${FACTORS.base} + <span class="s">${fmt.count(tout)}</span> ÷ 1000 × ${f.out} + <span class="s">${fmt.count(tin)}</span> ÷ 1000 × ${f.in} = <b>${wh.toFixed(2)} Wh</b><br>
      g CO₂e = ${wh.toFixed(2)} ÷ 1000 × ${FACTORS.grid} g/kWh × PUE ${FACTORS.pue} + ${FACTORS.embodied} g = <b style="color:var(--mint)">${g.toFixed(3)} g</b> → <b>${fmt.count(mg)} mg</b>, batched on-chain<br>
      surcharge = ceil(${fmt.count(mg)} mg × ${fmt.usd(DC.PRICE_PER_TONNE, 2)} per tonne ÷ 10⁹) = <b style="color:var(--avax)">${fmt.usd(surchargeFor(mg), 5)}</b>`;
  }
  calc();
  check();
  $("#ft").innerHTML = Object.entries(FACTORS.models).map(([k, m]) => `<tr><td>${m.label} <span class="mono dim" style="font-size:12px">${k}</span></td><td class="r">${m.out}</td><td class="r">${m.in}</td><td class="r"><b style="font-weight:600">${((m.out / 1000) * FACTORS.grid * FACTORS.pue).toFixed(2)} g</b></td></tr>`).join("");

  // Check it against the chain: this page's formula, fed what scripts/demo-burst.ts declares
  // (reasoning-heavy, 1,000 max output tokens, a "burst call N" prompt of ~3 tokens), must equal a real CarbonAccrued.
  function check() {
    if (DC.mock || DC.failed) return;
    const c = { model: "reasoning-heavy", tin: 3, tout: 1000 };
    const mg = Math.round(DC.gramsPerCall(c.model, c.tin, c.tout).g * 1000);
    const acc = DC.events.accruals;
    const batch = (a) => acc.filter((b) => b.tx === a.tx).length;
    const same = acc.filter((a) => a.mg === mg);
    // Prefer a call that was alone in its meter batch: its tx shows exactly this amount.
    const hit = same.find((a) => batch(a) === 1) || same[0];
    if (!hit) return;
    const ok = hit.mg === mg;
    $("#chk").innerHTML = `<div class="box"><div class="k">This page's formula</div><div class="sub mono">${FACTORS.models[c.model].label} · ${c.tin} in · ${fmt.count(c.tout)} out</div><div class="v tnum">${fmt.count(mg)}<small>mg</small></div></div>
      <div class="eq" aria-hidden="true">=</div>
      <div class="box"><div class="k">On-chain CarbonAccrued</div><div class="sub mono">${DC.hashLink(hit.tx, 8, 6)} · block ${fmt.count(hit.block)}</div><div class="v tnum">${fmt.count(hit.mg)}<small>mg</small></div></div>
      <div class="ok${ok ? "" : " no"}"><b aria-hidden="true">${ok ? "✓" : "✗"}</b><span class="mono dim">${ok ? "match" : "no match"}</span></div>`;
    $("#chkNote").textContent = `${fmt.count(same.length)} of ${fmt.count(acc.length)} metered calls on ${NET.short} carry exactly ${fmt.count(mg)} mg. That proves the meter ran this formula, not that the tokens were used.`;
    $("#check").hidden = false;
  }
}
