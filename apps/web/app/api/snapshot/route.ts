import { getSnapshotSafe } from "@/lib/server/chain";
import { getNet } from "@/lib/server/net";

/** Live state for the client on ?network=<mainnet|fuji>. `?since=<block>` returns only events after that block. */
export async function GET(req: Request) {
  const snap = await getSnapshotSafe(await getNet());
  if (!snap) return Response.json({ error: "chain read failed" }, { status: 503 });
  const since = Number(new URL(req.url).searchParams.get("since") || 0);
  if (!since) return Response.json(snap);
  return Response.json({
    ...snap,
    accruals: snap.accruals.filter((a) => a.block > since),
    retirements: snap.retirements.filter((r) => r.block > since),
  });
}
