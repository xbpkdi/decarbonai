import type { Metadata } from "next";
import { LiveMarkup } from "@/components/pages/LiveMarkup";
import { Runtime } from "@/components/Runtime";
import { FRESH_MS } from "@/lib/types";
import { getSnapshotSafe } from "@/lib/server/chain";
import { getNet } from "@/lib/server/net";
import "@/styles/live.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { absolute: "Live · DecarbonAI" } };

export default async function LivePage() {
  const net = await getNet();
  const snapshot = await getSnapshotSafe(net);
  const last = snapshot?.accruals.at(-1)?.t ?? 0;
  return (
    <>
      <main data-page="index">
        <div className="stage">
          <LiveMarkup net={net} status={!snapshot ? "NO DATA" : Date.now() - last < FRESH_MS ? "LIVE" : "IDLE"} />
        </div>
      </main>
      <Runtime page="index" snapshot={snapshot} />
    </>
  );
}
