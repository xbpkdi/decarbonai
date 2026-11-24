// The audit's admin rule: a 1-of-1 Safe of a personal wallet passes; an EOA, threshold 0, 1-of-N or a bot owner fails.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Address } from "viem";
import { BOT_WALLETS, safeProblems } from "../lib/safe.ts";

const OWNER = "0x00000000000000000000000000000000000000a1" as Address;
const OTHER = "0x00000000000000000000000000000000000000a2" as Address;
const safe = (threshold: bigint, owners: Address[]) => ({ hasCode: true, threshold, owners });

test("a 1-of-1 Safe of the owner's wallet passes", () => {
  assert.deepEqual(safeProblems(safe(1n, [OWNER])), []);
});

test("a 2-of-2 Safe still passes", () => {
  assert.deepEqual(safeProblems(safe(2n, [OWNER, OTHER])), []);
});

test("an EOA admin fails", () => {
  assert.match(safeProblems({ hasCode: false, threshold: 0n, owners: [] })[0], /EOA/);
});

test("threshold 0, 1-of-2, no owners and threshold above owners fail", () => {
  for (const [t, owners] of [[0n, [OWNER]], [1n, [OWNER, OTHER]], [1n, []], [2n, [OWNER]]] as [bigint, Address[]][]) {
    assert.equal(safeProblems(safe(t, owners)).length, 1, `${t} of ${owners.length}`);
  }
});

test("a raised minimum refuses the 1-of-1", () => {
  assert.equal(safeProblems(safe(1n, [OWNER]), {}, 2n).length, 1);
});

test("each mainnet bot wallet as the single owner fails, in any case", () => {
  assert.equal(Object.keys(BOT_WALLETS).length, 5);
  for (const [name, bot] of Object.entries(BOT_WALLETS)) {
    const problems = safeProblems(safe(1n, [bot.toLowerCase() as Address]));
    assert.deepEqual(problems, [`owner ${bot.toLowerCase()} is the ${name} bot wallet`]);
  }
});

test("the deployment's own deployer, meter and payTo fail too", () => {
  assert.match(safeProblems(safe(1n, [OWNER]), { meter: OWNER }).join(), /meter bot wallet/);
});
