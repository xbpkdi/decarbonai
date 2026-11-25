import { MAINNET_PROOF, type Net } from "@/lib/config";

/* Server-rendered markup for the Methodology page; lib/dc/pages/methodology.js fills and animates it. */
export function MethodologyMarkup({ net }: { net: Net }) {
  const { deployment: DEPLOYMENT, token: TOKEN } = net;
  const NETWORK = net;
  return (
    <>
      <header className="page-head">
    <div className="wrap">
      <span className="eyebrow">Methodology · {DEPLOYMENT.methodologyVersion}</span>
      <h1 className="display">How a call becomes grams</h1>
      <p className="lead">Every paid call is priced before it runs, from its model class, prompt length and declared max output. The factors are versioned and their hash is on-chain. Each receipt stores the hash used for its last call.</p>
      <a className="hashbadge" id="hb" href={`${NETWORK.explorer}/address/${DEPLOYMENT.retirementPool}`} target="_blank" rel="noreferrer"><span className="dot-live"></span><span className="k">on-chain hash</span><span style={{ color: "var(--avax)" }} id="hbv"></span><span style={{ color: "var(--avax)" }}>↗</span></a>
    </div>
  </header>

  <div className="wrap">
    <section className="section chk-sec" aria-labelledby="h-chk" id="check" hidden>
      <div className="section-title"><h2 id="h-chk">Check it against {NETWORK.short}</h2><span className="dim" style={{ fontSize: "13px" }}>Uses the inputs our demo script declares. The result should match what the meter wrote on-chain.</span></div>
      <div className="card bar-mint chk" id="chk"></div>
      <p className="dim" style={{ fontSize: "13px", marginTop: "10px" }} id="chkNote"></p>
    </section>

    <section className="section" aria-labelledby="h-calc">
      <div className="section-title"><h2 id="h-calc">Price a call</h2><span className="dim" style={{ fontSize: "13px" }}>Same formula as the middleware, which uses the declared token limits</span></div>
      <div className="card calc bar-mint">
        <div className="ctl">
          <div><div className="lbl">Model class</div>{/* biome-ignore lint/a11y/useSemanticElements: segmented control styled as a pill row */}
            <div className="seg" id="seg" role="group" aria-label="Model class"></div></div>
          <div><label className="lbl" htmlFor="tin">Input tokens <output id="tinO"></output></label><input type="range" id="tin" min="0" max="20000" step="100" value="3000" /></div>
          <div><label className="lbl" htmlFor="tout">Output tokens <output id="toutO"></output></label><input type="range" id="tout" min="0" max="8000" step="50" value="1500" /></div>
          <div><label className="lbl" htmlFor="calls">Calls per day <output id="callsO"></output></label><input type="range" id="calls" min="1" max="5000" step="1" value="500" /></div>
        </div>
        <div className="res" aria-live="polite">
          <div><span className="eyebrow">Carbon per call</span><div className="bigout"><span className="v tnum" id="g"></span><span className="u">g CO₂e</span></div><div className="dim" style={{ fontSize: "13px", marginTop: "6px" }} id="range"></div></div>
          <div><div className="gauge"><span className="mk" id="mk"></span></div><div className="gauge-l"><span>0.1 g · low</span><span>10 g</span><span>100 g · high</span></div></div>
          <div className="minis">
            <div className="mini"><div className="k">Surcharge / call</div><div className="v tnum" id="sur"></div></div>
            <div className="mini"><div className="k">Per day</div><div className="v tnum" id="day"></div></div>
            <div className="mini"><div className="k">Calls per 1 kg</div><div className="v tnum" id="perkg"></div></div>
          </div>
        </div>
      </div>
    </section>

    <section className="section" aria-labelledby="h-f">
      <div className="section-title"><h2 id="h-f">The formula, with your numbers</h2></div>
      <div className="card formula" id="formula"></div>
    </section>

    <section className="section" aria-labelledby="h-t">
      <div className="section-title"><h2 id="h-t">Energy per 1,000 tokens</h2><span className="dim mono" style={{ fontSize: "12px" }}>PUE 1.1 · grid 400 g/kWh · 0.005 g embodied per call</span></div>
      <div className="card" style={{ overflowX: "auto", position: "relative" }}><table className="tbl"><thead><tr><th>Model class</th><th className="r">Output (Wh)</th><th className="r">Input (Wh)</th><th className="r">g per 1k output tokens</th></tr></thead><tbody id="ft"></tbody></table></div>
    </section>

    <section className="section">
      <div className="warnbox" role="note">
        <h2><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/></svg>Limits (v0)</h2>
        <ul>
          <li>Factors are rough v0 estimates with one global grid average (400 g/kWh). EcoLogits factors are planned, under a new hash.</li>
          <li>We run the meter, so you trust us on the grams it reports.</li>
          {NETWORK.testnet ? (
            <li>On {NETWORK.short}, DCO2 is a mock credit, payments use {TOKEN.name} and the API returns placeholder text.</li>
          ) : (
            <li>Each DCO2 lot is minted 1:1 against a real retired credit. You trust us to keep it 1:1. The lot stores the registry serial.</li>
          )}
        </ul>
        <p className="mainnet" id="mainnet">
          <b>Mainnet:</b> we retired 1 t of {MAINNET_PROOF.credit} for DecarbonAI (<a href={MAINNET_PROOF.certificate} target="_blank" rel="noreferrer">certificate ↗</a>). It backs the <a href={MAINNET_PROOF.pool} target="_blank" rel="noreferrer">pool on Avalanche C-Chain ↗</a>, which has minted receipts <a href={MAINNET_PROOF.receiptTxs[0]} target="_blank" rel="noreferrer">No. 0001 ↗</a> and <a href={MAINNET_PROOF.receiptTxs[1]} target="_blank" rel="noreferrer">No. 0002 ↗</a>. Both wrote carbon-settled ERC-8004 feedback for agent #1855.
        </p>
      </div>
    </section>
  </div>
    </>
  );
}
