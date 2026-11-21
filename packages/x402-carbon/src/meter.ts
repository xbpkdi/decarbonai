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
import { avalancheFuji } from "viem/chains";
import { ERC8004_IDENTITY_FUJI, FUJI, retirementPoolAbi, type Deployment } from "@decarbonai/chain";

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

/** Fixed gas: estimation against `latest` can miss a retirement that happens once earlier
 *  pending accruals land, so we never rely on it. Covers maxRetirementsPerCall = 5. */
const ACCRUE_GAS = 3_000_000n;

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
  private readonly client: PublicClient;
  private readonly d: Deployment;

  constructor(client: PublicClient, privateKey: Hex, d: Deployment = FUJI, rpcUrl?: string) {
    this.client = client;
    this.d = d;
    const account = privateKeyToAccount(privateKey, { nonceManager });
    this.address = account.address;
    this.wallet = createWalletClient({ account, chain: avalancheFuji, transport: http(rpcUrl) });
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
        this.client.readContract({ address: ERC8004_IDENTITY_FUJI, abi: identityAbi, functionName: "ownerOf", args: [agentId] }),
        this.client
          .readContract({ address: ERC8004_IDENTITY_FUJI, abi: identityAbi, functionName: "getAgentWallet", args: [agentId] })
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
        record.txHash = await this.wallet.writeContract({
          address: this.d.retirementPool,
          abi: retirementPoolAbi,
          functionName: "accrue",
          args: [id, req.payer, record.linkedAgentId, req.mgCO2e, req.surcharge, req.methodologyHash],
          gas: ACCRUE_GAS,
        });
        record.status = "sent";
        void this.client
          .waitForTransactionReceipt({ hash: record.txHash })
          .then((r) => {
            record.status = r.status === "success" ? "confirmed" : "failed";
            if (r.status !== "success") record.error = "reverted";
          })
          .catch((e: unknown) => {
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

  /** Wait until every queued accrual is mined (or failed). */
  async drain(): Promise<AccrualRecord[]> {
    await this.chain;
    for (const r of this.records.values()) {
      if (r.status === "sent" && r.txHash) {
        const receipt = await this.client.waitForTransactionReceipt({ hash: r.txHash });
        r.status = receipt.status === "success" ? "confirmed" : "failed";
      }
    }
    return this.list();
  }
}
