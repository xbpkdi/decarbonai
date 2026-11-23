import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { FUJI } from "@decarbonai/chain";
import { type RpcState, rpcMock } from "../../../packages/x402-carbon/test/rpc-mock.ts";
import { createApp } from "../src/app.ts";
import { accrualDbPath, foreignSecrets } from "../src/env.ts";

const KEY = `0x${"01".repeat(32)}` as Hex; // dummy
const METER = privateKeyToAccount(KEY).address;
const SAFE = "0x00000000000000000000000000000000000000fe" as Address;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;

// ---------------------------------------------------------------- blocker 2: the API's environment

const server = fileURLToPath(new URL("../src/server.ts", import.meta.url));
function start(env: Record<string, string>): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ["--no-warnings=ExperimentalWarning", server], { env: { PATH: process.env.PATH, ...env } });
    let out = "";
    p.stdout.on("data", (d) => {
      out += d;
    });
    p.stderr.on("data", (d) => {
      out += d;
    });
    p.on("close", (code) => resolve({ code, out }));
  });
}
const ok = { METER_PRIVATE_KEY: KEY, PAY_TO_ADDRESS: SAFE };

test("server exits if any other private key is in its environment, and never prints one", async () => {
  const secret = `0x${"ab".repeat(32)}`;
  const { code, out } = await start({ ...ok, MAINNET_PRIVATE_KEY: secret });
  assert.equal(code, 1);
  assert.match(out, /Refusing to start.*MAINNET_PRIVATE_KEY/);
  assert.equal(out.includes(secret) || out.includes(KEY), false);
  // the rest without a process each
  for (const name of ["MAINNET_METER_PRIVATE_KEY", "PAY_TO_PRIVATE_KEY", "BASE_BUYER_PRIVATE_KEY", "FUJI_PRIVATE_KEY", "AGENT_PRIVATE_KEY", "PRIVATE_KEY", "deployer_private_key", "MNEMONIC"]) {
    assert.deepEqual(foreignSecrets({ ...ok, [name]: secret }), [name]);
  }
});

test("server needs its meter key and payTo: no fallback", async () => {
  assert.equal((await start({ PAY_TO_ADDRESS: SAFE })).code, 1);
  assert.equal((await start({ METER_PRIVATE_KEY: KEY })).code, 1);
});

test("the API's start script never loads the root .env", async () => {
  const { default: pkg } = await import("../package.json", { with: { type: "json" } });
  assert.equal(pkg.scripts.start.includes(".."), false);
});

test("foreignSecrets ignores its own key and blanks", () => {
  assert.deepEqual(foreignSecrets({ ...ok, MAINNET_PRIVATE_KEY: "", AGENT_PRIVATE_KEY: "  ", FUJI_RPC_URL: "x" }), []);
});

// ---------------------------------------------------------------- blocker 3: one DB per chain + pool

test("accrual DB: per chain and pool by default, blank means unset, relative is refused", () => {
  const fuji = accrualDbPath(FUJI, undefined);
  const main = accrualDbPath({ ...FUJI, chainId: 43114 }, undefined);
  const oldPool = accrualDbPath({ ...FUJI, retirementPool: SAFE }, undefined);
  assert.equal(new Set([fuji, main, oldPool]).size, 3);
  assert.match(fuji, /apps\/paid-api\/\.data\/accruals-43113-0x[0-9a-f]{40}\.sqlite$/);
  assert.equal(accrualDbPath(FUJI, ""), fuji);
  assert.equal(accrualDbPath(FUJI, "  "), fuji);
  assert.equal(accrualDbPath(FUJI, "/data/x.sqlite"), "/data/x.sqlite");
  assert.throws(() => accrualDbPath(FUJI, ".data/x.sqlite"), /absolute/);
});

test("the app refuses a DB of another chain", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "api-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cfg = { meterKey: KEY, payTo: SAFE, dbPath: join(dir, "q.sqlite") };
  createApp({ ...cfg, deployment: FUJI }).store.close();
  assert.throws(() => createApp({ ...cfg, deployment: { ...FUJI, chainId: 43114 } }), /belongs to 43113/);
});

// ---------------------------------------------------------------- S5: preflight

const ROLE = { METER_ROLE: `0x${"01".repeat(32)}`, TREASURY_ROLE: `0x${"02".repeat(32)}`, PAUSER_ROLE: `0x${"03".repeat(32)}` };
async function api(t: TestContext, reads: RpcState["reads"] = {}, state: Partial<RpcState> = {}, facilitatorUrl?: string) {
  const rpcState: RpcState = {
    chainId: 43113, blockNumber: 100n, timestamp: Math.floor(Date.now() / 1000), balance: 10n ** 18n, logs: [], receipts: {}, ...state,
    reads: {
      ...ROLE, defaultAdmin: SAFE, pendingDefaultAdmin: [ZERO, 0], surchargeFunder: FUJI.payTo, owner: SAFE, pendingOwner: ZERO,
      hasRole: ([role, who]: readonly unknown[]) => role === ROLE.METER_ROLE && who === METER,
      thresholdMg: 1_000_000n, maxRetirementsPerCall: 5, paused: false, pricePerTonne: BigInt(FUJI.pricePerTonne),
      methodology: { active: true, version: "v" }, allowance: 25_000_000n, balanceOf: 1_000_000n, authorizationState: true, ...reads,
    },
  };
  const rpc = await rpcMock(rpcState);
  t.after(() => rpc.close());
  return { ...createApp({ meterKey: KEY, payTo: FUJI.payTo, dbPath: ":memory:", rpcUrl: rpc.url, deployment: FUJI, facilitatorUrl }), rpcState };
}

