import { createWalletClient, erc20Abi, http, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { FUJI, network, retirementPoolAbi, type Deployment } from "@decarbonai/chain";
import { METHODOLOGY_HASH } from "@decarbonai/core";
import type { AccrualStore, AccrualRow, NewAccrual } from "./store.ts";

/**
 * Gas limit per accrueBatch, sized from the items and the retirements they will trigger. We avoid
 * eth_estimateGas (against `latest` it misses retirements caused by earlier pending txs), and keep
 * the limit tight because Avalanche C-Chain bills at least half of the gas limit.
 * Traced on Fuji: ~110k base, ~35k per accrual, ~220k extra for a payer's first accrual, ~320k per
 * mock retirement. A backed retirement also writes ERC-8004 feedback and must leave
 * MIN_FEEDBACK_GAS (400k) available, so it gets 800k.
 */
export const BATCH_BASE_GAS = 150_000n;
export const ITEM_GAS = 40_000n;
export const NEW_PAYER_GAS = 230_000n;
export const RETIREMENT_GAS_MOCK = 400_000n;
export const RETIREMENT_GAS_BACKED = 800_000n;

export function batchGasLimit(items: number, retirements: bigint, newPayers = 0, backed = false): bigint {
  return (
    BATCH_BASE_GAS +
    BigInt(items) * ITEM_GAS +
    BigInt(newPayers) * NEW_PAYER_GAS +
    retirements * (backed ? RETIREMENT_GAS_BACKED : RETIREMENT_GAS_MOCK)
  );
}

/** Retirements a batch triggers, given each payer's on-chain pendingMg, capped by the pool's budget. */
export function predictRetirements(
  items: { payer: Address; mgCO2e: bigint }[],
  pendingByPayer: Map<string, bigint>,
  thresholdMg: bigint,
  maxPerTx: bigint,
): bigint {
  const pending = new Map(pendingByPayer);
  let total = 0n;
  for (const it of items) {
    const key = it.payer.toLowerCase();
    let p = (pending.get(key) ?? 0n) + it.mgCO2e;
    while (p >= thresholdMg && total < maxPerTx) {
      p -= thresholdMg;
      total += 1n;
    }
    pending.set(key, p);
  }
  return total;
}

/** Short, non-sensitive error code (never the raw error: viem messages embed the RPC URL). */
export function errorCode(e: unknown): string {
  if (e && typeof e === "object") {
    const name = (e as { name?: string }).name;
    const cause = (e as { cause?: { name?: string; data?: { errorName?: string } } }).cause;
    if (cause?.data?.errorName) return `REVERT_${cause.data.errorName}`;
    if (name) return name.replace(/Error$/, "").toUpperCase();
  }
  return "UNKNOWN";
}

export type AccrualRequest = NewAccrual;

export type PublicAccrual = Pick<AccrualRow, "paymentId" | "settlementTx" | "status" | "txHash" | "attempts">;

export type Health = { ok: boolean; reasons: string[]; checkedAt: number };

export type MeterOptions = {
  store: AccrualStore;
  batchSize?: number; // default 25
  flushMs?: number; // worker interval, default 2000
  minMeterBalanceWei?: bigint; // fail closed below this (default 0.02 AVAX)
  minFunderAllowance?: bigint; // fail closed below this (default 10 USDC)
  maxBacklog?: number; // fail closed above this many unsettled rows (default 500)
  rpcUrl?: string;
};

/**
 * Settles queued x402 carbon surcharges into the RetirementPool from the meter wallet (METER_ROLE
 * only). Surcharges are pulled by the pool from the merchant payTo wallet (pool.surchargeFunder).
 */
export class CarbonMeter {
  readonly address: Address;
  readonly store: AccrualStore;
  private readonly client: PublicClient;
  private readonly d: Deployment;
  private readonly wallet;
  private readonly batchSize: number;
  private readonly flushMs: number;
  private readonly minMeterBalance: bigint;
  private readonly minFunderAllowance: bigint;
  private readonly maxBacklog: number;
  private timer?: ReturnType<typeof setInterval>;
  private busy: Promise<void> = Promise.resolve();
  private params?: { at: number; threshold: bigint; maxPerTx: bigint; paused: boolean; activeMethods: Set<string> };
  private healthCache?: Health;

  constructor(client: PublicClient, privateKey: Hex, d: Deployment = FUJI, opts: MeterOptions) {
    const account = privateKeyToAccount(privateKey);
    this.address = account.address;
    this.client = client;
    this.d = d;
    this.store = opts.store;
    this.wallet = createWalletClient({ account, chain: network(d.chainId).chain, transport: http(opts.rpcUrl) });
    this.batchSize = opts.batchSize ?? 25;
    this.flushMs = opts.flushMs ?? 2000;
    this.minMeterBalance = opts.minMeterBalanceWei ?? 20_000_000_000_000_000n;
    this.minFunderAllowance = opts.minFunderAllowance ?? 10_000_000n;
    this.maxBacklog = opts.maxBacklog ?? 500;
  }

  /** Durably record a settled payment (sync). Safe to call twice for the same payment. */
  enqueue(req: AccrualRequest): boolean {
    return this.store.insert(req);
  }

  get(id: Hex): PublicAccrual | undefined {
    const r = this.store.get(id);
    return r && { paymentId: r.paymentId, settlementTx: r.settlementTx, status: r.status, txHash: r.txHash, attempts: r.attempts };
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), this.flushMs);
    void this.flush();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One worker pass: recover stale in-flight txs, then settle the next due batch. Serialized. */
  flush(): Promise<void> {
    const run = async () => {
      try {
        await this.recoverSent();
        await this.settleNext();
      } catch {
        // per-row errors are recorded in the store; a pass-level failure (RPC down) just waits for the next tick
      }
    };
    this.busy = this.busy.then(run, run);
    return this.busy;
  }

  /** Flush until nothing is pending or in flight (or timeout). Returns true if fully settled. */
  async drain(timeoutMs = 120_000): Promise<boolean> {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const c = this.store.counts();
      if (c.pending.n === 0 && c.sent.n === 0) return true;
      await this.flush();
      if (this.store.counts().pending.n > 0) await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
  }

  private async refreshParams(force = false) {
    if (!force && this.params && Date.now() - this.params.at < 30_000) return this.params;
    const pool = { address: this.d.retirementPool, abi: retirementPoolAbi } as const;
    const [threshold, maxPerTx, paused, method] = await Promise.all([
      this.client.readContract({ ...pool, functionName: "thresholdMg" }),
      this.client.readContract({ ...pool, functionName: "maxRetirementsPerCall" }),
      this.client.readContract({ ...pool, functionName: "paused" }),
      this.client.readContract({ ...pool, functionName: "methodology", args: [METHODOLOGY_HASH] }),
    ]);
    this.params = {
      at: Date.now(),
      threshold,
      maxPerTx: BigInt(maxPerTx),
      paused,
      activeMethods: new Set(method.active ? [METHODOLOGY_HASH.toLowerCase()] : []),
    };
    return this.params;
  }

  private async settleNext() {
    let rows = this.store.due(this.batchSize);
    if (rows.length === 0) return;
    // a row that already reverted is retried alone, so one bad accrual can't block the others
    if (rows[0].errorCode?.startsWith("REVERT")) rows = rows.slice(0, 1);
    else rows = rows.filter((r) => !r.errorCode?.startsWith("REVERT"));
    const ids = rows.map((r) => r.paymentId);

    const p = await this.refreshParams(true);
    if (p.paused) return this.store.markRetry(ids, "POOL_PAUSED");
    const inactive = rows.filter((r) => !p.activeMethods.has(r.methodologyHash.toLowerCase()));
    if (inactive.length) this.store.markRetry(inactive.map((r) => r.paymentId), "METHODOLOGY_INACTIVE");
    rows = rows.filter((r) => p.activeMethods.has(r.methodologyHash.toLowerCase()));
    if (rows.length === 0) return;

    const payers = [...new Set(rows.map((r) => r.payer.toLowerCase()))] as Address[];
    const accounts = await Promise.all(
      payers.map((payer) =>
        this.client.readContract({
          address: this.d.retirementPool,
          abi: retirementPoolAbi,
          functionName: "account",
          args: [payer],
        }),
      ),
    );
    const pending = new Map(payers.map((payer, i) => [payer, accounts[i].pendingMg]));
    const newPayers = accounts.filter((a) => a.calls === 0n).length;
    const retry = rows.some((r) => r.attempts > 0);
    // retries get the full retirement budget and new-payer allowance, in case our model was wrong
    const retirements = retry ? p.maxPerTx : predictRetirements(rows, pending, p.threshold, p.maxPerTx);
    const gas = batchGasLimit(rows.length, retirements, retry ? rows.length : newPayers, this.d.dco2Backed);

    const items = rows.map((r) => ({
      paymentId: r.paymentId,
      payer: r.payer,
      agentId: r.agentId, // the pool links it only if the payer controls the ERC-8004 agent
      mgCO2e: r.mgCO2e,
      surcharge: r.surcharge,
      methodologyHash: r.methodologyHash,
    }));
    const sentIds = rows.map((r) => r.paymentId);
    let hash: Hex;
    try {
      hash = await this.wallet.writeContract({
        address: this.d.retirementPool,
        abi: retirementPoolAbi,
        functionName: "accrueBatch",
        args: [items],
        gas,
      });
    } catch (e) {
      return this.store.markRetry(sentIds, errorCode(e));
    }
    this.store.markSent(sentIds, hash);
    await this.settleReceipt(hash, sentIds);
  }

  private async settleReceipt(hash: Hex, ids: Hex[]) {
    try {
      const r = await this.client.waitForTransactionReceipt({ hash, timeout: 60_000 });
      if (r.status === "success") this.store.markConfirmed(ids);
      else this.store.markRetry(ids, "REVERTED");
    } catch {
      // still in flight or RPC hiccup: recoverSent() resolves it on a later pass
    }
  }

  /** Resolve rows stuck in 'sent' (crash, restart, receipt timeout) against the chain. */
  private async recoverSent(minAgeMs = 90_000) {
    const stale = this.store.byStatus("sent").filter((r) => Date.now() - r.updatedAt >= minAgeMs);
    const byTx = new Map<Hex, AccrualRow[]>();
    for (const r of stale) {
      const k = (r.txHash ?? "0x") as Hex;
      byTx.set(k, [...(byTx.get(k) ?? []), r]);
    }
    for (const [hash, rows] of byTx) {
      const receipt = hash !== "0x" ? await this.client.getTransactionReceipt({ hash }).catch(() => null) : null;
      if (receipt?.status === "success") {
        this.store.markConfirmed(rows.map((r) => r.paymentId));
        continue;
      }
      await this.resolveByChain(rows, receipt ? "REVERTED" : "DROPPED");
    }
  }

  /** Confirm rows the pool already counted (paymentSeen); retry the rest. */
  private async resolveByChain(rows: AccrualRow[], code: string) {
    const seen = await Promise.all(
      rows.map((r) =>
        this.client.readContract({
          address: this.d.retirementPool,
          abi: retirementPoolAbi,
          functionName: "paymentSeen",
          args: [r.paymentId],
        }),
      ),
    );
    this.store.markConfirmed(rows.filter((_, i) => seen[i]).map((r) => r.paymentId));
    const missing = rows.filter((_, i) => !seen[i]).map((r) => r.paymentId);
    if (missing.length) this.store.markRetry(missing, code);
  }

  /** Recover all in-flight rows immediately (call once at startup). */
  recover(): Promise<void> {
    const run = () => this.recoverSent(0);
    this.busy = this.busy.then(run, run);
    return this.busy;
  }

  /**
   * Reconciliation: every surcharge we took must be on-chain. Confirmed rows are checked against
   * pool.paymentSeen (re-queued if missing); pending/sent rows already seen are marked confirmed.
   */
  async reconcile() {
    for (const status of ["confirmed", "pending", "sent"] as const) {
      const rows = this.store.byStatus(status);
      for (let i = 0; i < rows.length; i += 50) {
        const chunk = rows.slice(i, i + 50);
        if (status === "confirmed") {
          const seen = await Promise.all(
            chunk.map((r) =>
              this.client.readContract({
                address: this.d.retirementPool,
                abi: retirementPoolAbi,
                functionName: "paymentSeen",
                args: [r.paymentId],
              }),
            ),
          );
          const missing = chunk.filter((_, j) => !seen[j]).map((r) => r.paymentId);
          if (missing.length) this.store.markRetry(missing, "RECONCILE_MISSING");
        } else {
          await this.resolveByChain(chunk, status === "sent" ? "DROPPED" : "PENDING");
        }
      }
    }
    return this.store.counts();
  }

  /**
   * Fail-closed check for the API: do not quote a surcharge we cannot settle. Cached for 10 s.
   */
  async health(force = false): Promise<Health> {
    if (!force && this.healthCache && Date.now() - this.healthCache.checkedAt < 10_000) return this.healthCache;
    const reasons: string[] = [];
    try {
      const p = await this.refreshParams(true);
      if (p.paused) reasons.push("pool paused");
      if (!p.activeMethods.has(METHODOLOGY_HASH.toLowerCase())) reasons.push("methodology inactive");
      const funder = await this.client.readContract({
        address: this.d.retirementPool,
        abi: retirementPoolAbi,
        functionName: "surchargeFunder",
        args: [this.address],
      });
      const payer = funder === "0x0000000000000000000000000000000000000000" ? this.address : funder;
      const [balance, allowance] = await Promise.all([
        this.client.getBalance({ address: this.address }),
        this.client.readContract({
          address: this.d.paymentToken,
          abi: erc20Abi,
          functionName: "allowance",
          args: [payer, this.d.retirementPool],
        }),
      ]);
      if (balance < this.minMeterBalance) reasons.push("meter low on gas");
      if (allowance < this.minFunderAllowance) reasons.push("surcharge funder allowance too low");
    } catch {
      reasons.push("chain unreachable");
    }
    const c = this.store.counts();
    if (c.pending.n + c.sent.n > this.maxBacklog) reasons.push("settlement backlog");
    this.healthCache = { ok: reasons.length === 0, reasons, checkedAt: Date.now() };
    return this.healthCache;
  }
}
