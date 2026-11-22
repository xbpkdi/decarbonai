import { redirect } from "next/navigation";
import { DEMO_AGENT_ID } from "@/lib/config";
import { getSnapshotSafe } from "@/lib/server/chain";

export const dynamic = "force-dynamic";

/** /agent opens the featured agent: the configured one, else whoever paid last. */
export default async function AgentIndex() {
  const featured = Number(process.env.NEXT_PUBLIC_FEATURED_AGENT_ID || 0) || DEMO_AGENT_ID;
  const snap = featured ? null : await getSnapshotSafe();
  const id = featured ?? snap?.accruals.at(-1)?.agent ?? 0;
  redirect(`/agent/${id}`);
}
