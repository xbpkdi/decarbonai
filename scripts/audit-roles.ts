// Read-only audit of who controls a deployment. Needs no key. Run it right after the Safe accepts the hand-off
// and before any money moves: until then the deployer can still grant itself a role, and a grant to a third
// address survives the hand-off.
//   DECARBONAI_NETWORK=avalanche npm run audit:roles
import { type Address, type Hex, createPublicClient, getAddress, http, parseAbi } from "viem";
import { carbonReceiptAbi, dCO2Abi, eRC8004ReputationAdapterAbi, network, retirementPoolAbi } from "@decarbonai/chain";
import { loadDeployment, rpcUrlFor } from "@decarbonai/chain/node";
import { safeProblems } from "./lib/safe.ts";

const d = loadDeployment();
// the event scan makes one call per 100 blocks, so be patient with a rate-limited public RPC
const client = createPublicClient({ chain: network(d.chainId).chain, transport: http(rpcUrlFor(d), { retryCount: 8, retryDelay: 500 }) });
const ZERO = "0x0000000000000000000000000000000000000000";
const mainnet = d.chainId === 43114;
let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const chainId = await client.getChainId();
if (chainId !== d.chainId) throw new Error(`RPC is chain ${chainId}, the deployment is on ${d.chainId}`);
const pool = { address: d.retirementPool, abi: retirementPoolAbi } as const;

// ---- wiring: the addresses in the file are contracts and point at each other
for (const name of ["dco2", "carbonReceipt", "retirementPool", "reputationAdapter", "paymentToken"] as const) {
  const code = await client.getCode({ address: d[name] });
  check(!!code && code !== "0x", `${name} has code`, d[name]);
}
const [token, dco2, receipt, reputation, minter, adapterPool] = await Promise.all([
  client.readContract({ ...pool, functionName: "paymentToken" }),
  client.readContract({ ...pool, functionName: "dco2" }),
  client.readContract({ ...pool, functionName: "receipt" }),
  client.readContract({ ...pool, functionName: "reputation" }),
  client.readContract({ address: d.carbonReceipt, abi: carbonReceiptAbi, functionName: "minter" }),
  client.readContract({ address: d.reputationAdapter, abi: eRC8004ReputationAdapterAbi, functionName: "pool" }),
]);
check(eq(token, mainnet ? network(d.chainId).usdc : d.paymentToken) && eq(token, d.paymentToken), "pool token is the expected one", token);
check(eq(dco2, d.dco2) && eq(receipt, d.carbonReceipt) && eq(reputation, d.reputationAdapter), "pool points at DCO2, receipt, adapter");
check(eq(minter, d.retirementPool) && eq(adapterPool, d.retirementPool), "receipt and adapter point at the pool");
if (mainnet) check(await client.readContract({ address: d.dco2, abi: dCO2Abi, functionName: "backedToken" }), "DCO2 is backed");

// ---- admin and owners
if (mainnet) {
  const safeAbi = parseAbi(["function getThreshold() view returns (uint256)", "function getOwners() view returns (address[])"]);
  const safe = { address: d.admin, abi: safeAbi } as const;
  const code = await client.getCode({ address: d.admin });
  const [threshold, owners] = await Promise.all([
    client.readContract({ ...safe, functionName: "getThreshold" }),
    client.readContract({ ...safe, functionName: "getOwners" }),
  ]).catch(() => [0n, []] as const);
  const problems = safeProblems({ hasCode: !!code && code !== "0x", threshold, owners }, { deployer: d.deployer, meter: d.meter, payTo: d.payTo });
  check(!problems.length, "admin is a 1-of-1 or multisig Safe with no bot wallet as owner", `${threshold} of ${owners.length}: ${owners.join(", ")}${problems.length ? `; ${problems.join("; ")}` : ""}`);
}
const [admin, [pendingAdmin]] = await Promise.all([
  client.readContract({ ...pool, functionName: "defaultAdmin" }),
  client.readContract({ ...pool, functionName: "pendingDefaultAdmin" }),
]);
check(eq(admin, d.admin), "pool admin accepted", `${admin}, expected ${d.admin}`);
check(eq(pendingAdmin, ZERO), "no pool admin transfer pending", pendingAdmin);
for (const name of ["dco2", "carbonReceipt", "reputationAdapter"] as const) {
  // all three are Ownable2Step, so one ABI reads them all
  const [owner, pendingOwner] = await Promise.all([
    client.readContract({ address: d[name], abi: dCO2Abi, functionName: "owner" }),
    client.readContract({ address: d[name], abi: dCO2Abi, functionName: "pendingOwner" }),
  ]);
  check(eq(owner, d.admin), `${name} ownership accepted`, `${owner}, expected ${d.admin}`);
  check(eq(pendingOwner, ZERO), `no ${name} ownership transfer pending`, pendingOwner);
}

