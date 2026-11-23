import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Address, Hex } from "viem";

/**
 * Durable accrual queue (SQLite, node:sqlite). Every settled x402 payment is written here
 * synchronously, before the API responds, so a paid surcharge survives restarts, a paused pool,
 * an empty meter wallet or RPC failures. The meter worker drains it into RetirementPool.accrueBatch.
 *
 * Lifecycle: pending -> sent (tx broadcast) -> confirmed. A failed or reverted tx goes back to
 * pending with attempts + 1 and a short error code; it is retried with backoff and never dropped.
 */
export type AccrualStatus = "pending" | "sent" | "confirmed";

export type AccrualRow = {
  paymentId: Hex;
  settlementTx: Hex;
  payer: Address;
  agentId: bigint;
  mgCO2e: bigint;
  surcharge: bigint;
  methodologyHash: Hex;
  status: AccrualStatus;
  txHash: Hex | null;
  attempts: number;
  errorCode: string | null;
  createdAt: number;
  updatedAt: number;
  nextAttemptAt: number;
};

export type NewAccrual = Pick<
  AccrualRow,
  "paymentId" | "settlementTx" | "payer" | "agentId" | "mgCO2e" | "surcharge" | "methodologyHash"
>;

/**
 * A payment handed to the facilitator whose outcome is not recorded yet. Written before settlement, so a lost
 * settle response cannot hide a charged payment; replaced by the accrual row, or resolved from the chain.
 */
export type SettleIntent = Omit<NewAccrual, "settlementTx"> & {
  nonce: Hex;
  asset: Address;
  payTo: Address;
  amount: bigint; // total authorized, base price + surcharge
  validBefore: number; // unix seconds
  fromBlock: bigint; // a block before the settlement
  createdAt: number;
};

type RawIntent = {
  payment_id: string;
  payer: string;
  agent_id: string;
  mg_co2e: string;
  surcharge: string;
  methodology_hash: string;
  nonce: string;
  asset: string;
  pay_to: string;
  amount: string;
  valid_before: number;
  from_block: string;
  created_at: number;
};

const toIntent = (r: RawIntent): SettleIntent => ({
  paymentId: r.payment_id as Hex,
  payer: r.payer as Address,
  agentId: BigInt(r.agent_id),
  mgCO2e: BigInt(r.mg_co2e),
  surcharge: BigInt(r.surcharge),
  methodologyHash: r.methodology_hash as Hex,
  nonce: r.nonce as Hex,
  asset: r.asset as Address,
  payTo: r.pay_to as Address,
  amount: BigInt(r.amount),
  validBefore: r.valid_before,
  fromBlock: BigInt(r.from_block),
  createdAt: r.created_at,
});

type Raw = {
  payment_id: string;
  settlement_tx: string;
  payer: string;
  agent_id: string;
  mg_co2e: string;
  surcharge: string;
  methodology_hash: string;
  status: AccrualStatus;
  tx_hash: string | null;
  attempts: number;
  error_code: string | null;
  created_at: number;
  updated_at: number;
  next_attempt_at: number;
};

const toRow = (r: Raw): AccrualRow => ({
  paymentId: r.payment_id as Hex,
  settlementTx: r.settlement_tx as Hex,
  payer: r.payer as Address,
  agentId: BigInt(r.agent_id),
  mgCO2e: BigInt(r.mg_co2e),
  surcharge: BigInt(r.surcharge),
  methodologyHash: r.methodology_hash as Hex,
  status: r.status,
  txHash: r.tx_hash as Hex | null,
  attempts: r.attempts,
  errorCode: r.error_code,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  nextAttemptAt: r.next_attempt_at,
});

export class AccrualStore {
  private readonly db: DatabaseSync;

