// klima-retire against a mocked Klima API and a mocked Base. No network, no key, no signature.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import type { Address, Hex } from "viem";
import { type ApiResult, type ChainReceipt, type Deps, type Intent, type Json, PIN, type SignableAuth, checkPrepared, execute, plan, resume, tonnesToKg } from "../lib/klima.ts";

const BUYER = "0x00000000000000000000000000000000000000b1" as Address;
const TOKEN = "0x625df8076e4bd6e4b6196a2a7cb79fb3b19068ef" as Address;
const CLASS = "0x0008f35758a4318942ecb5d5414116ce7b1ede2d" as Address;
const TX = `0x${"ab".repeat(32)}` as Hex;
const OTHER_TX = `0x${"cd".repeat(32)}` as Hex;
const NONCE = `0x${"11".repeat(32)}` as Hex;
const FAKE_SIG = `0x${"22".repeat(65)}` as Hex; // not a signature of anything
const T0 = 1_795_000_000;
const VALUE = 87_725n;

const credit = { tokenAddress: TOKEN, tokenId: 0, registry: "UCR", vintage: 2022, creditId: "UCR-423-2022", projectKey: "UCR-423", projectName: "228 MW Bundled Wind", liquidityFormatted: "500" };
const discover = () => ({
  carbonClasses: [
    // dearer class and an undeliverable decoy credit first: neither may be picked
    { carbonClassId: "0x01", name: "Dear", priceUsdcPerTonne: "9", minRetirementTonnesFormatted: "0.001", creditsDetailed: [credit] },
    { carbonClassId: CLASS, name: "Wind", priceUsdcPerTonne: "0.05874", minRetirementTonnesFormatted: "0.001", creditsDetailed: [{ ...credit, tokenAddress: "0x00000000000000000000000000000000000000dd", creditId: "UCR-1-2020", projectKey: "UCR-1" }, credit] },
  ],
  marketplaceListings: [],
});
const quote = { tonnesFormatted: "1", retirementPriceFormatted: "0.05874", feeFormatted: "0.01", totalFormatted: "0.06874", relayExecutorGasFormatted: "0.016236", relayTotalFormatted: "0.084976" };

/** The shape prepare-auth returned on 24 Nov 2026. */
function prepared() {
  const message = { from: BUYER, to: PIN.executor, value: VALUE.toString(), validAfter: "0", validBefore: String(T0 + 900), nonce: NONCE };
  const who = { beneficiaryString: PIN.beneficiary, retiringEntityString: PIN.beneficiary, retirementMessage: PIN.message, beneficiaryAddress: BUYER, retiringAddress: BUYER };
  return {
    scheme: "eip3009",
    chainId: 8453,
    inputToken: PIN.usdc,
    spender: PIN.executor,
    authValue: VALUE.toString(),
    quote: { tonnesFormatted: "1" },
    resolvedCredit: { creditToken: TOKEN, tokenId: 0, vintage: 2022 },
    typedData: { domain: { ...PIN.domain } as Json, types: structuredClone(PIN.types) as Json, primaryType: "TransferWithAuthorization", message: message as Json },
    actionsRetireRequest: {
      action: "actions/retire", chainId: 8453, from: BUYER, inputToken: PIN.usdc, carbonClass: CLASS, amount: "1",
      creditToken: TOKEN, tokenId: "0", vintage: 2022, details: { ...who }, salt: `0x${"33".repeat(32)}`, authPayload: { ...message } as Json,
    } as Json,
    onChainDetails: { ...who, beneficiaryLocation: "" } as Json,
  };
}

