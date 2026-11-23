import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { retireTonnes } from "@retirement/carbonmark";

// v1 retirement endpoint. It spends real Carbonmark credits and Fuji gas, so it is closed by
// default: it only runs when OFFSET_ADMIN_TOKEN is set server-side and the request carries
// `Authorization: Bearer <OFFSET_ADMIN_TOKEN>`. The v2 path is x402 + RetirementPool on Fuji.
const MAX_TONNES = 0.01;

function authorized(req: Request): boolean {
  const token = process.env.OFFSET_ADMIN_TOKEN;
  if (!token) return false;
  const header = req.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${token}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(req: Request) {
  if (!process.env.OFFSET_ADMIN_TOKEN) {
    return NextResponse.json(
      { error: "Direct retirement is disabled. DecarbonAI v2 settles carbon via x402 on Avalanche Fuji." },
      { status: 503 },
    );
  }
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.CARBONMARK_API_KEY) {
    return NextResponse.json({ error: "CARBONMARK_API_KEY missing" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as { tonnes?: unknown; mgCO2e?: unknown };
  const tonnes = typeof body.tonnes === "number" ? body.tonnes : 0.001;
  const mgCO2e = typeof body.mgCO2e === "number" ? body.mgCO2e : 1_000_000;
  if (!Number.isFinite(tonnes) || tonnes < 0.001 || tonnes > MAX_TONNES) {
    return NextResponse.json({ error: `tonnes must be between 0.001 and ${MAX_TONNES}` }, { status: 400 });
  }

  try {
    const order = await retireTonnes(tonnes);
    // Not persisted: the .data file store was removed. The caller keeps this response.
    return NextResponse.json({
      id: crypto.randomUUID(),
      tonnes,
      mgCO2e,
      carbonmarkUrl: order.view_retirement_url,
      sourceTx: order.transaction_hash,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Retirement failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
