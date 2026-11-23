import { NETWORK, UNBACKED } from "@/lib/config";
import type { AgentFeedback } from "@/lib/server/chain";

/** Says only what the ERC-8004 registry holds from this deployment's adapter. */
function feedbackNote(f: AgentFeedback | null) {
  if (!f) return "The ERC-8004 registry could not be read right now.";
  const rule = "The pool writes carbon-settled feedback only when a backed lot is burned.";
  const mock = UNBACKED ? ` ${NETWORK.short} burns a mock lot${f.current ? "" : ", so this pool has written none"}.` : "";
  const old = f.superseded ? ` ${f.superseded} registry ${f.superseded === 1 ? "entry comes" : "entries come"} from a superseded adapter.` : "";
  return rule + mock + old;
}

/* Server-rendered markup for the Agent page; lib/dc/pages/agent.js fills and animates it. */
export function AgentMarkup({ feedback, yourAgents }: { feedback: AgentFeedback | null; yourAgents: React.ReactNode }) {
  const settled = Boolean(feedback?.current);
  return (
    <>
      <header className="page-head">
    <div className="wrap head-grid">
      <div>
        <span className="eyebrow" id="eb"></span>
        <h1 className="display" id="name">Agent</h1>
        <p className="lead" id="note"></p>
        <dl className="meta" id="meta"></dl>
        <nav className="agent-tabs" aria-label="Agents" id="tabs"></nav>
        {yourAgents}
      </div>
      <section className="card bar-mint rep" aria-labelledby="h-rep">
        <div className="row" style={{ justifyContent: "space-between" }}><span className="eyebrow" id="h-rep">ERC-8004 reputation</span><span className={`pill pill-dot ${settled ? "pill-settled sparkle" : "pill-smoke"}`} id="settled">{settled ? "Carbon-settled" : feedback ? "No feedback yet" : "Not read"}</span></div>
        <div className="row" style={{ marginTop: "14px", alignItems: "baseline" }}><span className="big" id="repN">{feedback ? feedback.current : "–"}</span><span className="muted">{feedback?.current === 1 ? "entry" : "entries"} from this pool</span></div>
        <p className="dim" style={{ fontSize: "13px", marginTop: "8px" }}>{feedbackNote(feedback)}</p>
      </section>
    </div>
  </header>

  <div className="wrap">
    <section className="section" aria-label="Carbon ledger"><div className="stats" id="stats"></div></section>

    <section className="section" aria-labelledby="h-tl">
      <div className="section-title"><h2 id="h-tl">Footprint timeline</h2>
        <div className="tl-legend"><span><i style={{ background: "var(--smoke)" }}></i>Metered, not yet covered</span><span><i style={{ background: "var(--mint)" }}></i>{UNBACKED ? "Covered by a mock-retirement receipt" : "Covered by a receipt"}</span><span className="hide-sm"><i style={{ background: "var(--avax)" }}></i>New call</span></div></div>
      <div className="card">
        <div className="timeline" id="tl"><canvas id="tlc" aria-label="Every paid call as a dot over time. Ranges covered by a receipt are mint."></canvas><div className="tl-tip" id="tip"></div></div>
      </div>
      <p className="dim" style={{ fontSize: "13px", marginTop: "10px" }}>Every paid call is a dot. When a pool fills, the calls it covered recrystallise in green under their receipt number. Hover a dot to see its meter batch tx.</p>
    </section>

    <section className="section" aria-labelledby="h-next">
      <div className="card next">
        <div><h2 id="h-next" style={{ fontSize: "20px", fontWeight: "600" }}>Next retirement</h2><p className="muted" style={{ marginTop: "8px" }}><span className="big" id="toGo"></span> g to go</p></div>
        <div><div id="scale"></div><div className="scale-ticks" aria-hidden="true"><span style={{ left: "0" }}>0</span><span style={{ left: "20%" }}>200</span><span style={{ left: "40%" }}>400</span><span style={{ left: "60%" }}>600</span><span style={{ left: "80%" }}>800</span><span style={{ left: "100%" }}>1 kg</span></div></div>
      </div>
    </section>

    <section className="section" aria-labelledby="h-rc">
      <div className="section-title"><h2 id="h-rc">Receipts</h2><span className="dim" style={{ fontSize: "13px" }}>Soulbound ERC-5192 tokens. They cannot be transferred or sold.</span></div>
      <div className="card" style={{ overflowX: "auto", position: "relative" }}><table className="tbl"><thead><tr><th>Receipt</th><th>Minted</th><th className="r">Amount</th><th className="r">Calls</th><th className="r">Tx</th></tr></thead><tbody id="rc"></tbody></table></div>
    </section>
  </div>
    </>
  );
}
