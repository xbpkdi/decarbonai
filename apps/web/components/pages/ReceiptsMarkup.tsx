import { NETWORK } from "@/lib/config";

/* Server-rendered markup for the Receipts page; lib/dc/pages/receipts.js fills and animates it. */
export function ReceiptsMarkup() {
  return (
    <>
      <header className="page-head">
    <div className="wrap head-grid">
      <div>
        <span className="eyebrow">Soulbound ERC-5192 · {NETWORK.name}</span>
        <h1 className="display">Receipts</h1>
        <p className="lead">Every coin is a soulbound token, minted when an agent's pool reaches 1 kg and burns DCO2. It cannot be sold or moved, so a retirement can only ever be claimed once.</p>
      </div>
      <div className="totals" id="totals"></div>
    </div>
  </header>
  <div className="wrap section">
    <div className="bar">
      {/* biome-ignore lint/a11y/useSemanticElements: chip row styled as pills */}
      <div className="chips" role="group" aria-label="Filter by agent" id="chips"></div>
      <button type="button" className="btn btn-outline btn-sm" id="sim">Simulate a retirement</button>
    </div>
    <div className="wall" id="wall"></div>
  </div>
    </>
  );
}
