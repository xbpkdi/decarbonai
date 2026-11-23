import "server-only";
import { carbonReceiptAbi, reputationRegistryAbi, retirementPoolAbi } from "@decarbonai/chain";
import { unstable_cache } from "next/cache";
import { createPublicClient, decodeEventLog, encodeEventTopics, http, type Address, type Hex } from "viem";
import { DEPLOYMENT as D, NETWORK, RPC_URL, SUPERSEDED_ADAPTERS } from "@/lib/config";
import type { Snapshot, SnapAccrual, SnapRetirement } from "@/lib/types";

const RPC = process.env.RPC_URL || RPC_URL;
export const client = createPublicClient({ chain: NETWORK.chain, transport: http(RPC) });

type Row = { topics: Hex[]; data: Hex; blockNumber: Hex; timeStamp: Hex; transactionHash: Hex; logIndex: Hex };

/** Etherscan-compatible log index (Routescan powers Snowtrace). Public RPCs cap eth_getLogs at 100 blocks. */
async function logs(address: Address, topics: (Hex | null)[], fromBlock: number): Promise<Row[]> {
  const out: Row[] = [];
  const params = new URLSearchParams({ module: "logs", action: "getLogs", address, fromBlock: String(fromBlock), toBlock: "latest", offset: "1000" });
  topics.forEach((t, i) => {
    if (!t) return;
    params.set(`topic${i}`, t);
    if (i > 0) params.set(`topic0_${i}_opr`, "and");
  });
  for (let page = 1; page < 50; page++) {
    params.set("page", String(page));
    const res = await fetch(`${NETWORK.logsApi}?${params}`, { cache: "no-store" });
    const json = (await res.json()) as { status: string; message: string; result: Row[] | string };
    if (json.status !== "1") {
      if (String(json.message).toLowerCase().includes("no records")) break;
      throw new Error(`logs: ${json.message}`);
    }
    const rows = json.result as Row[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out.sort((a, b) => Number(BigInt(a.blockNumber) - BigInt(b.blockNumber)) || Number(a.logIndex || 0) - Number(b.logIndex || 0));
}

function poolLogs<N extends "CarbonAccrued" | "Retired">(eventName: N) {
  const topics = encodeEventTopics({ abi: retirementPoolAbi, eventName } as never) as Hex[];
  return logs(D.retirementPool, topics, D.deployBlock).then((rows) =>
    rows.map((l) => ({
      args: decodeEventLog({ abi: retirementPoolAbi, eventName, topics: l.topics as [Hex, ...Hex[]], data: l.data === ("" as Hex) ? "0x" : l.data }).args as Record<string, unknown>,
      block: Number(BigInt(l.blockNumber)),
      t: Number(BigInt(l.timeStamp)) * 1000,
      tx: l.transactionHash,
    })),
  );
}

async function readSnapshot(): Promise<Snapshot> {
  const pool = { address: D.retirementPool, abi: retirementPoolAbi } as const;
  const [accruedLogs, retiredLogs, block, totals] = await Promise.all([
    poolLogs("CarbonAccrued"),
    poolLogs("Retired"),
    client.getBlockNumber(),
    client.multicall({
      allowFailure: false,
      contracts: [
        { ...pool, functionName: "totalAccruedMg" },
        { ...pool, functionName: "totalRetiredMg" },
        { ...pool, functionName: "totalSurcharge" },
        { ...pool, functionName: "thresholdMg" },
        { ...pool, functionName: "pricePerTonne" },
      ],
    }),
  ]);
  const accruals: SnapAccrual[] = accruedLogs.map(({ args, block, t, tx }) => ({
    id: args.paymentId as Hex,
    tx,
    t,
    block,
    agent: Number(args.agentId as bigint),
    payer: args.payer as Address,
    mg: Number(args.mgCO2e as bigint),
    sur: Number(args.surcharge as bigint),
  }));
  const retirements: SnapRetirement[] = retiredLogs.map(({ args, block, t, tx }) => ({
    n: Number(args.receiptId as bigint),
    tx,
    t,
    block,
    agent: Number(args.agentId as bigint),
    payer: args.payer as Address,
    mg: Number(args.mgCO2e as bigint),
    calls: Number(args.accrualCount as bigint),
    lot: Number(args.lotId as bigint),
  }));
  const [totalAccruedMg, totalRetiredMg, totalSurcharge, thresholdMg, pricePerTonne] = totals.map(Number);
  return {
    network: NETWORK.id,
    block: Number(block),
    thresholdMg,
    pricePerTonne,
    totals: { accruedMg: totalAccruedMg, retiredMg: totalRetiredMg, surcharge: totalSurcharge },
    accruals,
    retirements,
    fetchedAt: Date.now(),
  };
}

/** One shared read every few seconds, whoever asks. */
export const getSnapshot = unstable_cache(readSnapshot, ["snapshot", NETWORK.id, D.retirementPool ?? ""], { revalidate: 4 });

export async function getSnapshotSafe(): Promise<Snapshot | null> {
  try {
    return await getSnapshot();
  } catch (e) {
    console.warn("snapshot read failed:", (e as Error).message);
    return null;
  }
}

export type ReceiptCheck = {
  n: number;
  exists: boolean;
  locked: boolean;
  owner: Address | null;
  methodologyHash: Hex | null;
  /** The pool's registry still lists the receipt's methodology hash as active. */
  methodologyActive: boolean;
  methodologyVersion: string | null;
  backed: boolean;
  lot: number;
};

export async function verifyReceipt(n: number): Promise<ReceiptCheck> {
  const c = { address: D.carbonReceipt, abi: carbonReceiptAbi } as const;
  try {
    const [r, owner, locked] = await Promise.all([
      client.readContract({ ...c, functionName: "retirement", args: [BigInt(n)] }),
      client.readContract({ ...c, functionName: "ownerOf", args: [BigInt(n)] }),
      client.readContract({ ...c, functionName: "locked", args: [BigInt(n)] }),
    ]);
    const m = (await client.readContract({ address: D.retirementPool, abi: retirementPoolAbi, functionName: "methodology", args: [r.methodologyHash] })) as {
      active: boolean;
      version: string;
    };
    return { n, exists: true, locked, owner, methodologyHash: r.methodologyHash, methodologyActive: m.active, methodologyVersion: m.version, backed: r.backed, lot: Number(r.lotId) };
  } catch {
    return { n, exists: false, locked: false, owner: null, methodologyHash: null, methodologyActive: false, methodologyVersion: null, backed: false, lot: 0 };
  }
}

export type AgentFeedback = { current: number; superseded: number };

/** ERC-8004 entries this deployment's adapter wrote for the agent, and those of superseded adapters. Null: not read. */
export async function agentFeedback(id: bigint): Promise<AgentFeedback | null> {
  const count = (adapter: Address) =>
    client.readContract({ address: D.erc8004ReputationRegistry, abi: reputationRegistryAbi, functionName: "getLastIndex", args: [id, adapter] }).then(Number);
  try {
    const [current, ...old] = await Promise.all([D.reputationAdapter, ...SUPERSEDED_ADAPTERS].map(count));
    return { current, superseded: old.reduce((s, n) => s + n, 0) };
  } catch {
    return null;
  }
}

const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as Hex;
const ownerOfAbi = [
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "address" }] },
] as const;

/** ERC-8004 identities currently held by `owner` (Transfer logs to the address, re-checked with ownerOf). */
export async function ownedAgents(owner: Address): Promise<number[]> {
  const topic = `0x${owner.slice(2).toLowerCase().padStart(64, "0")}` as Hex;
  const rows = await logs(D.erc8004IdentityRegistry, [TRANSFER, null, topic], 0);
  const ids = [...new Set(rows.filter((r) => r.topics[3]).map((r) => BigInt(r.topics[3])))];
  const owners = await Promise.all(
    ids.map((id) => client.readContract({ address: D.erc8004IdentityRegistry, abi: ownerOfAbi, functionName: "ownerOf", args: [id] }).catch(() => null)),
  );
  return ids.filter((_, i) => owners[i]?.toLowerCase() === owner.toLowerCase()).map(Number).sort((a, b) => a - b);
}
