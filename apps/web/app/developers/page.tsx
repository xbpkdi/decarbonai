import type { Metadata } from "next";
import { DevelopersMarkup } from "@/components/pages/DevelopersMarkup";
import { Runtime } from "@/components/Runtime";
import { getSnapshotSafe } from "@/lib/server/chain";
import { demoConfig } from "@/lib/server/demo";
import "@/styles/developers.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Developers" };

export default async function DevelopersPage() {
  const snapshot = await getSnapshotSafe();
  // The hosted paid API the snippets point at. Anything but https is not public: show placeholders instead.
  const hosted = process.env.NEXT_PUBLIC_DEMO_API_URL ?? "";
  const api = hosted.startsWith("https://") ? hosted.replace(/\/$/, "") : "";
  return (
    <>
      <main data-page="developers" data-api={api}>
        <DevelopersMarkup demo={Boolean(demoConfig())} />
      </main>
      <Runtime page="developers" snapshot={snapshot} />
    </>
  );
}