const certificate = (over: Json = {}) => ({
  retirementId: `8453-${TX}-0`, retirementIndex: 0, certificateUrl: `https://app.carbonmark.com/retirements/id/8453-${TX}-0`,
  amountInTonnes: "1", beneficiaryAddress: BUYER, beneficiaryName: PIN.beneficiary, beneficiaryLocation: "", message: PIN.message,
  projectId: "UCR-423", creditId: "UCR-423-2022", retiringAddress: BUYER, timestamp: T0 + 5, ...over,
});
const minedReceipt = (over: Partial<ChainReceipt> = {}): ChainReceipt => ({
  status: "success",
  usdcLogs: [
    { address: PIN.usdc, event: "AuthorizationUsed", from: BUYER, nonce: NONCE },
    { address: PIN.usdc, event: "Transfer", from: BUYER, to: PIN.executor, value: VALUE },
    { address: PIN.usdc, event: "Transfer", from: PIN.executor, to: BUYER, value: 2_725n }, // unspent slippage comes back
  ],
  ...over,
});

/** A mock world. `retire` and `cert` answer the two calls that matter; everything else is fixed. */
function world(t: TestContext, o: { retire?: () => ApiResult; cert?: (n: number) => ApiResult; receipts?: Record<string, ChainReceipt>; prep?: Json } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "klima-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const w = {
    dir, posts: 0, signs: 0, certs: 0, signed: [] as SignableAuth[], posted: [] as Json[],
    now: T0, used: false, receipts: o.receipts ?? ({} as Record<string, ChainReceipt>), found: null as Hex | null, chainId: 8453, balance: 1_000_000n,
    intentAtPost: null as Intent | null, intentAtSign: null as Intent | null,
    deps: null as unknown as Deps,
    intent: () => JSON.parse(readFileSync(w.deps.intentFile, "utf8")) as Intent,
    lot: () => JSON.parse(readFileSync(w.deps.lotFile, "utf8")) as Json,
    sign: async (td: SignableAuth) => {
      w.signs++;
      w.signed.push(td);
      w.intentAtSign = w.intent();
      return FAKE_SIG;
    },
    buy: async (confirm = "0.1") => execute(w.deps, await plan(w.deps, BUYER, "1"), confirm, w.sign),
  };
  /** The relay got it and it is mined. */
  const settle = () => {
    w.used = true;
    w.found = TX;
    w.receipts[TX] ??= minedReceipt();
  };
  w.deps = {
    lotFile: join(dir, "avalanche-lot1.json"),
    intentFile: join(dir, "avalanche-lot1.intent.json"),
    now: () => w.now,
    sleep: async () => {},
    log: () => {},
    chain: {
      chainId: async () => w.chainId,
      head: async () => ({ number: 100n, timestamp: w.now }),
      usdcBalance: async () => w.balance,
      authorizationUsed: async () => w.used,
      findAuthorizationTx: async () => w.found,
      receipt: async (h) => w.receipts[h] ?? null,
    },
    async api(action, body) {
      if (action === "discover") return { status: 200, json: discover() };
      if (action === "quote") return { status: 200, json: quote };
      if (action === "prepare-auth") return { status: 200, json: o.prep ?? prepared() };
      if (action === "certificate") return (o.cert ?? (() => ({ status: 200, json: { retirements: [certificate()] } })))(++w.certs);
      assert.equal(action, "actions/retire");
      w.posts++;
      w.posted.push(body);
      w.intentAtPost = w.intent();
      if (o.retire) return o.retire();
      settle();
      return { status: 200, json: { status: "settled", transactionHash: TX, retirements: [certificate()] } };
    },
  };
  return { w, settle };
}
const pendingAnswer: ApiResult = { status: 200, json: { status: "pending_index", transactionHash: TX, retirementCount: 0, retirements: [] } };
const notIndexed: ApiResult = { status: 404, json: { error: "retirement_not_found" } };

