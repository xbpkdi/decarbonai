import type { Metadata } from "next";
import { ReceiptsMarkup } from "@/components/pages/ReceiptsMarkup";
import { Runtime } from "@/components/Runtime";
import { getSnapshotSafe } from "@/lib/server/chain";
import "@/styles/receipts.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Receipts" };

export default async function ReceiptsPage() {
  const snapshot = await getSnapshotSafe();
  return (
    <>
      <main data-page="receipts">
        <ReceiptsMarkup />
      </main>
      <Runtime page="receipts" snapshot={snapshot} />
    </>
  );
}
