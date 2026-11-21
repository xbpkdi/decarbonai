// Pre-demo smoke test against the live Fuji deployment (deployments/fuji.json):
//   1. every address has code and the contracts are wired to each other,
//   2. meter role / allowance / methodology / DCO2 supply / agent balances are in place,
//   3. the PayAI facilitator supports Fuji,
//   4. one real paid x402 call settles and lands as a CarbonAccrued in the pool.
//   node --env-file=.env scripts/smoke-fuji.ts [--no-pay]
import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { erc20Abi, formatEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  FUJI,
  carbonReceiptAbi,
  eRC8004ReputationAdapterAbi,
  explorer,
  fujiClient,
  getAccount,
  getPoolState,
  retirementPoolAbi,
} from "@decarbonai/chain";
import { PAYAI_FACILITATOR } from "@decarbonai/x402-carbon";
import { createPayingFetch, settlementFrom } from "@decarbonai/x402-carbon/client";
import { createApp } from "../apps/paid-api/src/app.ts";

const client = fujiClient();
let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const addrs: [string, Address][] = [
  ["paymentToken", FUJI.paymentToken],
  ["dco2", FUJI.dco2],
  ["carbonReceipt", FUJI.carbonReceipt],
  ["retirementPool", FUJI.retirementPool],
  ["reputationAdapter", FUJI.reputationAdapter],
  ["erc8004ReputationRegistry", FUJI.erc8004ReputationRegistry],
];
for (const [name, a] of addrs) {
  const code = await client.getCode({ address: a });
  check(!!code && code !== "0x", `${name} has code`, a);
}

const pool = { address: FUJI.retirementPool, abi: retirementPoolAbi } as const;
const [minter, adapterPool, rep, meterRole, methodology, state] = await Promise.all([
  client.readContract({ address: FUJI.carbonReceipt, abi: carbonReceiptAbi, functionName: "minter" }),
  client.readContract({ address: FUJI.reputationAdapter, abi: eRC8004ReputationAdapterAbi, functionName: "pool" }),
  client.readContract({ ...pool, functionName: "reputation" }),
  client.readContract({ ...pool, functionName: "METER_ROLE" }),
  client.readContract({ ...pool, functionName: "methodology", args: [FUJI.methodologyHash] }),
  getPoolState(client),
]);
check(eq(minter, FUJI.retirementPool), "receipt.minter == pool");
check(eq(adapterPool, FUJI.retirementPool), "adapter.pool == pool");
check(eq(rep, FUJI.reputationAdapter), "pool.reputation == adapter");
check(methodology.active, "methodology registered", methodology.version);
check(!state.paused, "pool not paused");
check(state.availableSupplyMg >= state.thresholdMg, "DCO2 supply >= one retirement", `${Number(state.availableSupplyMg) / 1e6} kg left`);

const meterKey = (process.env.METER_PRIVATE_KEY ?? process.env.FUJI_PRIVATE_KEY) as Hex | undefined;
const agentKey = process.env.AGENT_PRIVATE_KEY as Hex | undefined;
if (!meterKey || !agentKey) throw new Error("FUJI_PRIVATE_KEY (or METER_PRIVATE_KEY) and AGENT_PRIVATE_KEY required");
const meterAddr = privateKeyToAccount(meterKey).address;
const agentAddr = privateKeyToAccount(agentKey).address;
const [hasRole, meterAvax, agentUsdc] = await Promise.all([
  client.readContract({ ...pool, functionName: "hasRole", args: [meterRole, meterAddr] }),
  client.getBalance({ address: meterAddr }),
  client.readContract({ address: FUJI.paymentToken, abi: erc20Abi, functionName: "balanceOf", args: [agentAddr] }),
]);
check(hasRole, "meter has METER_ROLE", meterAddr);
check(meterAvax > 10n ** 17n, "meter has gas", `${formatEther(meterAvax)} AVAX`);
check(agentUsdc >= 2_000_000n, "agent can pay ~100 calls", `${Number(agentUsdc) / 1e6} tUSDC`);

const supported = (await (await fetch(`${PAYAI_FACILITATOR}/supported`)).json()) as { kinds: { network: string }[] };
check(supported.kinds.some((k) => k.network === "eip155:43113"), "PayAI facilitator supports eip155:43113");

if (!process.argv.includes("--no-pay")) {
  const { app, meter } = createApp({ meterKey, rpcUrl: process.env.FUJI_RPC_URL });
  await meter.ensureAllowance();
  const server = serve({ fetch: app.fetch, port: 0 });
  await new Promise((r) => server.once("listening", r));
  const port = (server.address() as AddressInfo).port;
  const before = await getAccount(client, agentAddr);
  const agentId = process.env.AGENT_ID ? BigInt(process.env.AGENT_ID) : undefined;
  const res = await createPayingFetch({ privateKey: agentKey, agentId }).fetch(
    `http://localhost:${port}/v1/infer?model=claude-sonnet&maxOutputTokens=200&prompt=smoke`,
  );
  const s = settlementFrom(res);
  check(res.ok && !!s?.transaction, "x402 paid call settled", s?.transaction ? explorer.tx(s.transaction) : `HTTP ${res.status}`);
  const [record] = await meter.drain();
  check(record?.status === "confirmed", "pool accrual confirmed", record?.txHash ? explorer.tx(record.txHash) : record?.error);
  let after = await getAccount(client, agentAddr);
  for (let i = 0; i < 5 && after.calls === before.calls; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    after = await getAccount(client, agentAddr);
  }
  check(after.calls === before.calls + 1n, "CarbonAccrued visible on-chain", `${after.calls} calls`);
  server.close();
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
