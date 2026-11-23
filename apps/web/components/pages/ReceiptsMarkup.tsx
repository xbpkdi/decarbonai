import { NETWORK, UNBACKED } from "@/lib/config";

/* Server-rendered markup for the Receipts page; lib/dc/pages/receipts.js fills and animates it. */
export function ReceiptsMarkup() {
  return (
    <>
      <header className="page-head">
    <div className="wrap head-grid">
      <div>
        <span className="eyebrow">Soulbound ERC-5192 · {NETWORK.name}</span>
        <h1 className="display">Receipts</h1>
        <p className="lead">{UNBACKED ? "Each coin is a soulbound testnet receipt, minted when a payer's account reaches 1 kg and the pool burns a mock credit. It cannot be moved, and it is not a claim on a real tonne." : "Each coin is a soulbound receipt, minted when a payer's account reaches 1 kg and the pool burns a backed credit. It cannot be sold or moved."}</p>
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
