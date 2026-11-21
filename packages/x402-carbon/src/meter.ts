import {
  createWalletClient,
  erc20Abi,
  http,
  maxUint256,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { nonceManager, privateKeyToAccount } from "viem/accounts";
import { FUJI, network, retirementPoolAbi, type Deployment } from "@decarbonai/chain";

const identityAbi = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "getAgentWallet",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

/**
 * Gas limit per accrue, sized from the retirements it will trigger. We don't use eth_estimateGas:
 * against `latest` it misses retirements caused by earlier accruals still pending. And the limit
 * must stay tight because Avalanche C-Chain bills at least half of the gas limit (a flat 3M limit
 * cost 1.5M gas per call on Fuji). Measured on Fuji: plain accrue ~125k, each retirement with
 * receipt mint + ERC-8004 feedback ~525k more.
 */
export const ACCRUE_BASE_GAS = 200_000n;
export const RETIREMENT_GAS = 700_000n;
export const MAX_RETIREMENTS_PER_CALL = 5n;

export function accrueGasLimit(retirements: bigint): bigint {
  const r = retirements > MAX_RETIREMENTS_PER_CALL ? MAX_RETIREMENTS_PER_CALL : retirements;
  return ACCRUE_BASE_GAS + r * RETIREMENT_GAS;
}

/** Local model of a payer's pending accrual: returns retirements this accrual triggers. */
export function predictRetirements(pendingMg: bigint, mgCO2e: bigint, thresholdMg: bigint): { retirements: bigint; pendingAfter: bigint } {
  let pending = pendingMg + mgCO2e;
  let retirements = pending / thresholdMg;
  if (retirements > MAX_RETIREMENTS_PER_CALL) retirements = MAX_RETIREMENTS_PER_CALL;
  pending -= retirements * thresholdMg;
  return { retirements, pendingAfter: pending };
}

export type AccrualRequest = {
  paymentId: Hex; // paymentIdOf(chainId, asset, payer, eip3009Nonce)
  settlementTx: Hex; // x402 settlement tx (may batch several payments)
  payer: Address;
  agentId: bigint; // claimed ERC-8004 id, 0n if none
  mgCO2e: bigint;
  surcharge: bigint;
  methodologyHash: Hex;
};

export type AccrualRecord = AccrualRequest & {
  status: "queued" | "sent" | "confirmed" | "failed";
  linkedAgentId: bigint;
  txHash?: Hex;
  error?: string;
};

/**
 * Reports settled x402 calls to the RetirementPool from the merchant wallet (METER_ROLE).
 * Sends are serialized so nonces stay ordered during bursts; callers don't wait for mining.
 */
export class CarbonMeter {
  readonly address: Address;
  private readonly wallet;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly records = new Map<Hex, AccrualRecord>();
  private readonly agentCheck = new Map<string, boolean>();
  private readonly pending = new Map<string, bigint>(); // payer -> predicted pendingMg
  private threshold?: bigint;
  private readonly client: PublicClient;
  private readonly d: Deployment;

  constructor(client: PublicClient, privateKey: Hex, d: Deployment = FUJI, rpcUrl?: string) {
    this.client = client;
    this.d = d;
    const account = privateKeyToAccount(privateKey, { nonceManager });
    this.address = account.address;
    this.wallet = createWalletClient({ account, chain: network(d.chainId).chain, transport: http(rpcUrl) });
  }

  /** One-time: let the pool pull surcharges from the merchant wallet. */
  async ensureAllowance(): Promise<Hex | null> {
    const current = await this.client.readContract({
      address: this.d.paymentToken,
      abi: erc20Abi,
      functionName: "allowance",
      args: [this.address, this.d.retirementPool],
    });
    if (current > 10n ** 30n) return null;
    const hash = await this.wallet.writeContract({
      address: this.d.paymentToken,
      abi: erc20Abi,
      functionName: "approve",
      args: [this.d.retirementPool, maxUint256],
    });
    await this.client.waitForTransactionReceipt({ hash });
    return hash;
  }

  /** Only link an ERC-8004 agent the payer actually controls (owner or registered agent wallet). */
  async verifyAgent(agentId: bigint, payer: Address): Promise<boolean> {
    if (agentId === 0n) return false;
    const key = `${agentId}:${payer.toLowerCase()}`;
    const cached = this.agentCheck.get(key);
    if (cached !== undefined) return cached;
    let ok = false;
    try {
      const [owner, wallet] = await Promise.all([
        this.client.readContract({ address: network(this.d.chainId).erc8004Identity, abi: identityAbi, functionName: "ownerOf", args: [agentId] }),
        this.client
          .readContract({ address: network(this.d.chainId).erc8004Identity, abi: identityAbi, functionName: "getAgentWallet", args: [agentId] })
          .catch(() => "0x0000000000000000000000000000000000000000" as Address),
      ]);
      ok = owner.toLowerCase() === payer.toLowerCase() || wallet.toLowerCase() === payer.toLowerCase();
    } catch {
      ok = false;
    }
    this.agentCheck.set(key, ok);
    return ok;
  }

  get(paymentId: Hex): AccrualRecord | undefined {
    return this.records.get(paymentId.toLowerCase() as Hex);
  }

  list(): AccrualRecord[] {
    return [...this.records.values()];
  }

  /** Queue an accrual. Resolves once the tx is broadcast (not mined). Duplicate ids are ignored. */
  accrue(req: AccrualRequest): Promise<AccrualRecord> {
    const id = req.paymentId.toLowerCase() as Hex;
    const existing = this.records.get(id);
    if (existing) return Promise.resolve(existing);
    const record: AccrualRecord = { ...req, paymentId: id, status: "queued", linkedAgentId: 0n };
    this.records.set(id, record);

    const run = async () => {
      try {
        record.linkedAgentId = (await this.verifyAgent(req.agentId, req.payer)) ? req.agentId : 0n;
        const gas = await this.gasFor(req.payer, req.mgCO2e);
        const send = (limit: bigint) =>
          this.wallet.writeContract({
            address: this.d.retirementPool,
            abi: retirementPoolAbi,
            functionName: "accrue",
            args: [id, req.payer, record.linkedAgentId, req.mgCO2e, req.surcharge, req.methodologyHash],
            gas: limit,
          });
        record.txHash = await send(gas);
        record.status = "sent";
        void this.client
          .waitForTransactionReceipt({ hash: record.txHash })
          .then(async (r) => {
            if (r.status === "success") {
              record.status = "confirmed";
              return;
            }
            // Most likely out of gas because our pending model drifted: resync and retry once
            // at the maximum limit (the revert left paymentId unseen, so this is safe).
            this.pending.delete(req.payer.toLowerCase());
            const retry = await send(accrueGasLimit(MAX_RETIREMENTS_PER_CALL));
            record.txHash = retry;
            const r2 = await this.client.waitForTransactionReceipt({ hash: retry });
            record.status = r2.status === "success" ? "confirmed" : "failed";
            if (r2.status !== "success") record.error = "reverted";
          })
          .catch((e: unknown) => {
            record.status = "failed";
            record.error = String(e);
          });
      } catch (e) {
        record.status = "failed";
        record.error = e instanceof Error ? e.message.split("\n")[0] : String(e);
      }
      return record;
    };
    const p = this.chain.then(run, run);
    this.chain = p;
    return p;
  }

  private async gasFor(payer: Address, mgCO2e: bigint): Promise<bigint> {
    const key = payer.toLowerCase();
    this.threshold ??= await this.client.readContract({
      address: this.d.retirementPool,
      abi: retirementPoolAbi,
      functionName: "thresholdMg",
    });
    let pending = this.pending.get(key);
    if (pending === undefined) {
      const a = await this.client.readContract({
        address: this.d.retirementPool,
        abi: retirementPoolAbi,
        functionName: "account",
        args: [payer],
      });
      pending = a.pendingMg;
    }
    const { retirements, pendingAfter } = predictRetirements(pending, mgCO2e, this.threshold);
    this.pending.set(key, pendingAfter);
    return accrueGasLimit(retirements);
  }

  /** Wait until every queued accrual is mined (or failed). */
  async drain(): Promise<AccrualRecord[]> {
    await this.chain;
    // receipts (and any out-of-gas retry) are tracked in the background; wait for them to settle
    for (let i = 0; i < 240 && [...this.records.values()].some((r) => r.status === "sent"); i++) {
      await new Promise((r) => setTimeout(r, 500));
    }
    return this.list();
  }
}
