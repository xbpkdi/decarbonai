// Pre-demo smoke test against the live deployment (DECARBONAI_NETWORK=fuji|avalanche, default fuji):
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
  carbonReceiptAbi,
  eRC8004ReputationAdapterAbi,
  explorerFor,
  getAccount,
  getPoolState,
  network,
  retirementPoolAbi,
} from "@decarbonai/chain";
import { clientFor, loadDeployment } from "@decarbonai/chain/node";
import { PAYAI_FACILITATOR } from "@decarbonai/x402-carbon";
import { createPayingFetch, settlementFrom } from "@decarbonai/x402-carbon/client";
import { createApp } from "../apps/paid-api/src/app.ts";

const d = loadDeployment();
const mainnet = d.chainId === 43114;
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

const meterKey = (process.env.METER_PRIVATE_KEY ?? (mainnet ? process.env.MAINNET_PRIVATE_KEY : process.env.FUJI_PRIVATE_KEY)) as Hex | undefined;
const agentKey = (mainnet ? process.env.MAINNET_AGENT_PRIVATE_KEY : process.env.AGENT_PRIVATE_KEY) as Hex | undefined;
if (!meterKey || !agentKey) throw new Error("FUJI_PRIVATE_KEY (or METER_PRIVATE_KEY) and AGENT_PRIVATE_KEY required");
const meterAddr = privateKeyToAccount(meterKey).address;
const agentAddr = privateKeyToAccount(agentKey).address;
const [hasRole, meterAvax, agentUsdc] = await Promise.all([
  client.readContract({ ...pool, functionName: "hasRole", args: [meterRole, meterAddr] }),
  client.getBalance({ address: meterAddr }),
  client.readContract({ address: d.paymentToken, abi: erc20Abi, functionName: "balanceOf", args: [agentAddr] }),
]);
check(hasRole, "meter has METER_ROLE", meterAddr);
check(meterAvax > 10n ** 17n, "meter has gas", `${formatEther(meterAvax)} AVAX`);
check(agentUsdc >= 2_000_000n, "agent can pay ~100 calls", `${Number(agentUsdc) / 1e6} tUSDC`);

const supported = (await (await fetch(`${PAYAI_FACILITATOR}/supported`)).json()) as { kinds: { network: string }[] };
const caip2 = network(d.chainId).caip2;
check(supported.kinds.some((k) => k.network === caip2), `PayAI facilitator supports ${caip2}`);

if (!process.argv.includes("--no-pay")) {
  const { app, meter } = createApp({ meterKey, deployment: d });
  await meter.ensureAllowance();
  const server = serve({ fetch: app.fetch, port: 0 });
  await new Promise((r) => server.once("listening", r));
  const port = (server.address() as AddressInfo).port;
  const before = await getAccount(client, agentAddr, d);
  const agentId = (mainnet ? process.env.MAINNET_AGENT_ID : process.env.AGENT_ID) ? BigInt((mainnet ? process.env.MAINNET_AGENT_ID : process.env.AGENT_ID)!) : undefined;
  const res = await createPayingFetch({ privateKey: agentKey, agentId, deployment: d }).fetch(
    `http://localhost:${port}/v1/infer?model=claude-sonnet&maxOutputTokens=200&prompt=smoke`,
  );
  const s = settlementFrom(res);
  check(res.ok && !!s?.transaction, "x402 paid call settled", s?.transaction ? explorer.tx(s.transaction) : `HTTP ${res.status}`);
  const [record] = await meter.drain();
  check(record?.status === "confirmed", "pool accrual confirmed", record?.txHash ? explorer.tx(record.txHash) : record?.error);
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