test("settled: intent before signing and before POST, lot from the certificate and the chain", async (t) => {
  const { w } = world(t);
  await w.buy();
  assert.equal(w.intentAtSign?.status, "prepared");
  assert.equal(w.intentAtPost?.status, "posting");
  assert.equal(w.intentAtPost?.nonce, NONCE);
  assert.deepEqual(w.lot(), {
    registry: "UCR",
    projectId: "UCR-423",
    projectName: "228 MW Bundled Wind",
    serial: `UCR-423-2022 / 8453-${TX}-0`,
    vintage: 2022,
    certificateURI: `https://app.carbonmark.com/retirements/id/8453-${TX}-0`,
    retirementTx: `eip155:8453:${TX}`,
    quantityKg: 1000,
    creditId: "UCR-423-2022",
    retirementId: `8453-${TX}-0`,
    beneficiary: "DecarbonAI",
    paidUsdc: "0.085",
    retiredAt: new Date((T0 + 5) * 1000).toISOString(),
  });
  assert.equal(w.intent().status, "done");
  assert.equal(w.intent().txHash, TX);
  assert.equal(readFileSync(w.deps.intentFile, "utf8").includes(FAKE_SIG), false, "the signature is never written to disk");
  assert.deepEqual(readdirSync(w.dir).sort(), ["avalanche-lot1.intent.json", "avalanche-lot1.json"], "no temp files left");
});

test("signs only the pinned typed data, and posts the server's request with our signature", async (t) => {
  const { w } = world(t);
  await w.buy();
  assert.deepEqual(w.signed, [
    { domain: PIN.domain, types: PIN.types, primaryType: "TransferWithAuthorization", message: { from: BUYER, to: PIN.executor, value: VALUE, validAfter: 0n, validBefore: BigInt(T0 + 900), nonce: NONCE } },
  ]);
  assert.equal((w.posted[0].authPayload as Json).signature, FAKE_SIG);
});

test("run twice: the second run refuses before signing or posting", async (t) => {
  const { w } = world(t);
  await w.buy();
  const lot = readFileSync(w.deps.lotFile, "utf8");
  await assert.rejects(w.buy(), /already bought/);
  assert.deepEqual([w.posts, w.signs], [1, 1]);
  assert.equal(readFileSync(w.deps.lotFile, "utf8"), lot);
  await assert.rejects(resume(w.deps), /nothing to resume/);
  // lot file lost, intent still there: still no second purchase, and --resume rebuilds the file without paying
  rmSync(w.deps.lotFile);
  await assert.rejects(w.buy(), /unfinished/);
  await resume(w.deps);
  assert.equal(readFileSync(w.deps.lotFile, "utf8"), lot);
  assert.equal(w.posts, 1);
});

test("two concurrent runs: one purchase", async (t) => {
  const { w } = world(t);
  const r = await Promise.allSettled([w.buy(), w.buy()]);
  assert.deepEqual(r.map((x) => x.status).sort(), ["fulfilled", "rejected"]);
  assert.deepEqual([w.posts, w.signs], [1, 1]);
});

test("certificate 404 until indexed: keeps polling, then writes the lot", async (t) => {
  const { w, settle } = world(t, {
    retire: () => {
      settle();
      return pendingAnswer;
    },
    cert: (n) => (n < 6 ? (n % 2 ? notIndexed : { status: 503, json: {} }) : { status: 200, json: { retirements: [certificate()] } }),
  });
  await w.buy();
  assert.equal(w.certs, 6);
  assert.equal(w.lot().certificateURI, certificate().certificateUrl);
});

test("certificate never indexed: tx hash is on disk, no lot, no re-buy; --resume finishes later", async (t) => {
  let indexed = false;
  const { w, settle } = world(t, {
    retire: () => {
      settle();
      return pendingAnswer;
    },
    cert: () => (indexed ? { status: 200, json: { retirements: [certificate()] } } : notIndexed),
  });
  await assert.rejects(w.buy(), /certificate not indexed yet/);
  assert.equal(w.intent().txHash, TX);
  assert.equal(existsSync(w.deps.lotFile), false);
  await assert.rejects(w.buy(), /unfinished/);
  await assert.rejects(resume(w.deps), /certificate not indexed yet/);
  indexed = true;
  await resume(w.deps);
  assert.equal(w.lot().quantityKg, 1000);
  assert.deepEqual([w.posts, w.signs], [1, 1]);
});

