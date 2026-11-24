import type { Metadata } from "next";
import { MethodologyMarkup } from "@/components/pages/MethodologyMarkup";
import { Runtime } from "@/components/Runtime";
import { getSnapshotSafe } from "@/lib/server/chain";
import { getNet } from "@/lib/server/net";
import "@/styles/methodology.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Methodology" };

export default async function MethodologyPage() {
  const net = await getNet();
  const snapshot = await getSnapshotSafe(net);
  return (
    <>
      <main data-page="methodology">
        <MethodologyMarkup net={net} />
      </main>
      <Runtime page="methodology" snapshot={snapshot} />
    </>
  );
}
