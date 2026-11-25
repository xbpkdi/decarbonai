import type { Metadata } from "next";
import { ReceiptsMarkup } from "@/components/pages/ReceiptsMarkup";
import { Runtime } from "@/components/Runtime";
import { getSnapshotSafe } from "@/lib/server/chain";
import { getNet } from "@/lib/server/net";
import "@/styles/receipts.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Receipts" };

export default async function ReceiptsPage() {
  const net = await getNet();
  const snapshot = await getSnapshotSafe(net);
  return (
    <>
      <main data-page="receipts">
        <ReceiptsMarkup net={net} />
      </main>
      <Runtime page="receipts" snapshot={snapshot} />
    </>
  );
}