test("preflight accepts a METER_ROLE-only key", async (t) => {
  await (await api(t)).preflight();
});

test("preflight refuses a key that can do more, the wrong payTo or the wrong chain", async (t) => {
  const can = (name: keyof typeof ROLE) => ({ hasRole: ([role]: readonly unknown[]) => role === ROLE.METER_ROLE || role === ROLE[name] });
  const cases: [RpcState["reads"], RegExp, Partial<RpcState>?][] = [
    [can("TREASURY_ROLE"), /admin\/treasury\/pauser/],
    [can("PAUSER_ROLE"), /admin\/treasury\/pauser/],
    [{ defaultAdmin: METER }, /admin\/treasury\/pauser/],
    [{ pendingDefaultAdmin: [METER, 1] }, /admin\/treasury\/pauser/],
    [{ [`${FUJI.dco2.toLowerCase()}.owner`]: METER }, /owns DCO2/],
    [{ [`${FUJI.carbonReceipt.toLowerCase()}.owner`]: METER }, /owns CarbonReceipt/],
    [{ [`${FUJI.reputationAdapter.toLowerCase()}.owner`]: METER }, /owns ERC8004ReputationAdapter/],
    [{ [`${FUJI.dco2.toLowerCase()}.pendingOwner`]: METER }, /owns DCO2/],
    [{ hasRole: false }, /lacks METER_ROLE/],
    [{ surchargeFunder: SAFE }, /surchargeFunder/],
    [{}, /RPC is chain 43114/, { chainId: 43114 }],
  ];
  for (const [reads, why, state] of cases) await assert.rejects((await api(t, reads, state)).preflight(), why);
});

// ---------------------------------------------------------------- S1: the whole paid route

async function facilitator(t: TestContext, settle: (body: { paymentPayload: unknown }) => unknown) {
  const f = { settles: 0, url: "" };
  const srv = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => {
      body += d;
    });
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url?.endsWith("/supported")) return res.end(JSON.stringify({ kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:43113" }], extensions: [], signers: {} }));
      if (req.url?.endsWith("/verify")) return res.end(JSON.stringify({ isValid: true, payer: SAFE }));
      f.settles++;
      const answer = settle(JSON.parse(body));
      if (answer === undefined) return req.socket.destroy(); // response lost
      res.end(JSON.stringify(answer));
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  t.after(() => srv.close());
  f.url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  return f;
}
/** A 402, then the same request with a payment payload the (mock) facilitator accepts. Nothing is signed. */
async function payOnce(app: Awaited<ReturnType<typeof api>>["app"]) {
  const url = "http://x/v1/infer?model=claude-sonnet&maxOutputTokens=200";
  const challenge = await app.request(url);
  assert.equal(challenge.status, 402);
  const required = JSON.parse(Buffer.from(challenge.headers.get("payment-required")!, "base64").toString());
  const accepted = required.accepts[0];
  const authorization = {
    from: SAFE, to: accepted.payTo, value: accepted.amount, validAfter: "0", validBefore: String(Math.floor(Date.now() / 1000) + 100), nonce: `0x${"44".repeat(32)}`,
  };
  const payment = { x402Version: 2, resource: required.resource, accepted, payload: { signature: `0x${"00".repeat(65)}`, authorization } };
  return app.request(url, { headers: { "payment-signature": Buffer.from(JSON.stringify(payment)).toString("base64") } });
}
const TX = `0x${"ab".repeat(32)}`;

test("paid call: intent before settle, accrual after, 200", async (t) => {
  const seen: number[] = [];
  let a: Awaited<ReturnType<typeof api>>;
  const f = await facilitator(t, () => {
    seen.push(a.store.intents().length);
    return { success: true, transaction: TX, network: "eip155:43113", payer: SAFE };
  });
  a = await api(t, {}, {}, f.url);
  const res = await payOnce(a.app);
  assert.equal(res.status, 200, await res.text());
  assert.deepEqual(seen, [1]);
  assert.equal(a.store.intents().length, 0);
  assert.equal(a.store.counts().pending.n, 1);
});

test("settle response lost: the agent gets no 200, but the intent is on disk", async (t) => {
  const f = await facilitator(t, () => undefined);
  const a = await api(t, {}, {}, f.url);
  const res = await payOnce(a.app);
  assert.notEqual(res.status, 200);
  assert.equal(f.settles > 0, true);
  const [i] = a.store.intents();
  assert.equal(i.payer, SAFE);
  assert.equal(i.payTo, FUJI.payTo.toLowerCase());
  assert.equal(i.amount > 10_000n, true);
});

test("intent cannot be written: the facilitator is never called, so nobody is charged", async (t) => {
  const f = await facilitator(t, () => ({ success: true, transaction: TX, network: "eip155:43113", payer: SAFE }));
  const a = await api(t, {}, {}, f.url);
  a.store.insertIntent = () => {
    throw new Error("disk full");
  };
  const res = await payOnce(a.app);
  assert.notEqual(res.status, 200);
  assert.equal(f.settles, 0);
});

test("accrual cannot be written after settling: the intent survives for the resolver", async (t) => {
  const f = await facilitator(t, () => ({ success: true, transaction: TX, network: "eip155:43113", payer: SAFE }));
  const a = await api(t, {}, {}, f.url);
  a.store.insert = () => {
    throw new Error("disk full");
  };
  await payOnce(a.app);
  assert.equal(a.store.intents().length, 1);
});
