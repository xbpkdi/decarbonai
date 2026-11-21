import {
  createPublicClient,
  decodeEventLog,
  encodeEventTopics,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { avalancheFuji } from "viem/chains";
import fuji from "../../../deployments/fuji.json" with { type: "json" };
import { carbonReceiptAbi, dCO2Abi, retirementPoolAbi } from "./abis.ts";
import { reputationRegistryAbi } from "./erc8004.ts";
import { network } from "./networks.ts";

export * from "./abis.ts";
export * from "./erc8004.ts";
export * from "./networks.ts";

export type Deployment = {
  chainId: number;
  deployBlock: number;
  deployer: Address;
  meter: Address;
  paymentToken: Address;
  dco2: Address;
  carbonReceipt: Address;
  retirementPool: Address;
  reputationAdapter: Address;
  erc8004ReputationRegistry: Address;
  methodologyHash: Hex;
  methodologyVersion: string;
  thresholdMg: number;
  pricePerTonne: number;
  initialLotId: number;
};

export const FUJI: Deployment = fuji as Deployment;
export const FUJI_RPC_URL = "https://api.avax-test.network/ext/bc/C/rpc";
export const SNOWTRACE = "https://testnet.snowtrace.io";

export const explorer = {
  tx: (hash: string) => `${SNOWTRACE}/tx/${hash}`,
  address: (addr: string) => `${SNOWTRACE}/address/${addr}`,
  nft: (contract: string, id: bigint | number) => `${SNOWTRACE}/nft/${contract}/${id}`,
};

export function fujiClient(rpcUrl = process.env.FUJI_RPC_URL ?? FUJI_RPC_URL): PublicClient {
  return createPublicClient({ chain: avalancheFuji, transport: http(rpcUrl) }) as PublicClient;
}

// ------------------------------------------------------------------ reads

export type PoolState = {
  thresholdMg: bigint;
  pricePerTonne: bigint;
  totalAccruedMg: bigint;
  totalRetiredMg: bigint;
  totalSurcharge: bigint;
  totalAccruals: bigint;
  totalRetirements: bigint;
  availableSupplyMg: bigint;
  surchargeBalance: bigint;
  paused: boolean;
};

export async function getPoolState(client: PublicClient, d: Deployment = FUJI): Promise<PoolState> {
  const pool = { address: d.retirementPool, abi: retirementPoolAbi } as const;
  const [
    thresholdMg,
    pricePerTonne,
    totalAccruedMg,
    totalRetiredMg,
    totalSurcharge,
    totalAccruals,
    totalRetirements,
    availableSupplyMg,
    paused,
    surchargeBalance,
  ] = await Promise.all([
    client.readContract({ ...pool, functionName: "thresholdMg" }),
    client.readContract({ ...pool, functionName: "pricePerTonne" }),
    client.readContract({ ...pool, functionName: "totalAccruedMg" }),
    client.readContract({ ...pool, functionName: "totalRetiredMg" }),
    client.readContract({ ...pool, functionName: "totalSurcharge" }),
    client.readContract({ ...pool, functionName: "totalAccruals" }),
    client.readContract({ ...pool, functionName: "totalRetirements" }),
    client.readContract({ ...pool, functionName: "availableSupply" }),
    client.readContract({ ...pool, functionName: "paused" }),
    client.readContract({
      address: d.paymentToken,
      abi: [
        {
          type: "function",
          name: "balanceOf",
          stateMutability: "view",
          inputs: [{ name: "a", type: "address" }],
          outputs: [{ name: "", type: "uint256" }],
        },
      ] as const,
      functionName: "balanceOf",
      args: [d.retirementPool],
    }),
  ]);
  return {
    thresholdMg,
    pricePerTonne,
    totalAccruedMg,
    totalRetiredMg,
    totalSurcharge,
    totalAccruals,
    totalRetirements,
    availableSupplyMg,
    surchargeBalance,
    paused,
  };
}

export type AccountState = {
  agentId: bigint;
  pendingMg: bigint;
  totalMg: bigint;
  retiredMg: bigint;
  surchargePaid: bigint;
  calls: bigint;
  pendingCalls: bigint;
  receipts: bigint;
  lastMethodology: Hex;
};

export async function getAccount(client: PublicClient, payer: Address, d: Deployment = FUJI): Promise<AccountState> {
  const a = await client.readContract({
    address: d.retirementPool,
    abi: retirementPoolAbi,
    functionName: "account",
    args: [payer],
  });
  return { ...a, calls: BigInt(a.calls), pendingCalls: BigInt(a.pendingCalls), receipts: BigInt(a.receipts) };
}

/** "Green agent" badge: pool account + ERC-8004 carbon-settled reputation written by our adapter. */
export type AgentBadge = AccountState & {
  payer: Address;
  progressToNextRetirement: number; // 0..1
  reputation: { count: bigint; retiredKg: number } | null;
};

export async function getAgentBadge(client: PublicClient, payer: Address, d: Deployment = FUJI): Promise<AgentBadge> {
  const [account, threshold] = await Promise.all([
    getAccount(client, payer, d),
    client.readContract({ address: d.retirementPool, abi: retirementPoolAbi, functionName: "thresholdMg" }),
  ]);
  let reputation: AgentBadge["reputation"] = null;
  if (account.agentId !== 0n) {
    const [count, value, decimals] = await client.readContract({
      address: d.erc8004ReputationRegistry,
      abi: reputationRegistryAbi,
      functionName: "getSummary",
      args: [account.agentId, [d.reputationAdapter], "carbon-settled", "dco2-retired"],
    });
    // getSummary returns the average value; total retired = average * count.
    reputation = { count, retiredKg: (Number(value) / 10 ** decimals) * Number(count) };
  }
  return {
    ...account,
    payer,
    progressToNextRetirement: Number(account.pendingMg) / Number(threshold),
    reputation,
  };
}

export type Receipt = {
  tokenId: bigint;
  owner: Address;
  beneficiary: Address;
  agentId: bigint;
  lotId: bigint;
  mgCO2e: bigint;
  surchargePaid: bigint;
  accrualCount: number;
  retiredAt: number;
  methodologyHash: Hex;
  tokenURI: string;
};

export async function getReceipt(client: PublicClient, tokenId: bigint, d: Deployment = FUJI): Promise<Receipt> {
  const c = { address: d.carbonReceipt, abi: carbonReceiptAbi } as const;
  const [r, owner, tokenURI] = await Promise.all([
    client.readContract({ ...c, functionName: "retirement", args: [tokenId] }),
    client.readContract({ ...c, functionName: "ownerOf", args: [tokenId] }),
    client.readContract({ ...c, functionName: "tokenURI", args: [tokenId] }),
  ]);
  return { tokenId, owner, ...r, accrualCount: Number(r.accrualCount), retiredAt: Number(r.retiredAt), tokenURI };
}

export async function getLot(client: PublicClient, lotId: bigint, d: Deployment = FUJI) {
  const [lot, remainingMg] = await Promise.all([
    client.readContract({ address: d.dco2, abi: dCO2Abi, functionName: "lot", args: [lotId] }),
    client.readContract({ address: d.dco2, abi: dCO2Abi, functionName: "balanceOf", args: [d.retirementPool, lotId] }),
  ]);
  return { lotId, ...lot, remainingMg };
}

// ------------------------------------------------------------------ events

/**
 * Event source. The public Fuji RPC caps eth_getLogs at 100 blocks per request, so by default
 * logs come from the Routescan (Snowtrace) etherscan-compatible API, which indexes Fuji with a few
 * seconds of lag. Pass { source: "rpc" } to read straight from a node in 100-block chunks.
 */

export type LogFilter = { payer?: Address; fromBlock?: bigint; source?: "routescan" | "rpc" };

type RawLog = { topics: Hex[]; data: Hex; blockNumber: bigint; transactionHash: Hex; logIndex: number };

const RPC_CHUNK = 100n;

async function rpcLogs(client: PublicClient, address: Address, topics: (Hex | null)[], fromBlock: bigint): Promise<RawLog[]> {
  const latest = await client.getBlockNumber();
  const out: RawLog[] = [];
  for (let from = fromBlock; from <= latest; from += RPC_CHUNK) {
    const to = from + RPC_CHUNK - 1n > latest ? latest : from + RPC_CHUNK - 1n;
    const logs = (await client.request({
      method: "eth_getLogs",
      params: [{ address, topics, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` }],
    })) as { topics: Hex[]; data: Hex; blockNumber: Hex; transactionHash: Hex; logIndex: Hex }[];
    for (const l of logs) {
      out.push({ ...l, blockNumber: BigInt(l.blockNumber), logIndex: Number(l.logIndex) });
    }
  }
  return out;
}

async function routescanLogs(api: string, address: Address, topics: (Hex | null)[], fromBlock: bigint): Promise<RawLog[]> {
  const out: RawLog[] = [];
  const params = new URLSearchParams({ module: "logs", action: "getLogs", address, fromBlock: fromBlock.toString(), toBlock: "latest", offset: "1000" });
  topics.forEach((t, i) => {
    if (!t) return;
    params.set(`topic${i}`, t);
    if (i > 0) params.set(`topic0_${i}_opr`, "and");
  });
  for (let page = 1; page < 100; page++) {
    params.set("page", String(page));
    const res = await fetch(`${api}?${params}`);
    const json = (await res.json()) as { status: string; message: string; result: unknown };
    if (json.status !== "1") {
      if (json.message?.toLowerCase().includes("no records")) break;
      throw new Error(`routescan getLogs: ${json.message} ${JSON.stringify(json.result).slice(0, 200)}`);
    }
    const rows = json.result as { topics: Hex[]; data: Hex; blockNumber: Hex; transactionHash: Hex; logIndex: Hex }[];
    for (const l of rows) {
      out.push({ topics: l.topics, data: l.data === ("" as Hex) ? "0x" : l.data, blockNumber: BigInt(l.blockNumber), transactionHash: l.transactionHash, logIndex: Number(l.logIndex || "0x0") });
    }
    if (rows.length < 1000) break;
  }
  return out;
}

async function poolEvents<N extends "CarbonAccrued" | "Retired">(client: PublicClient, eventName: N, f: LogFilter, d: Deployment) {
  const topics = encodeEventTopics({
    abi: retirementPoolAbi,
    eventName,
    args: f.payer ? ({ payer: f.payer } as never) : undefined,
  } as never) as (Hex | null)[];
  const fromBlock = f.fromBlock ?? BigInt(d.deployBlock);
  const raw =
    f.source === "rpc"
      ? await rpcLogs(client, d.retirementPool, topics, fromBlock)
      : await routescanLogs(network(d.chainId).routescanApi, d.retirementPool, topics, fromBlock);
  raw.sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
  return raw.map((l) => ({
    args: decodeEventLog({ abi: retirementPoolAbi, eventName, topics: l.topics as [Hex, ...Hex[]], data: l.data }).args,
    blockNumber: l.blockNumber,
    transactionHash: l.transactionHash,
  }));
}

export type Accrual = {
  paymentId: Hex;
  payer: Address;
  agentId: bigint;
  mgCO2e: bigint;
  surcharge: bigint;
  methodologyHash: Hex;
  pendingMg: bigint;
  blockNumber: bigint;
  txHash: Hex;
};

export async function listAccruals(client: PublicClient, f: LogFilter = {}, d: Deployment = FUJI): Promise<Accrual[]> {
  const logs = await poolEvents(client, "CarbonAccrued", f, d);
  return logs.map((l) => ({ ...(l.args as Omit<Accrual, "blockNumber" | "txHash">), blockNumber: l.blockNumber, txHash: l.transactionHash }));
}

export type Retirement = {
  receiptId: bigint;
  payer: Address;
  agentId: bigint;
  lotId: bigint;
  mgCO2e: bigint;
  accrualCount: number;
  blockNumber: bigint;
  txHash: Hex;
};

export async function listRetirements(client: PublicClient, f: LogFilter = {}, d: Deployment = FUJI): Promise<Retirement[]> {
  const logs = await poolEvents(client, "Retired", f, d);
  return logs.map((l) => {
    const a = l.args as Omit<Retirement, "blockNumber" | "txHash" | "accrualCount"> & { accrualCount: bigint };
    return { ...a, accrualCount: Number(a.accrualCount), blockNumber: l.blockNumber, txHash: l.transactionHash };
  });
}

// ------------------------------------------------------------------ formatting

export const mgToGrams = (mg: bigint) => Number(mg) / 1_000;
export const mgToKg = (mg: bigint) => Number(mg) / 1_000_000;
export const usdc = (units: bigint) => Number(units) / 1e6;
