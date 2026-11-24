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
      <section className="card bar-mint nx" aria-labelledby="h-nx">
        <div className="nx-top"><span className="eyebrow" id="h-nx">Next receipt · forming</span><span className="pill pill-smoke pill-dot" id="nxState">Filling</span></div>
        <div className="nx-row">
          <div className="ghost" aria-hidden="true"><div className="lq" id="nxFill"></div><span id="nxNo"></span></div>
          <div><div className="nx-g"><span id="toGo">–</span><small>g to go</small></div><p className="muted nx-note" id="nxNote"></p></div>
        </div>
        <div id="scale"></div>
      </section>
    </div>
  </header>

  <div className="wrap">
    <section className="section" id="empty" aria-labelledby="h-empty" hidden>
      <div className="card empty-ag">
        <div><span className="eyebrow" id="emEb"></span><h2 className="display" id="h-empty">No metered calls yet.</h2><p className="muted" id="emNote"></p></div>
        <div className="acts" id="emActs"></div>
      </div>
    </section>

    <section className="section" aria-label="Carbon ledger">
      <div className="stats" id="stats"></div>
      <div className="rep">
        <span className={`pill pill-dot ${settled ? "pill-settled sparkle" : "pill-smoke"}`} id="settled">{settled ? "Carbon-settled" : feedback ? "No feedback yet" : "Not read"}</span>
        <p><b id="h-rep">ERC-8004 reputation:</b> <span id="repN">{feedback ? feedback.current : "–"}</span> {feedback?.current === 1 ? "entry" : "entries"} from this pool. <span className="dim">{feedbackNote(feedback)}</span></p>
      </div>
    </section>

    <section className="section" id="secTl" aria-labelledby="h-tl">
      <div className="section-title"><h2 id="h-tl">Footprint timeline</h2>
        <div className="tl-legend"><span><i style={{ background: "var(--smoke)" }}></i>Metered, not yet covered</span><span><i style={{ background: "var(--mint)" }}></i>{UNBACKED ? "Covered by a mock-retirement receipt" : "Covered by a receipt"}</span><span className="hide-sm"><i style={{ background: "var(--avax)" }}></i>New call</span></div></div>
      <div className="card">
        <div className="timeline" id="tl"><canvas id="tlc" aria-label="Every paid call as a dot over time. Ranges covered by a receipt are mint."></canvas><div className="tl-tip" id="tip"></div></div>
      </div>
      <p className="dim" style={{ fontSize: "13px", marginTop: "10px" }}>Each dot is a paid call. Calls covered by a receipt turn green. Hover a dot for its meter batch tx.</p>
    </section>

    <section className="section" id="secRc" aria-labelledby="h-rc">
      <div className="section-title"><h2 id="h-rc">Receipts</h2><span className="dim" style={{ fontSize: "13px" }}>Soulbound ERC-5192 tokens. They cannot be transferred or sold.</span></div>
      <div className="card" style={{ overflowX: "auto", position: "relative" }}><table className="tbl"><thead><tr><th>Receipt</th><th>Minted</th><th className="r">Amount</th><th className="r">Calls</th><th className="r">Tx</th></tr></thead><tbody id="rc"></tbody></table></div>
    </section>
  </div>
    </>
  );
}
