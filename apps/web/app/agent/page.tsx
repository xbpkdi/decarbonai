import { redirect } from "next/navigation";
import { getNet } from "@/lib/server/net";

export const dynamic = "force-dynamic";

/** /agent opens the network's featured agent (mainnet 1855, Fuji the demo agent). */
export default async function AgentIndex() {
  const net = await getNet();
  redirect(`/agent/${net.featured}${net.testnet ? "?network=fuji" : ""}`);
}