  /** `path` = file path, or ":memory:" for tests. A blank path is refused: SQLite would open a temporary DB. */
  constructor(path: string) {
    if (!path.trim()) throw new Error("accrual DB path is empty (SQLite would use a temporary file)");
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS accruals (
        payment_id TEXT PRIMARY KEY,
        settlement_tx TEXT NOT NULL,
        payer TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        mg_co2e TEXT NOT NULL,
        surcharge TEXT NOT NULL,
        methodology_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        tx_hash TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        error_code TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        next_attempt_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS settle_intents (
        payment_id TEXT PRIMARY KEY,
        payer TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        mg_co2e TEXT NOT NULL,
        surcharge TEXT NOT NULL,
        methodology_hash TEXT NOT NULL,
        nonce TEXT NOT NULL,
        asset TEXT NOT NULL,
        pay_to TEXT NOT NULL,
        amount TEXT NOT NULL,
        valid_before INTEGER NOT NULL,
        from_block TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS accruals_status ON accruals (status, next_attempt_at);
      CREATE INDEX IF NOT EXISTS accruals_settlement ON accruals (settlement_tx);
    `);
  }

  /**
   * Tie this DB to one chain + pool, forever. Rows carry no chain, so replaying a Fuji queue into the mainnet
   * pool would pull real USDC and burn backed DCO2 for payments that never happened. Throws on a mismatch,
   * and on a DB that already has rows but no recorded chain (written before this check).
   */
  bindTo(chainId: number, pool: Address) {
    const want = `${chainId}:${pool.toLowerCase()}`;
    const have = (this.db.prepare("SELECT value FROM meta WHERE key = 'chain_pool'").get() as { value: string } | undefined)?.value;
    if (have === want) return;
    if (have) throw new Error(`accrual DB belongs to ${have}, not ${want}: use a separate ACCRUAL_DB per chain and pool`);
    const { n } = this.db.prepare("SELECT COUNT(*) AS n FROM accruals").get() as { n: number };
    if (n > 0) throw new Error(`accrual DB has ${n} rows but no recorded chain and pool: move it away, do not use it for ${want}`);
    this.db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('chain_pool', ?)").run(want);
    const stored = (this.db.prepare("SELECT value FROM meta WHERE key = 'chain_pool'").get() as { value: string }).value;
    if (stored !== want) throw new Error(`accrual DB belongs to ${stored}, not ${want}`);
  }

  /** Durable insert; ignores a payment already recorded, and closes its settle intent. Returns true if it was new. */
  insert(a: NewAccrual, now = Date.now()): boolean {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const isNew = this.insertRow(a, now);
      this.closeIntent(a.paymentId);
      this.db.exec("COMMIT");
      return isNew;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  insertIntent(i: Omit<SettleIntent, "createdAt">, now = Date.now()) {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO settle_intents
         (payment_id, payer, agent_id, mg_co2e, surcharge, methodology_hash, nonce, asset, pay_to, amount, valid_before, from_block, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        i.paymentId.toLowerCase(),
        i.payer.toLowerCase(),
        i.agentId.toString(),
        i.mgCO2e.toString(),
        i.surcharge.toString(),
        i.methodologyHash,
        i.nonce,
        i.asset.toLowerCase(),
        i.payTo.toLowerCase(),
        i.amount.toString(),
        i.validBefore,
        i.fromBlock.toString(),
        now,
      );
  }

  /** Settle intents by status: 'open' = outcome unknown, 'unresolved' = needs a human. */
  intents(status: "open" | "unresolved" = "open", createdBefore = Date.now()): SettleIntent[] {
    return (
      this.db.prepare("SELECT * FROM settle_intents WHERE status = ? AND created_at <= ? ORDER BY created_at").all(status, createdBefore) as RawIntent[]
    ).map(toIntent);
  }

  closeIntent(id: Hex) {
    this.db.prepare("DELETE FROM settle_intents WHERE payment_id = ?").run(id.toLowerCase());
  }

  markIntentUnresolved(id: Hex) {
    this.db.prepare("UPDATE settle_intents SET status = 'unresolved' WHERE payment_id = ?").run(id.toLowerCase());
  }

  private insertRow(a: NewAccrual, now: number): boolean {
    const r = this.db
      .prepare(
        `INSERT OR IGNORE INTO accruals
         (payment_id, settlement_tx, payer, agent_id, mg_co2e, surcharge, methodology_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        a.paymentId.toLowerCase(),
        a.settlementTx.toLowerCase(),
        a.payer.toLowerCase(),
        a.agentId.toString(),
        a.mgCO2e.toString(),
        a.surcharge.toString(),
        a.methodologyHash,
        now,
        now,
      );
    return Number(r.changes) > 0;
  }

  /** Oldest pending rows that are due, up to `limit`. */
  due(limit: number, now = Date.now()): AccrualRow[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM accruals WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY created_at LIMIT ?",
        )
        .all(now, limit) as Raw[]
    ).map(toRow);
  }

  byStatus(status: AccrualStatus): AccrualRow[] {
    return (this.db.prepare("SELECT * FROM accruals WHERE status = ? ORDER BY created_at").all(status) as Raw[]).map(
      toRow,
    );
  }

  get(id: Hex): AccrualRow | undefined {
    const key = id.toLowerCase();
    const r = this.db.prepare("SELECT * FROM accruals WHERE payment_id = ? OR settlement_tx = ? LIMIT 1").get(key, key);
    return r ? toRow(r as Raw) : undefined;
  }

  markSent(ids: Hex[], txHash: Hex, now = Date.now()) {
    const stmt = this.db.prepare(
      "UPDATE accruals SET status = 'sent', tx_hash = ?, attempts = attempts + 1, updated_at = ? WHERE payment_id = ?",
    );
    for (const id of ids) stmt.run(txHash, now, id.toLowerCase());
  }

  markConfirmed(ids: Hex[], now = Date.now()) {
    const stmt = this.db.prepare(
      "UPDATE accruals SET status = 'confirmed', error_code = NULL, updated_at = ? WHERE payment_id = ?",
    );
    for (const id of ids) stmt.run(now, id.toLowerCase());
  }

  /** Back to pending with exponential backoff (2s .. 5min). Never dropped. */
  markRetry(ids: Hex[], errorCode: string, now = Date.now()) {
    const stmt = this.db.prepare(
      `UPDATE accruals SET status = 'pending', error_code = ?, updated_at = ?,
         next_attempt_at = ? + MIN(300000, 2000 * (1 << MIN(attempts, 8)))
       WHERE payment_id = ?`,
    );
    for (const id of ids) stmt.run(errorCode, now, now, id.toLowerCase());
  }

  /** Surcharge still to be pulled from payTo for rows created at or before `createdBefore`. */
  unsettledSurcharge(createdBefore = Date.now()): bigint {
    const rows = this.db.prepare("SELECT surcharge FROM accruals WHERE status <> 'confirmed' AND created_at <= ?").all(createdBefore) as { surcharge: string }[];
    return rows.reduce((sum, r) => sum + BigInt(r.surcharge), 0n);
  }

  counts(): Record<AccrualStatus, { n: number; surcharge: bigint }> {
    const out: Record<AccrualStatus, { n: number; surcharge: bigint }> = {
      pending: { n: 0, surcharge: 0n },
      sent: { n: 0, surcharge: 0n },
      confirmed: { n: 0, surcharge: 0n },
    };
    for (const r of this.db.prepare("SELECT status, surcharge FROM accruals").all() as {
      status: AccrualStatus;
      surcharge: string;
    }[]) {
      out[r.status].n += 1;
      out[r.status].surcharge += BigInt(r.surcharge);
    }
    return out;
  }

  close() {
    this.db.close();
  }
}
