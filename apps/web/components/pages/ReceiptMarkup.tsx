/* Server-rendered markup for the Receipt page; lib/dc/pages/receipt.js fills and animates it. */
export function ReceiptMarkup() {
  return (
    <>
      <section className="hero" aria-labelledby="rt">
    <div className="stage3d"><div className="tilt" id="tilt"></div><div className="rim-note">Soulbound · cannot be transferred</div></div>
    <div className="info" id="info"></div>
  </section>

  <section className="section verify-grid" aria-labelledby="h-v">
    <div className="card bar-red">
      <div className="card-h"><h2 id="h-v">Verify on-chain</h2><button type="button" className="btn btn-outline btn-sm" id="rerun">Run again</button></div>
      <ol className="checks" id="checks"></ol>
    </div>
    <div className="card qr-card">
      <span className="eyebrow">Open on your phone</span>
      <div style={{ marginTop: "14px" }}><div className="qr" id="qr"></div></div>
      <p className="dim" style={{ fontSize: "13px", marginTop: "12px" }}>Scan to open this receipt and check it yourself on Snowtrace.</p>
      <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: "12px" }} id="share">Copy link</button>
    </div>
  </section>
    </>
  );
}
