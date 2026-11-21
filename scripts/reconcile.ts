// Reconcile the API's durable accrual queue with the chain: every surcharge we took must be counted by
// the pool. Confirmed rows missing on-chain are re-queued; pending/in-flight rows already counted are
// confirmed. Run against the same ACCRUAL_DB the API uses (safe while the API runs: on-chain dedupe).
//   node --env-file=.env scripts/reconcile.ts
import { retirementPoolAbi } from "@decarbonai/chain";
import { clientFor } from "@decarbonai/chain/node";
import { AccrualStore, CarbonMeter } from "@decarbonai/x402-carbon";
import { need, scriptEnv } from "./env.ts";

const env = scriptEnv();
const { d } = env;
const client = clientFor(d);
const store = new AccrualStore(process.env.ACCRUAL_DB ?? "apps/paid-api/.data/accruals.sqlite");
const meter = new CarbonMeter(client, need(env.meterKey, "meter key"), d, { store });
const before = store.counts();
const after = await meter.reconcile();
const onchain = await client.readContract({ address: d.retirementPool, abi: retirementPoolAbi, functionName: "totalSurcharge" });
const fmt = (c: typeof after) =>
  Object.fromEntries(Object.entries(c).map(([k, v]) => [k, `${v.n} rows / ${Number(v.surcharge) / 1e6} USDC`]));
console.log("before:", fmt(before));
console.log("after: ", fmt(after));
console.log(`pool totalSurcharge (all meters): ${Number(onchain) / 1e6} USDC`);
process.exit(after.pending.n + after.sent.n === 0 ? 0 : 2);
