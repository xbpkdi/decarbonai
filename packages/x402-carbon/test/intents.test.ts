// A payment whose settle response never arrives must still be recorded (review S1), and health must fail
// closed when the surcharge cannot be pulled (review S2).
import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { type Address, type Hex, createPublicClient, encodeEventTopics, http, pad, parseAbi, toHex } from "viem";
import { avalancheFuji } from "viem/chains";
import { FUJI } from "@decarbonai/chain";
import { METHODOLOGY_HASH } from "@decarbonai/core";
import { CarbonMeter } from "../src/meter.ts";
import { AccrualStore } from "../src/store.ts";
import { type RpcState, rpcMock } from "./rpc-mock.ts";

const PAYER = "0x00000000000000000000000000000000000000aa" as Address;
const EVIL = "0x00000000000000000000000000000000000000ee" as Address;
const NONCE = `0x${"11".repeat(32)}` as Hex;
const TX = `0x${"ab".repeat(32)}` as Hex;
const ID = `0x${"77".repeat(32)}` as Hex;
const NOW = Math.floor(Date.now() / 1000);
const abi = parseAbi(["event AuthorizationUsed(address indexed a, bytes32 indexed n)", "event Transfer(address indexed from, address indexed to, uint256 value)"]);

const log = (topics: unknown[], data: Hex, address: Address = FUJI.paymentToken) => ({
  address, topics, data, blockNumber: "0x64", transactionHash: TX, transactionIndex: "0x0", blockHash: `0x${"0".repeat(64)}`, logIndex: "0x0", removed: false,
});
const used = () => log(encodeEventTopics({ abi, eventName: "AuthorizationUsed", args: { a: PAYER, n: NONCE } }), "0x");
const transfer = (to: Address, value: bigint, token?: Address) => log(encodeEventTopics({ abi, eventName: "Transfer", args: { from: PAYER, to } }), pad(toHex(value)), token);
const receipt = (logs: unknown[], status = "0x1") => ({
  transactionHash: TX, status, logs, blockNumber: "0x64", blockHash: `0x${"0".repeat(64)}`, gasUsed: "0x1", cumulativeGasUsed: "0x1", effectiveGasPrice: "0x1",
  from: PAYER, to: FUJI.paymentToken, contractAddress: null, logsBloom: `0x${"0".repeat(512)}`, transactionIndex: "0x0", type: "0x2",
});

async function setup(t: TestContext, over: Partial<RpcState> = {}) {
  const state: RpcState = {
    chainId: 43113, blockNumber: 120n, timestamp: NOW, balance: 10n ** 18n, logs: [used()], receipts: { [TX]: receipt([used(), transfer(FUJI.payTo, 10_034n)]) },
    ...over,
    reads: {
      authorizationState: true, thresholdMg: 1_000_000n, maxRetirementsPerCall: 5, paused: false, pricePerTonne: BigInt(FUJI.pricePerTonne),
      methodology: { active: true, version: "v" }, surchargeFunder: FUJI.payTo, allowance: 25_000_000n, balanceOf: 1_000_000n, ...over.reads,
    },
  };
  const rpc = await rpcMock(state);
  const store = new AccrualStore(":memory:");
  const client = createPublicClient({ chain: avalancheFuji, transport: http(rpc.url, { retryCount: 0 }) });
  const meter = new CarbonMeter(client as never, `0x${"01".repeat(32)}`, FUJI, { store, rpcUrl: rpc.url });
  t.after(() => rpc.close());
  const open = (validBefore = NOW + 120) =>
    meter.openIntent({
      paymentId: ID, payer: PAYER, agentId: 7n, mgCO2e: 1360n, surcharge: 34n, methodologyHash: METHODOLOGY_HASH,
      nonce: NONCE, asset: FUJI.paymentToken, payTo: FUJI.payTo, amount: 10_034n, validBefore,
    });
  return { state, store, meter, open };
}

