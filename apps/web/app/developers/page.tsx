import type { Metadata } from "next";
import { DevelopersMarkup } from "@/components/pages/DevelopersMarkup";
import { Runtime } from "@/components/Runtime";
import { getSnapshotSafe } from "@/lib/server/chain";
import "@/styles/developers.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Developers" };

export default async function DevelopersPage() {
  const snapshot = await getSnapshotSafe();
  // The paid API the snippets point at: the hosted demo API, else the repo's local `npm run api`.
  const api = process.env.NEXT_PUBLIC_DEMO_API_URL || "http://localhost:4021";
  return (
    <>
      <main data-page="developers" data-api={api}>
        <DevelopersMarkup />
      </main>
      <Runtime page="developers" snapshot={snapshot} />
    </>
  );
}
