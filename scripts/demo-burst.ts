// Demo: an agent makes N paid x402 calls on Avalanche Fuji. Each payment carries a carbon surcharge
// that the API's meter settles into the RetirementPool; every 1 kg the pool burns mock DCO2, mints
// a soulbound receipt to the agent and writes ERC-8004 "carbon-settled" feedback.
//
//   node --env-file=.env scripts/demo-burst.ts [calls=100] [concurrency=5]
//   API_URL=http://localhost:4021 ... to use an already running paid-api instead of an in-process one.
import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import type { Hex } from "viem";
import { FUJI, explorer, fujiClient, getAgentBadge, getPoolState, listRetirements, mgToKg } from "@decarbonai/chain";
import { createPayingFetch, settlementFrom } from "@decarbonai/x402-carbon/client";
import { createApp } from "../apps/paid-api/src/app.ts";

const calls = Number(process.argv[2] ?? 100);
const concurrency = Number(process.argv[3] ?? 5);
const model = process.env.DEMO_MODEL ?? "reasoning-heavy";
const maxOutputTokens = Number(process.env.DEMO_MAX_OUTPUT_TOKENS ?? 1000);
const agentKey = process.env.AGENT_PRIVATE_KEY as Hex;
const agentId = process.env.AGENT_ID ? BigInt(process.env.AGENT_ID) : undefined;
if (!agentKey) throw new Error("AGENT_PRIVATE_KEY missing (run scripts/setup-agent.ts)");

const client = fujiClient();
let apiUrl = process.env.API_URL;
let meter: ReturnType<typeof createApp>["meter"] | undefined;
let server: ReturnType<typeof serve> | undefined;
if (!apiUrl) {
  const meterKey = (process.env.METER_PRIVATE_KEY ?? process.env.FUJI_PRIVATE_KEY) as Hex;
  const created = createApp({ meterKey, rpcUrl: process.env.FUJI_RPC_URL });
  meter = created.meter;
  await meter.ensureAllowance();
  server = serve({ fetch: created.app.fetch, port: 0 });
  await new Promise((r) => server!.once("listening", r));
  apiUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
}

const agent = createPayingFetch({ privateKey: agentKey, agentId });
const bar = (p: number) => `[${"#".repeat(Math.round(Math.min(p, 1) * 30)).padEnd(30, ".")}]`;

async function show(label: string) {
  const [pool, badge] = await Promise.all([getPoolState(client), getAgentBadge(client, agent.address)]);
  console.log(
    `${label}  pool: ${mgToKg(pool.totalAccruedMg).toFixed(3)} kg accrued, ${mgToKg(pool.totalRetiredMg).toFixed(0)} kg retired, ` +
      `${pool.totalRetirements} receipts | agent #${badge.agentId}: ${badge.calls} calls, ${mgToKg(badge.retiredMg)} kg retired, ` +
      `next ${bar(badge.progressToNextRetirement)} ${(badge.progressToNextRetirement * 100).toFixed(0)}%` +
      (badge.reputation ? ` | ERC-8004 carbon-settled x${badge.reputation.count}` : ""),
  );
  return { pool, badge };
}

console.log(`DecarbonAI x402 burst: ${calls} calls of ${model} (${maxOutputTokens} out tokens) via ${apiUrl}`);
console.log(`pool ${explorer.address(FUJI.retirementPool)}\nagent ${agent.address}${agentId ? ` (ERC-8004 #${agentId})` : ""}\n`);
const before = await show("before");
const startReceipts = before.badge.receipts;

let done = 0;
let failed = 0;
let gTotal = 0;
let paidUnits = 0n;
const t0 = Date.now();
async function one(i: number) {
  const url = `${apiUrl}/v1/infer?model=${model}&maxOutputTokens=${maxOutputTokens}&prompt=${encodeURIComponent(`burst call ${i}`)}`;
  const res = await agent.fetch(url);
  if (!res.ok) {
    failed++;
    console.log(`  #${i} HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
    return;
  }
  const body = (await res.json()) as { carbon: { gCO2e: number; totalUnits: string } };
  const s = settlementFrom(res);
  done++;
  gTotal += body.carbon.gCO2e;
  paidUnits += BigInt(body.carbon.totalUnits);
  if (done % 10 === 0 || done === 1) {
    console.log(`  ${String(done).padStart(3)}/${calls} paid $${(Number(paidUnits) / 1e6).toFixed(4)}  +${gTotal.toFixed(1)} gCO2e  x402 tx ${s?.transaction ? explorer.tx(s.transaction) : "?"}`);
  }
}
const queue = Array.from({ length: calls }, (_, i) => i + 1);
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    for (let i = queue.shift(); i !== undefined; i = queue.shift()) await one(i);
  }),
);
console.log(`\n${done} paid, ${failed} failed in ${((Date.now() - t0) / 1000).toFixed(1)}s; waiting for pool accruals to land...`);

if (meter) {
  const records = await meter.drain();
  const bad = records.filter((r) => r.status === "failed");
  if (process.env.DEBUG) console.log(`  meter records: ${records.length}`, records.map((r) => r.status).join(","));
  if (bad.length) console.log(`  ${bad.length} accruals failed: ${bad[0].error}`);
} else {
  const target = before.badge.calls + BigInt(done);
  for (let i = 0; i < 60 && (await getAgentBadge(client, agent.address)).calls < target; i++) await new Promise((r) => setTimeout(r, 2000));
}

let after = await show("after ");
// public RPC nodes can lag a block behind the meter's receipts
for (let i = 0; i < 5 && after.badge.calls < before.badge.calls + BigInt(done); i++) {
  await new Promise((r) => setTimeout(r, 2000));
  after = await show("after ");
}
const accrued = after.badge.calls - before.badge.calls;
if (accrued !== BigInt(done)) {
  console.log(`WARNING: ${done} paid calls but ${accrued} pool accruals`);
  failed++;
}
const newCount = Number(after.badge.receipts - startReceipts);
let fresh: Awaited<ReturnType<typeof listRetirements>> = [];
for (let i = 0; i < 15 && newCount > 0; i++) {
  // Routescan indexes a few seconds behind the chain
  fresh = (await listRetirements(client, { payer: agent.address })).slice(-newCount);
  if (fresh.length >= newCount) break;
  await new Promise((r) => setTimeout(r, 2000));
}
console.log(`\n${fresh.length} new soulbound receipt(s):`);
for (const r of fresh) {
  console.log(`  receipt #${r.receiptId}: ${mgToKg(r.mgCO2e)} kg, lot ${r.lotId}, ${r.accrualCount} calls  ${explorer.tx(r.txHash)}`);
}
server?.close();
process.exit(failed ? 1 : 0);
