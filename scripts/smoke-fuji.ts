// Pre-demo smoke test against the live deployment (DECARBONAI_NETWORK=fuji|avalanche, default fuji):
//   1. every address has code and the contracts are wired to each other,
//   2. meter role / allowance / methodology / DCO2 supply / agent balances are in place,
//   3. the PayAI facilitator supports Fuji,
//   4. one real paid x402 call settles and lands as a CarbonAccrued in the pool.
//   node --env-file=.env scripts/smoke-fuji.ts [--no-pay]
import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { erc20Abi, formatEther, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  carbonReceiptAbi,
  eRC8004ReputationAdapterAbi,
  explorerFor,
  getAccount,
  getPoolState,
  network,
  retirementPoolAbi,
} from "@decarbonai/chain";
import { clientFor } from "@decarbonai/chain/node";
import { need, scriptEnv } from "./env.ts";
import { PAYAI_FACILITATOR } from "@decarbonai/x402-carbon";
import { createPayingFetch, settlementFrom } from "@decarbonai/x402-carbon/client";
import { createApp } from "../apps/paid-api/src/app.ts";

const env = scriptEnv();
const { d } = env;
const explorer = explorerFor(d.chainId);
const client = clientFor(d);
let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const addrs: [string, Address][] = [
  ["paymentToken", d.paymentToken],
  ["dco2", d.dco2],
  ["carbonReceipt", d.carbonReceipt],
  ["retirementPool", d.retirementPool],
  ["reputationAdapter", d.reputationAdapter],
  ["erc8004ReputationRegistry", d.erc8004ReputationRegistry],
];
for (const [name, a] of addrs) {
  const code = await client.getCode({ address: a });
  check(!!code && code !== "0x", `${name} has code`, a);
}

const pool = { address: d.retirementPool, abi: retirementPoolAbi } as const;
const [minter, adapterPool, rep, meterRole, methodology, state] = await Promise.all([
  client.readContract({ address: d.carbonReceipt, abi: carbonReceiptAbi, functionName: "minter" }),
  client.readContract({ address: d.reputationAdapter, abi: eRC8004ReputationAdapterAbi, functionName: "pool" }),
  client.readContract({ ...pool, functionName: "reputation" }),
  client.readContract({ ...pool, functionName: "METER_ROLE" }),
  client.readContract({ ...pool, functionName: "methodology", args: [d.methodologyHash] }),
  getPoolState(client, d),
]);
check(eq(minter, d.retirementPool), "receipt.minter == pool");
check(eq(adapterPool, d.retirementPool), "adapter.pool == pool");
check(eq(rep, d.reputationAdapter), "pool.reputation == adapter");
check(methodology.active, "methodology registered", methodology.version);
check(!state.paused, "pool not paused");
check(state.availableSupplyMg >= state.thresholdMg, "DCO2 supply >= one retirement", `${Number(state.availableSupplyMg) / 1e6} kg left`);

const meterKey = need(env.meterKey, "meter key");
const agentKey = need(env.agentKey, "agent key");
const payTo = need(env.payTo, "payTo");
const meterAddr = privateKeyToAccount(meterKey).address;
const agentAddr = privateKeyToAccount(agentKey).address;
const [hasRole, meterIsTreasury, meterIsPauser, admin, funder, meterAvax, agentUsdc, payToAllowance] = await Promise.all([
  client.readContract({ ...pool, functionName: "hasRole", args: [meterRole, meterAddr] }),
  client.readContract({ ...pool, functionName: "hasRole", args: [await client.readContract({ ...pool, functionName: "TREASURY_ROLE" }), meterAddr] }),
  client.readContract({ ...pool, functionName: "hasRole", args: [await client.readContract({ ...pool, functionName: "PAUSER_ROLE" }), meterAddr] }),
  client.readContract({ ...pool, functionName: "defaultAdmin" }),
  client.readContract({ ...pool, functionName: "surchargeFunder", args: [meterAddr] }),
  client.getBalance({ address: meterAddr }),
  client.readContract({ address: d.paymentToken, abi: erc20Abi, functionName: "balanceOf", args: [agentAddr] }),
  client.readContract({ address: d.paymentToken, abi: erc20Abi, functionName: "allowance", args: [payTo, d.retirementPool] }),
]);
check(hasRole, "meter has METER_ROLE", meterAddr);
check(!meterIsTreasury && !meterIsPauser && !eq(admin, meterAddr), "meter holds no admin/treasury/pauser rights");
check(!eq(payTo, meterAddr), "payTo is a separate wallet", payTo);
check(eq(funder, payTo), "pool pulls surcharges from payTo");
check(payToAllowance > 10_000_000n, "payTo approved the pool");
check(meterAvax > 10n ** 17n, "meter has gas", `${formatEther(meterAvax)} AVAX`);
check(agentUsdc >= 2_000_000n, "agent can pay ~100 calls", `${Number(agentUsdc) / 1e6} USDC`);

const facilitator = process.env.X402_FACILITATOR_URL || PAYAI_FACILITATOR;
const supported = (await (await fetch(`${facilitator}/supported`)).json()) as { kinds: { network: string }[] };
const caip2 = network(d.chainId).caip2;
check(supported.kinds.some((k) => k.network === caip2), `x402 facilitator supports ${caip2}`);

if (!process.argv.includes("--no-pay")) {
  const { app, meter, preflight } = createApp({
    meterKey,
    payTo,
    dbPath: process.env.ACCRUAL_DB || `.data/smoke-${d.chainId}-${d.retirementPool.toLowerCase()}.sqlite`,
    deployment: d,
    facilitatorUrl: process.env.X402_FACILITATOR_URL || undefined,
  });
  await preflight();
  const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
  await new Promise((r) => server.once("listening", r));
  const port = (server.address() as AddressInfo).port;
  const before = await getAccount(client, agentAddr, d);
  const res = await createPayingFetch({ privateKey: agentKey, agentId: env.agentId, deployment: d }).fetch(
    `http://127.0.0.1:${port}/v1/infer?model=claude-sonnet&maxOutputTokens=200&prompt=smoke`,
  );
  const s = settlementFrom(res);
  check(res.ok && !!s?.transaction, "x402 paid call settled", s?.transaction ? explorer.tx(s.transaction) : `HTTP ${res.status}`);
  const settled = await meter.drain(90_000);
  const record = s?.transaction ? meter.get(s.transaction as `0x${string}`) : undefined;
  check(settled && record?.status === "confirmed", "pool accrual confirmed", record?.txHash ? explorer.tx(record.txHash) : record?.status);
  const health = await meter.health(true);
  check(health.ok, "API health (fail-closed checks)", health.reasons.join(", "));
  let after = await getAccount(client, agentAddr, d);
  for (let i = 0; i < 5 && after.calls === before.calls; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    after = await getAccount(client, agentAddr, d);
  }
  check(after.calls === before.calls + 1n, "CarbonAccrued visible on-chain", `${after.calls} calls`);
  server.close();
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
