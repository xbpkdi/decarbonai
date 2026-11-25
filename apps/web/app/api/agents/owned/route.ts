import { isAddress } from "viem";
import { ownedAgents } from "@/lib/server/chain";
import { getNet } from "@/lib/server/net";

/** ERC-8004 agent ids held by a wallet, for the "Your agents" lookup. */
export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address") ?? "";
  if (!isAddress(address)) return Response.json({ error: "bad address" }, { status: 400 });
  try {
    return Response.json({ ids: await ownedAgents(await getNet(), address) });
  } catch {
    return Response.json({ error: "lookup failed" }, { status: 503 });
  }
}