test("lost response, purchase went through: no re-buy, --resume finds the tx from the nonce", async (t) => {
  const { w, settle } = world(t, {
    retire: () => {
      settle();
      throw new Error("socket hang up");
    },
  });
  await assert.rejects(w.buy(), /Do NOT buy again/);
  assert.equal(w.intent().status, "posting");
  await assert.rejects(w.buy(), /unfinished/);
  await resume(w.deps);
  assert.equal(w.lot().retirementTx, `eip155:8453:${TX}`);
  assert.deepEqual([w.posts, w.signs], [1, 1]);
});

test("lost response, purchase never happened: blocked until the authorization is safely expired, then voided", async (t) => {
  const { w } = world(t, {
    retire: () => {
      throw new Error("timeout");
    },
  });
  await assert.rejects(w.buy(), /Do NOT buy again/);
  await assert.rejects(resume(w.deps), /may still use it/);
  w.now = T0 + 901; // expired, but inside the RPC-lag margin
  await assert.rejects(resume(w.deps), /may still use it/);
  w.now = T0 + 900 + PIN.expiryMarginSec + 1;
  assert.equal(await resume(w.deps), null);
  assert.equal(existsSync(w.deps.intentFile), false);
  assert.ok(readdirSync(w.dir).some((f) => f.startsWith("avalanche-lot1.void-")), "the void intent is kept");
});

test("relay refuses (4xx, 5xx, no tx): intent stays until resolved", async (t) => {
  for (const answer of [{ status: 400, json: { error: "params_mismatch" } }, { status: 500, json: { error: "internal_error" } }, { status: 200, json: { transactionHash: "nope" } }]) {
    const { w } = world(t, { retire: () => answer });
    await assert.rejects(w.buy(), /Run --resume/);
    await assert.rejects(w.buy(), /unfinished/);
    assert.equal(w.posts, 1);
  }
});

test("relay answers an error after broadcasting: the tx hash is kept and --resume proves it", async (t) => {
  const { w, settle } = world(t, {
    retire: () => {
      settle();
      return { status: 500, json: { error: "internal_error", transactionHash: TX } };
    },
  });
  await w.buy();
  assert.equal(w.lot().quantityKg, 1000);
});

test("reverted tx: no lot; voided once the unused authorization expired", async (t) => {
  const { w } = world(t, { retire: () => pendingAnswer, receipts: { [TX]: { status: "reverted", usdcLogs: [] } } });
  await assert.rejects(w.buy(), /reverted/);
  assert.equal(existsSync(w.deps.lotFile), false);
  w.now = T0 + 900 + PIN.expiryMarginSec + 1;
  assert.equal(await resume(w.deps), null);
});

test("relay reports somebody else's tx: refused, and --resume finds ours", async (t) => {
  const { w, settle } = world(t, {
    retire: () => {
      settle();
      return { status: 200, json: { ...pendingAnswer.json, transactionHash: OTHER_TX } };
    },
    receipts: { [OTHER_TX]: minedReceipt({ usdcLogs: [{ address: PIN.usdc, event: "AuthorizationUsed", from: BUYER, nonce: `0x${"99".repeat(32)}` }] }) },
  });
  await assert.rejects(w.buy(), /did not use our authorization/);
  assert.equal(existsSync(w.deps.lotFile), false);
  await resume(w.deps);
  assert.equal(w.lot().retirementTx, `eip155:8453:${TX}`);
});

test("a look-alike token cannot fake the receipt, and an overpayment is refused", async (t) => {
  for (const [usdcLogs, why] of [
    [minedReceipt().usdcLogs.map((l) => ({ ...l, address: TOKEN })), /did not use our authorization/],
    [[...minedReceipt().usdcLogs, { address: PIN.usdc, event: "Transfer" as const, from: BUYER, to: TOKEN, value: 500_000n }], /unexpected net payment/],
    [[minedReceipt().usdcLogs[0]], /unexpected net payment/],
  ] as const) {
    const { w } = world(t, { receipts: { [TX]: { status: "success", usdcLogs: [...usdcLogs] } } });
    await assert.rejects(w.buy(), why);
    assert.equal(existsSync(w.deps.lotFile), false);
  }
});