test("paid but unrecorded: the accrual is rebuilt from the chain", async (t) => {
  const { store, meter, open } = await setup(t);
  await open();
  await meter.resolveIntents(); // still young: the settle response may yet arrive
  assert.equal(store.counts().pending.n, 0);
  await meter.resolveIntents(0);
  const r = store.get(ID);
  assert.equal(r?.status, "pending");
  assert.equal(r?.settlementTx, TX);
  assert.equal(r?.surcharge, 34n);
  assert.equal(r?.agentId, 7n);
  assert.equal(store.intents().length, 0);
});

test("normal settle: the accrual closes the intent, resolving later adds nothing", async (t) => {
  const { store, meter, open } = await setup(t);
  await open();
  meter.enqueue({ paymentId: ID, settlementTx: TX, payer: PAYER, agentId: 7n, mgCO2e: 1360n, surcharge: 34n, methodologyHash: METHODOLOGY_HASH });
  assert.equal(store.intents().length, 0);
  await meter.resolveIntents(0);
  assert.equal(store.counts().pending.n, 1);
});

test("never settled: kept until expired plus margin, then dropped without an accrual", async (t) => {
  const { state, store, meter, open } = await setup(t, { logs: [], reads: { authorizationState: false } });
  await open();
  await meter.resolveIntents(0);
  state.timestamp = NOW + 120 + 299;
  await meter.resolveIntents(0);
  assert.equal(store.intents().length, 1);
  state.timestamp = NOW + 120 + 301;
  await meter.resolveIntents(0);
  assert.equal(store.intents().length, 0);
  assert.equal(store.counts().pending.n, 0);
});

test("nonce used without paying the merchant: never accrued, flagged once expired", async (t) => {
  for (const r of [
    receipt([used(), transfer(EVIL, 10_034n)]), // same nonce signed to somebody else
    receipt([used(), transfer(FUJI.payTo, 1n)]), // wrong amount
    receipt([used(), transfer(FUJI.payTo, 10_034n, EVIL)]), // look-alike token
    receipt([used(), transfer(FUJI.payTo, 10_034n)], "0x0"),
  ]) {
    const { state, store, meter, open } = await setup(t, { receipts: { [TX]: r } });
    await open();
    await meter.resolveIntents(0);
    assert.equal(store.intents("open").length, 1);
    state.timestamp = NOW + 120 + 301;
    await meter.resolveIntents(0);
    assert.equal(store.counts().pending.n, 0);
    assert.equal(store.intents("unresolved").length, 1);
  }
});

test("RPC down: the intent survives; a write that fails throws so nothing is settled", async (t) => {
  const { state, store, meter, open } = await setup(t);
  await open();
  state.down = true;
  await meter.resolveIntents(0);
  assert.equal(store.intents().length, 1);
  store.close();
  await assert.rejects(open());
});

test("health fails closed when payTo cannot cover what is owed, or the pool price rose", async (t) => {
  const { state, store, meter } = await setup(t);
  assert.deepEqual((await meter.health(true)).reasons, []);
  state.reads.balanceOf = 0n; // fresh payTo, nothing owed: the first payment brings its own surcharge
  assert.equal((await meter.health(true)).ok, true);
  const row = { settlementTx: TX, payer: PAYER, agentId: 0n, mgCO2e: 1n, surcharge: 34n, methodologyHash: METHODOLOGY_HASH };
  store.insert({ ...row, paymentId: ID });
  assert.equal((await meter.health(true)).ok, true, "a fresh row does not count yet");
  store.insert({ ...row, paymentId: NONCE }, Date.now() - 60_000);
  assert.deepEqual((await meter.health(true)).reasons, ["surcharge funder balance too low"]);
  state.reads.balanceOf = 34n;
  state.reads.pricePerTonne = BigInt(FUJI.pricePerTonne) * 2n;
  assert.deepEqual((await meter.health(true)).reasons, ["pool price is above the quoted price"]);
  state.reads.pricePerTonne = BigInt(FUJI.pricePerTonne) / 2n; // cheaper is fine, the surcharge is a minimum
  assert.equal((await meter.health(true)).ok, true);
});