// ---- every role ever granted
const [meterRole, treasuryRole, pauserRole, adminRole] = await Promise.all([
  client.readContract({ ...pool, functionName: "METER_ROLE" }),
  client.readContract({ ...pool, functionName: "TREASURY_ROLE" }),
  client.readContract({ ...pool, functionName: "PAUSER_ROLE" }),
  client.readContract({ ...pool, functionName: "DEFAULT_ADMIN_ROLE" }),
]);
const roles: [string, Hex, Address][] = [
  ["DEFAULT_ADMIN_ROLE", adminRole, d.admin],
  ["TREASURY_ROLE", treasuryRole, d.treasury],
  ["PAUSER_ROLE", pauserRole, d.pauser],
  ["METER_ROLE", meterRole, d.meter],
];
const head = await client.getBlockNumber();
const granted = new Map<Hex, Set<Address>>();
const funders = new Set<Address>();
const CHUNK = 100n; // eth_getLogs range limit of the public C-Chain RPC
const starts: bigint[] = [];
for (let from = BigInt(d.deployBlock); from <= head; from += CHUNK) starts.push(from);
const events = retirementPoolAbi.filter((x) => x.type === "event" && (x.name === "RoleGranted" || x.name === "SurchargeFunderSet"));
if (starts.length > 100) console.log(`scanning ${starts.length * 100} blocks of events, this takes a while...`);
for (let i = 0; i < starts.length; i += 4) {
  const logs = await Promise.all(
    starts.slice(i, i + 4).map((fromBlock) => client.getLogs({ address: d.retirementPool, events, fromBlock, toBlock: fromBlock + CHUNK - 1n < head ? fromBlock + CHUNK - 1n : head })),
  );
  for (const l of logs.flat()) {
    if (l.eventName === "RoleGranted") {
      const { role, account } = l.args as { role: Hex; account: Address };
      granted.set(role, (granted.get(role) ?? new Set()).add(account));
    } else funders.add((l.args as { meter: Address }).meter);
  }
}
check(granted.size >= roles.length, "role events found", `blocks ${d.deployBlock}..${head}`);
for (const [role, accounts] of granted) {
  const known = roles.find(([, id]) => id === role);
  for (const account of accounts) {
    if (!(await client.readContract({ ...pool, functionName: "hasRole", args: [role, account] }))) continue;
    check(!!known && eq(account, known[2]), `${known?.[0] ?? `unknown role ${role}`} held by ${account}`);
  }
}
for (const [name, role, holder] of roles) {
  check(await client.readContract({ ...pool, functionName: "hasRole", args: [role, holder] }), `${name} held by the expected address`, holder);
}
if (!eq(d.deployer, d.admin)) {
  for (const [name, role] of roles) check(!(await client.readContract({ ...pool, functionName: "hasRole", args: [role, d.deployer] })), `deployer has no ${name}`);
}
for (const meter of new Set<Address>([...funders, getAddress(d.meter)])) {
  const funder = await client.readContract({ ...pool, functionName: "surchargeFunder", args: [meter] });
  check(eq(funder, eq(meter, d.meter) ? d.payTo : ZERO), `surcharge funder of ${meter}`, funder);
}

// ---- nothing else was changed in the hand-off window
const [price, threshold, methodology, paused, nextLotId, queue] = await Promise.all([
  client.readContract({ ...pool, functionName: "pricePerTonne" }),
  client.readContract({ ...pool, functionName: "thresholdMg" }),
  client.readContract({ ...pool, functionName: "methodology", args: [d.methodologyHash] }),
  client.readContract({ ...pool, functionName: "paused" }),
  client.readContract({ address: d.dco2, abi: dCO2Abi, functionName: "nextLotId" }),
  client.readContract({ ...pool, functionName: "lotQueueLength" }),
]);
check(price === BigInt(d.pricePerTonne) && threshold === BigInt(d.thresholdMg), "price and threshold are the deployed ones");
check(methodology.active && !paused, "methodology active, pool not paused", methodology.version);
check(nextLotId === BigInt(d.initialLotId) + 1n, "no other DCO2 lot was minted (expected until the Safe adds one)", `next lot ${nextLotId}`);
check(queue === (d.initialLotId > 0 ? 1n : 0n), "the pool queue holds only that lot (expected until the Safe adds one)", `${queue} queued`);

// ---- the lot the deployment minted
if (d.initialLotId > 0) {
  const lot = await client.readContract({ address: d.dco2, abi: dCO2Abi, functionName: "lot", args: [BigInt(d.initialLotId)] });
  const supply = await client.readContract({ ...pool, functionName: "availableSupply" });
  check(supply <= lot.quantityKg * 1_000_000n, "pool supply is within lot 1", `${Number(supply) / 1e6} of ${lot.quantityKg} kg`);
  console.log(`lot ${d.initialLotId}: ${lot.serial}\n  ${lot.certificateURI}\n  ${lot.retirementTx}`);
} else check(!mainnet, "a lot was minted");

console.log(failures ? `\n${failures} check(s) FAILED: do not fund anything` : "\nall checks passed");
process.exit(failures ? 1 : 0);