test("a certificate for anything else is refused", async (t) => {
  const bad: [Json, RegExp][] = [
    [{ amountInTonnes: "0.999" }, /expected 1 t/],
    [{ amountInTonnes: "2" }, /expected 1 t/],
    [{ creditId: "UCR-1-2020" }, /certificate credit/],
    [{ projectId: "UCR-1" }, /certificate project/],
    [{ beneficiaryName: "test" }, /beneficiary is "test"/],
    [{ beneficiaryAddress: TOKEN }, /beneficiary address/],
    [{ message: "x" }, /message differs/],
    [{ retirementId: `8453-${OTHER_TX}-0` }, /another transaction/],
    [{ certificateUrl: "" }, /certificate URL/],
    [{ certificateUrl: "http://app.carbonmark.com/x" }, /certificate URL/],
    [{ certificateUrl: "https://app.carbonmark.com.evil.example/x" }, /certificate URL/],
  ];
  for (const [over, why] of bad) {
    const { w, settle } = world(t, {
      retire: () => {
        settle();
        return pendingAnswer;
      },
      cert: () => ({ status: 200, json: { retirements: [certificate(over)] } }),
    });
    await assert.rejects(w.buy(), why, JSON.stringify(over));
    assert.equal(existsSync(w.deps.lotFile), false);
    await assert.rejects(w.buy(), /unfinished/);
  }
  const { w } = world(t, {
    retire: () => ({ status: 200, json: { transactionHash: TX, retirements: [certificate(), certificate()] } }),
    receipts: { [TX]: minedReceipt() },
  });
  await assert.rejects(w.buy(), /exactly one retirement/);
});

test("tampered prepare-auth: refused before anything is signed, written or posted", async (t) => {
  type P = ReturnType<typeof prepared>;
  const evil = "0x000000000000000000000000000000000000bad0";
  const both = (p: P, k: string, v: unknown) => {
    p.typedData.message[k] = v;
    (p.actionsRetireRequest.authPayload as Json)[k] = v;
  };
  const cases: Record<string, (p: P) => void> = {
    "domain name": (p) => { p.typedData.domain.name = "USDC"; },
    "domain version": (p) => { p.typedData.domain.version = "1"; },
    "domain chain": (p) => { p.typedData.domain.chainId = 1; },
    "domain contract": (p) => { p.typedData.domain.verifyingContract = evil; },
    "domain salt": (p) => { p.typedData.domain.salt = "0x00"; },
    "primary type": (p) => { p.typedData.primaryType = "Permit"; },
    "extra type": (p) => { p.typedData.types.Permit = []; },
    "type field order": (p) => { (p.typedData.types.TransferWithAuthorization as unknown[]).reverse(); },
    "receive instead of transfer": (p) => {
      p.typedData.primaryType = "ReceiveWithAuthorization";
      p.typedData.types = { ReceiveWithAuthorization: PIN.types.TransferWithAuthorization };
    },
    from: (p) => both(p, "from", evil),
    "to (executor)": (p) => both(p, "to", evil),
    spender: (p) => { p.spender = evil as Address; },
    "value above the cap": (p) => {
      both(p, "value", (PIN.maxUsdcUnits + 1n).toString());
      p.authValue = (PIN.maxUsdcUnits + 1n).toString();
    },
    "value vs authValue": (p) => { p.authValue = "1"; },
    "zero value": (p) => { both(p, "value", "0"); p.authValue = "0"; },
    "hex value": (p) => { both(p, "value", "0xff"); p.authValue = "0xff"; },
    "expiry too far": (p) => both(p, "validBefore", String(T0 + 90_000)),
    "already expired": (p) => both(p, "validBefore", String(T0)),
    validAfter: (p) => both(p, "validAfter", "1"),
    nonce: (p) => both(p, "nonce", "0x01"),
    "extra message field": (p) => { p.typedData.message.spender = evil; },
    "authPayload differs": (p) => { (p.actionsRetireRequest.authPayload as Json).to = evil; },
    "request chain": (p) => { p.actionsRetireRequest.chainId = 84532; },
    "request action": (p) => { p.actionsRetireRequest.action = "other"; },
    "request amount": (p) => { p.actionsRetireRequest.amount = "0.1"; },
    "request supply": (p) => { p.actionsRetireRequest.carbonClass = evil; },
    "request credit": (p) => { p.actionsRetireRequest.creditToken = evil; },
    "request vintage": (p) => { p.actionsRetireRequest.vintage = 2010; },
    "request extra field": (p) => { p.actionsRetireRequest.recipient = evil; },
    "quoted tonnes": (p) => { p.quote.tonnesFormatted = "0.1"; },
    "beneficiary name": (p) => { (p.actionsRetireRequest.details as Json).beneficiaryString = "Evil"; },
    "beneficiary on chain": (p) => { p.onChainDetails.beneficiaryAddress = evil; },
    "message on chain": (p) => { p.onChainDetails.retirementMessage = ""; },
    "undiscovered credit": (p) => {
      p.resolvedCredit.creditToken = evil as Address;
      p.actionsRetireRequest.creditToken = evil;
    },
    "resolved vintage": (p) => { p.resolvedCredit.vintage = 2010; p.actionsRetireRequest.vintage = 2010; },
    "missing typed data": (p) => { (p as Json).typedData = undefined; },
    scheme: (p) => { p.scheme = "eip2612"; },
  };
  for (const [name, tamper] of Object.entries(cases)) {
    const prep = prepared();
    tamper(prep);
    const { w } = world(t, { prep });
    await assert.rejects(w.buy(), /refusing/, name);
    assert.deepEqual([w.signs, w.posts, readdirSync(w.dir).length], [0, 0, 0], name);
  }
  checkPrepared(prepared(), { buyer: BUYER, tonnes: "1", supply: { carbonClass: CLASS }, now: T0 }); // untampered passes
});

