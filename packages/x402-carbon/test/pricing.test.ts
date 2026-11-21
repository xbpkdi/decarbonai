import assert from "node:assert/strict";
import { test } from "node:test";
import { FUJI } from "@decarbonai/chain";
import { METHODOLOGY_HASH, METHODOLOGY_VERSION, estimateCallMgCO2e } from "@decarbonai/core";
import { approxTokens, carbonQuote, quoteSurcharge, usageFromQuery } from "../src/pricing.ts";
import { paymentIdOf } from "../src/middleware.ts";

const PRICE = 25_000_000n; // $25 / t, same as RetirementPoolTest

test("quoteSurcharge matches RetirementPool.quote rounding (ceil)", () => {
  assert.equal(quoteSurcharge(1_000_000_000n, PRICE), PRICE);
  assert.equal(quoteSurcharge(1n, PRICE), 1n);
  assert.equal(quoteSurcharge(40n, PRICE), 1n);
  assert.equal(quoteSurcharge(41n, PRICE), 2n);
  assert.equal(quoteSurcharge(0n, PRICE), 0n);
  assert.equal(quoteSurcharge(123n, 0n), 0n);
  for (const mg of [1n, 999n, 22_907n, 1_000_000n, 123_456_789n]) {
    const q = quoteSurcharge(mg, PRICE);
    assert.ok(q * 1_000_000_000n >= mg * PRICE);
    assert.ok(q * 1_000_000_000n < mg * PRICE + 1_000_000_000n);
  }
});

test("carbonQuote adds the surcharge to the base price", () => {
  const q = carbonQuote({ model: "reasoning-heavy", inputTokens: 4, outputTokens: 1000 }, 10_000n, PRICE);
  assert.equal(q.mgCO2e, BigInt(estimateCallMgCO2e("reasoning-heavy", 4, 1000)));
  assert.equal(q.surcharge, quoteSurcharge(q.mgCO2e, PRICE));
  assert.equal(q.total, 10_000n + q.surcharge);
  assert.equal(q.methodologyHash, METHODOLOGY_HASH);
  assert.equal(q.methodologyVersion, METHODOLOGY_VERSION);
});

test("methodology hash matches the one registered on Fuji", () => {
  // If this fails the emission factors changed: register the new hash with pool.setMethodology first.
  assert.equal(METHODOLOGY_HASH, FUJI.methodologyHash);
  assert.equal(METHODOLOGY_VERSION, FUJI.methodologyVersion);
});

test("usageFromQuery validates model and token bounds", () => {
  const q = (o: Record<string, string>) => (n: string) => o[n];
  assert.deepEqual(usageFromQuery(q({})), { model: "claude-sonnet", inputTokens: 0, outputTokens: 500 });
  assert.deepEqual(usageFromQuery(q({ model: "claude-opus", prompt: "abcdefgh", maxOutputTokens: "10" })), {
    model: "claude-opus",
    inputTokens: 2,
    outputTokens: 10,
  });
  assert.throws(() => usageFromQuery(q({ model: "gpt-9" })), /unknown model/);
  assert.throws(() => usageFromQuery(q({ maxOutputTokens: "0" })), /maxOutputTokens/);
  assert.throws(() => usageFromQuery(q({ maxOutputTokens: "4001" })), /maxOutputTokens/);
  assert.throws(() => usageFromQuery(q({ maxOutputTokens: "1.5" })), /maxOutputTokens/);
  assert.equal(approxTokens("12345"), 2);
});

test("paymentIdOf is unique per authorization nonce, not per settlement tx", () => {
  const payer = "0x254E5C3cF3e6B90D14F6fC182F167764B8C183bB" as const;
  const n1 = `0x${"11".repeat(32)}` as const;
  const n2 = `0x${"22".repeat(32)}` as const;
  const a = paymentIdOf(43113, FUJI.paymentToken, payer, n1);
  assert.equal(a, paymentIdOf(43113, FUJI.paymentToken, payer, n1));
  assert.notEqual(a, paymentIdOf(43113, FUJI.paymentToken, payer, n2));
  assert.notEqual(a, paymentIdOf(43114, FUJI.paymentToken, payer, n1));
  assert.match(a, /^0x[0-9a-f]{64}$/);
});

test("accrue gas limit follows predicted retirements", async () => {
  const { accrueGasLimit, predictRetirements, ACCRUE_BASE_GAS, RETIREMENT_GAS } = await import("../src/meter.ts");
  const KG = 1_000_000n;
  assert.deepEqual(predictRetirements(0n, 22_000n, KG), { retirements: 0n, pendingAfter: 22_000n });
  assert.deepEqual(predictRetirements(990_000n, 22_000n, KG), { retirements: 1n, pendingAfter: 12_000n });
  assert.deepEqual(predictRetirements(0n, 7n * KG + 5n, KG), { retirements: 5n, pendingAfter: 2n * KG + 5n });
  assert.equal(accrueGasLimit(0n), ACCRUE_BASE_GAS);
  assert.equal(accrueGasLimit(1n), ACCRUE_BASE_GAS + RETIREMENT_GAS);
  assert.equal(accrueGasLimit(9n), ACCRUE_BASE_GAS + 5n * RETIREMENT_GAS);
});
