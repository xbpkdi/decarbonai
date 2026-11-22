import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReceiptMarkup } from "@/components/pages/ReceiptMarkup";
import { Runtime } from "@/components/Runtime";
import { NETWORK } from "@/lib/config";
import { getSnapshotSafe } from "@/lib/server/chain";
import "@/styles/receipt.css";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ n: string }> };

const no = (n: number) => `No. ${String(n).padStart(4, "0")}`;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const n = Number((await params).n);
  const title = `${no(n)} · Receipt`;
  const description = `Soulbound retirement receipt ${no(n)} on ${NETWORK.name}: an AI agent's x402 payments retired their own carbon.`;
  return { title, description, openGraph: { title: `DecarbonAI receipt ${no(n)}`, description }, twitter: { card: "summary_large_image" } };
}

export default async function ReceiptPage({ params }: Props) {
  const { n } = await params;
  if (!/^\d+$/.test(n)) notFound();
  const snapshot = await getSnapshotSafe();
  // Unknown receipt (chain read succeeded, no such Retired event): a real 404.
  if (snapshot && !snapshot.retirements.some((r) => r.n === Number(n))) notFound();
  return (
    <>
      <main className="wrap" data-page="receipt" data-n={n}>
        <ReceiptMarkup />
      </main>
      <Runtime page="receipt" snapshot={snapshot} />
    </>
  );
}
