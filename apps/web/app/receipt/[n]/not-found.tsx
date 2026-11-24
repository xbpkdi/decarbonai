import { ChromeRuntime } from "@/components/ChromeRuntime";
import { MissingReceipt } from "@/components/pages/MissingReceipt";
import { NETWORK } from "@/lib/config";
import { getSnapshotSafe } from "@/lib/server/chain";
import "@/styles/receipt.css";

/** /receipt/<n> with no such Retired event: what exists, and how far the next receipt is, read from the chain. */
export default async function ReceiptNotFound() {
  const snap = await getSnapshotSafe();
  let next = null;
  if (snap) {
    // Receipt numbers are global: the next one goes to whichever account reaches the threshold first.
    const pending = new Map<number, number>();
    for (const a of snap.accruals) pending.set(a.agent, (pending.get(a.agent) ?? 0) + a.mg);
    for (const r of snap.retirements) pending.set(r.agent, (pending.get(r.agent) ?? 0) - r.mg);
    const [agent, mg] = [...pending].sort((x, y) => y[1] - x[1])[0] ?? [null, 0];
    next = {
      n: snap.retirements.reduce((m, r) => Math.max(m, r.n), 0) + 1,
      agent: mg > 0 ? agent : null,
      mg: Math.max(0, mg),
      thresholdMg: snap.thresholdMg,
      receipts: snap.retirements.map((r) => r.n).sort((x, y) => x - y),
    };
  }
  return (
    <main className="wrap missing" data-page="receipt-missing">
      <MissingReceipt next={next} network={NETWORK.name} testnet={NETWORK.testnet} />
      <ChromeRuntime />
    </main>
  );
}