test("money guards: ceiling, balance, chain, nonce", async (t) => {
  const { w } = world(t);
  await assert.rejects(execute(w.deps, await plan(w.deps, BUYER, "1"), undefined, w.sign), /--confirm-usd/);
  await assert.rejects(w.buy("0.08"), /above --confirm-usd/);
  await assert.rejects(w.buy("1e3"), /--confirm-usd/);
  w.balance = 1n;
  await assert.rejects(w.buy(), /enough USDC/);
  w.balance = 1_000_000n;
  w.chainId = 43114;
  await assert.rejects(w.buy(), /not Base/);
  w.chainId = 8453;
  w.used = true;
  await assert.rejects(w.buy(), /already used/);
  assert.deepEqual([w.signs, w.posts, readdirSync(w.dir).length], [0, 0, 0]);
});

test("signing failure: nothing was sent, the intent is voided and a new run may proceed", async (t) => {
  const { w } = world(t);
  await assert.rejects(
    execute(w.deps, await plan(w.deps, BUYER, "1"), "0.1", async () => {
      throw new Error("signer unavailable");
    }),
    /signer unavailable/,
  );
  assert.equal(w.posts, 0);
  await w.buy();
  assert.equal(w.posts, 1);
});

test("a stray lot or intent file alone blocks the purchase", async (t) => {
  for (const f of ["lotFile", "intentFile"] as const) {
    const { w } = world(t);
    writeFileSync(w.deps[f], "{}");
    await assert.rejects(w.buy(), /exists/);
    assert.equal(w.signs, 0);
  }
});

test("tonnesToKg is exact", () => {
  assert.equal(tonnesToKg("1"), 1000);
  assert.equal(tonnesToKg("1.000000000000000000"), 1000);
  assert.equal(tonnesToKg("0.001"), 1);
  for (const bad of ["0.0001", "0", "-1", "1e3", "1.0001", "", "1,5"]) assert.throws(() => tonnesToKg(bad), bad);
});
