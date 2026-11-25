import { verifyReceipt } from "@/lib/server/chain";
import { getNet } from "@/lib/server/net";

export async function GET(_req: Request, { params }: { params: Promise<{ n: string }> }) {
  const n = Number((await params).n);
  if (!Number.isInteger(n) || n < 1) return Response.json({ error: "bad receipt number" }, { status: 400 });
  return Response.json(await verifyReceipt(await getNet(), n));
}
