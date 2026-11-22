import type { Metadata } from "next";
import { MethodologyMarkup } from "@/components/pages/MethodologyMarkup";
import { Runtime } from "@/components/Runtime";
import { getSnapshotSafe } from "@/lib/server/chain";
import "@/styles/methodology.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Methodology" };

export default async function MethodologyPage() {
  const snapshot = await getSnapshotSafe();
  return (
    <>
      <main data-page="methodology">
        <MethodologyMarkup />
      </main>
      <Runtime page="methodology" snapshot={snapshot} />
    </>
  );
}
