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

  /** `path` = file path, or ":memory:" for tests. */
  constructor(path: string) {
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
      CREATE INDEX IF NOT EXISTS accruals_status ON accruals (status, next_attempt_at);
      CREATE INDEX IF NOT EXISTS accruals_settlement ON accruals (settlement_tx);
    `);
  }

  /** Durable insert; ignores a payment already recorded. Returns true if it was new. */
  insert(a: NewAccrual, now = Date.now()): boolean {
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
