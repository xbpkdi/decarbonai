// Reconcile the API's durable accrual queue with the chain: every surcharge we took must be counted by
// the pool. Confirmed rows missing on-chain are re-queued; pending/in-flight rows already counted are
// confirmed. Uses the DB the API uses for this chain + pool, or ACCRUAL_DB (safe while the API runs: on-chain
// dedupe). Refuses a DB that belongs to another chain or pool, and a missing one.
//   node --env-file=.env scripts/reconcile.ts
import { existsSync } from "node:fs";
import { retirementPoolAbi } from "@decarbonai/chain";
import { clientFor } from "@decarbonai/chain/node";
import { AccrualStore, CarbonMeter } from "@decarbonai/x402-carbon";
import { accrualDbPath } from "../apps/paid-api/src/env.ts";
import { need, scriptEnv } from "./env.ts";

const env = scriptEnv();
const { d } = env;
const client = clientFor(d);
const chainId = await client.getChainId();
if (chainId !== d.chainId) throw new Error(`RPC is chain ${chainId}, the deployment is on ${d.chainId}`);
const dbPath = accrualDbPath(d);
if (!existsSync(dbPath)) throw new Error(`no accrual DB at ${dbPath}`);
console.log(`reconciling ${dbPath} with chain ${d.chainId}, pool ${d.retirementPool}`);
const store = new AccrualStore(dbPath);
const meter = new CarbonMeter(client, need(env.meterKey, "meter key"), d, { store });
const before = store.counts();
const after = await meter.reconcile();
const onchain = await client.readContract({ address: d.retirementPool, abi: retirementPoolAbi, functionName: "totalSurcharge" });
const fmt = (c: typeof after) =>
  Object.fromEntries(Object.entries(c).map(([k, v]) => [k, `${v.n} rows / ${Number(v.surcharge) / 1e6} USDC`]));
console.log("before:", fmt(before));
console.log("after: ", fmt(after));
console.log(`pool totalSurcharge (all meters): ${Number(onchain) / 1e6} USDC`);
const unresolved = store.intents("unresolved");
const open = store.intents("open").length;
console.log(`settle intents: ${open} open, ${unresolved.length} unresolved`);
for (const i of unresolved) console.log(`  check by hand: payer ${i.payer}, EIP-3009 nonce ${i.nonce}, ${Number(i.amount) / 1e6} USDC`);
process.exit(after.pending.n + after.sent.n + open + unresolved.length === 0 ? 0 : 2);
