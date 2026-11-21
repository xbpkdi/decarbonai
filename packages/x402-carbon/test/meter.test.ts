import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Address, Hex } from "viem";
import { AccrualStore } from "../src/store.ts";
import {
  BATCH_BASE_GAS,
  ITEM_GAS,
  NEW_PAYER_GAS,
  RETIREMENT_GAS_BACKED,
  RETIREMENT_GAS_MOCK,
  batchGasLimit,
  errorCode,
  predictRetirements,
} from "../src/meter.ts";

const KG = 1_000_000n;
const A = "0x00000000000000000000000000000000000000aa" as Address;
const B = "0x00000000000000000000000000000000000000bb" as Address;
const id = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const row = (n: number, payer: Address = A) => ({
  paymentId: id(n),
  settlementTx: id(1000 + Math.floor(n / 3)), // facilitator batches: several payments share a tx
  payer,
  agentId: 360n,
  mgCO2e: 22_000n,
  surcharge: 550n,
  methodologyHash: id(7),
});

test("store: durable across reopen, dedupes, orders and indexes by settlement tx", () => {
  const dir = mkdtempSync(join(tmpdir(), "accruals-"));
  const path = join(dir, "q.sqlite");
  try {
    const s1 = new AccrualStore(path);
    assert.equal(s1.insert(row(1), 1000), true);
    assert.equal(s1.insert(row(2), 2000), true);
    assert.equal(s1.insert(row(1), 3000), false); // same payment twice
    s1.close();

    const s2 = new AccrualStore(path); // "restart"
    const due = s2.due(10, 5000);
    assert.deepEqual(due.map((r) => r.paymentId), [id(1), id(2)]);
    assert.equal(due[0].agentId, 360n);
    assert.equal(due[0].mgCO2e, 22_000n);
    assert.equal(s2.get(id(1000))?.paymentId, id(1)); // lookup by settlement tx
    assert.equal(s2.get(id(1).toUpperCase().replace("0X", "0x") as Hex)?.paymentId, id(1));
    s2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("store: sent -> confirmed, retry backs off and never drops", () => {
  const s = new AccrualStore(":memory:");
  s.insert(row(1), 0);
  s.insert(row(2), 0);
  s.markSent([id(1), id(2)], id(99), 10);
  assert.equal(s.due(10, 10).length, 0);
  assert.equal(s.byStatus("sent").length, 2);
  s.markConfirmed([id(1)], 20);
  s.markRetry([id(2)], "REVERTED", 20); // attempts = 1 -> 4s backoff
  assert.equal(s.due(10, 1000).length, 0);
  const [r] = s.due(10, 20 + 4000);
  assert.equal(r.paymentId, id(2));
  assert.equal(r.errorCode, "REVERTED");
  assert.equal(r.attempts, 1);
  const c = s.counts();
  assert.equal(c.confirmed.n, 1);
  assert.equal(c.pending.n, 1);
  assert.equal(c.pending.surcharge, 550n);
  s.close();
});

test("batch gas: retirements predicted per payer, capped by the pool budget", () => {
  const pending = new Map<string, bigint>([[A.toLowerCase(), 990_000n]]);
  const items = [
    { payer: A, mgCO2e: 22_000n }, // A crosses 1 kg -> 1 retirement
    { payer: B, mgCO2e: 22_000n },
    { payer: B, mgCO2e: 3n * KG }, // B -> 3 retirements
  ];
  assert.equal(predictRetirements(items, pending, KG, 5n), 4n);
  assert.equal(predictRetirements(items, pending, KG, 2n), 2n);
  assert.equal(predictRetirements([{ payer: A, mgCO2e: 1n }], new Map(), KG, 5n), 0n);
  assert.equal(batchGasLimit(3, 4n), BATCH_BASE_GAS + 3n * ITEM_GAS + 4n * RETIREMENT_GAS_MOCK);
  assert.equal(batchGasLimit(3, 1n, 2, true), BATCH_BASE_GAS + 3n * ITEM_GAS + 2n * NEW_PAYER_GAS + RETIREMENT_GAS_BACKED);
  // Avalanche bills max(used, limit/2): a 15-item batch traced at 627k must not be over-provisioned 2x
  assert.ok(batchGasLimit(15, 0n) / 2n <= 627_341n);
});

test("errorCode never echoes the raw error (viem messages embed the RPC URL)", () => {
  const e = Object.assign(new Error("HTTP request failed. URL: https://rpc.example/v3/SECRETKEY"), {
    name: "HttpRequestError",
  });
  assert.equal(errorCode(e), "HTTPREQUEST");
  assert.equal(errorCode({ name: "X", cause: { data: { errorName: "DailyCapExceeded" } } }), "REVERT_DailyCapExceeded");
  assert.equal(errorCode("boom"), "UNKNOWN");
  assert.ok(!errorCode(e).includes("SECRET"));
});
