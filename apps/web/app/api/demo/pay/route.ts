import { createPayingFetch, settlementFrom } from "@decarbonai/x402-carbon/client";
import type { CarbonExtra } from "@decarbonai/x402-carbon";
import { NETWORK } from "@/lib/config";
import { demoConfig } from "@/lib/server/demo";

/**
 * One real paid x402 call against the demo API, paid by the server-side test agent wallet. Powers the
 * Developers "Run" button and the Agent "Pay one call" button. Testnet only, rate-limited.
 *
 * Refuses unless every setting is present and well formed (lib/server/demo.ts).
 * Env: DEMO_AGENT_PRIVATE_KEY (funded with test USDC on Fuji), DEMO_API_URL (paid-api base URL),
 * NEXT_PUBLIC_DEMO_AGENT_ID (ERC-8004 id the payments are attributed to).
 *
 * The demo API runs on Render free, which sleeps when idle and takes up to a minute to wake, so the paid
 * call gets 90 s and GET wakes the API (its /health) when a page with a demo button opens.
 */
export const maxDuration = 120;
const WINDOW_MS = 60_000;
const PER_IP = 4;
const GLOBAL = 20;
const hits: { ip: string; t: number }[] = [];

function limited(ip: string) {
  const now = Date.now();
  while (hits.length && now - hits[0].t > WINDOW_MS) hits.shift();
  if (hits.length >= GLOBAL || hits.filter((h) => h.ip === ip).length >= PER_IP) return true;
  hits.push({ ip, t: now });
  return false;
}

export async function POST(req: Request) {
  if (!NETWORK.testnet) return Response.json({ error: "Demo payments run on Fuji only." }, { status: 403 });
  const demo = demoConfig();
  if (!demo) return Response.json({ error: "Demo payments are not configured on this deployment." }, { status: 503 });
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  if (limited(ip)) return Response.json({ error: "Too many demo calls. Try again in a minute." }, { status: 429 });

  let quote: CarbonExtra | undefined;
  let amount = "0";
  const { agentId } = demo;
  const agent = createPayingFetch({
    privateKey: demo.key,
    agentId,
    onPayment: (carbon, a) => {
      quote = carbon;
      amount = a;
    },
  });
  const url = new URL("/v1/infer", demo.api);
  url.searchParams.set("prompt", "Summarise x402 on Avalanche in one line");
  url.searchParams.set("model", "claude-sonnet");
  const started = Date.now();
  try {
    const res = await agent.fetch(url, { signal: AbortSignal.timeout(90_000) });
    const body = await res.json().catch(() => null);
    const settlement = settlementFrom(res);
    if (!res.ok) return Response.json({ error: `Paid API answered ${res.status}.` }, { status: 502 });
    return Response.json({
      path: `${url.pathname}${url.search}`,
      payer: agent.address,
      agentId: agentId.toString(),
      amount,
      quote: quote ?? null,
      tx: settlement?.transaction ?? null,
      ms: Date.now() - started,
      body,
    });
  } catch (e) {
    return Response.json({ error: `Payment failed: ${(e as Error).message.slice(0, 160)}` }, { status: 502 });
  }
}

/** Warm-up: wakes the demo API. Free, no payment, no key used. */
export async function GET() {
  const demo = demoConfig();
  if (!demo) return Response.json({ ok: false }, { status: 503 });
  try {
    const res = await fetch(new URL("/health", demo.api), { cache: "no-store", signal: AbortSignal.timeout(90_000) });
    return Response.json({ ok: res.ok });
  } catch {
    return Response.json({ ok: false }, { status: 502 });
  }
}
