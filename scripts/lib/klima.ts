// Core of scripts/klima-retire.ts, with every side effect injected so it can be tested without a network,
// a key or a signature. Rules (pre-mainnet review, blocker 1):
//  - the buyer signs a typed-data object rebuilt here from pinned constants, never the server's copy;
//  - the intent (nonce, expiry, credit) is on disk before anything is signed or sent, and the tx hash right
//    after the answer, so a crash or a lost response can always be resolved with --resume;
//  - one intent or lot file blocks another purchase; the lot file is written only from a certificate that
//    matches the request, backed by a successful Base tx that used exactly our authorization.
import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Address, type Hex, formatUnits, parseUnits } from "viem";

/** Everything the buyer is willing to sign for. Nothing here comes from the server. */
export const PIN = {
  chainId: 8453,
  usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address,
  // Klima settlement contract (verified proxy; its aggregator() is Klima's published Retirement Aggregator
  // 0xda0a793d7c32ab80bcdab7f8c725c96db22464f4, checked on Base 24 Nov 2026).
  executor: "0x290e98e95dacE244c73376C0c39A4D53b22E34B6" as Address,
  maxUsdcUnits: 650_000n, // $0.65 hard cap, above the Verra comparison ($0.59) and below the $1 wallet
  ttlSec: 900,
  expiryMarginSec: 300,
  domain: { name: "USD Coin", version: "2", chainId: 8453, verifyingContract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address },
  types: {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  },
  beneficiary: "DecarbonAI",
  message: "DecarbonAI custodial bridge v0: backs DCO2 lot 1 on Avalanche C-Chain (carbon-metered x402)",
  certificateHost: "app.carbonmark.com",
} as const;

export type Json = Record<string, unknown>;
export type ApiResult = { status: number; json: Json };
export type TokenLog = { address: Address; event: "Transfer" | "AuthorizationUsed"; from: Address; to?: Address; value?: bigint; nonce?: Hex };
export type ChainReceipt = { status: "success" | "reverted"; usdcLogs: TokenLog[] };

/** Read-only view of Base. */
export type Chain = {
  chainId(): Promise<number>;
  head(): Promise<{ number: bigint; timestamp: number }>;
  usdcBalance(owner: Address): Promise<bigint>;
  authorizationUsed(authorizer: Address, nonce: Hex): Promise<boolean>;
  findAuthorizationTx(authorizer: Address, nonce: Hex, fromBlock: bigint, toBlock: bigint): Promise<Hex | null>;
  receipt(hash: Hex): Promise<ChainReceipt | null>;
};

export type AuthMessage = { from: Address; to: Address; value: bigint; validAfter: bigint; validBefore: bigint; nonce: Hex };
export type SignableAuth = { domain: typeof PIN.domain; types: typeof PIN.types; primaryType: "TransferWithAuthorization"; message: AuthMessage };

export type Deps = {
  /** POST { action, ...body }. Resolves for any JSON answer (any status), rejects if the outcome is unknown. */
  api(action: string, body: Json): Promise<ApiResult>;
  chain: Chain;
  now(): number; // unix seconds
  sleep(ms: number): Promise<void>;
  log(line: string): void;
  lotFile: string;
  intentFile: string;
};

export type Credit = { creditToken: Address; tokenId: string; registry: string; projectId: string; projectName: string; creditId: string; vintage: number };

export type Plan = { buyer: Address; tonnes: string; kg: number; listingId?: Hex; credit: Credit; auth: AuthMessage; request: Json };

export type Intent = {
  // prepared: written, nothing sent. posting: signature may have left this machine. sent: tx hash known.
  // done: lot file written. A void intent is renamed away, so any intent file still here blocks a purchase.
  status: "prepared" | "posting" | "sent" | "done";
  createdAt: string;
  buyer: Address;
  executor: Address;
  value: string;
  validBefore: string;
  nonce: Hex;
  startBlock: string;
  tonnes: string;
  kg: number;
  credit: Credit;
  txHash: Hex | null;
  lastAnswer: string | null;
};

const HASH = /^0x[0-9a-fA-F]{64}$/;
const eq = (a: unknown, b: unknown) => String(a).toLowerCase() === String(b).toLowerCase();
const must = (ok: unknown, what: string): void => {
  if (!ok) throw new Error(`refusing: ${what}`);
};
const sameKeys = (o: unknown, keys: string[]) =>
  !!o && typeof o === "object" && JSON.stringify(Object.keys(o).sort()) === JSON.stringify([...keys].sort());

/** Tonnes as an exact decimal string -> whole kg. */
export function tonnesToKg(t: string): number {
  if (!/^\d{1,9}(\.\d{1,18})?$/.test(t)) throw new Error(`bad tonne amount ${JSON.stringify(t)}`);
  const atomic = parseUnits(t, 18);
  const kg = atomic / 10n ** 15n;
  if (kg === 0n || kg * 10n ** 15n !== atomic) throw new Error(`${t} t is not a whole number of kg`);
  return Number(kg);
}

function parseVintage(v: unknown): number {
  const y = Number(String(v).slice(0, 4));
  must(Number.isInteger(y) && y >= 1990 && y <= 2100, `bad vintage ${String(v)}`);
  return y;
}

// ------------------------------------------------------------------ files

function writeDurable(path: string, data: string, exclusive: boolean) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  const fd = openSync(tmp, "w", 0o600);
  try {
    writeSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (exclusive) {
    // link() fails if `path` exists, and never leaves a half-written file behind
    try {
      linkSync(tmp, path);
    } finally {
      unlinkSync(tmp);
    }
  } else renameSync(tmp, path);
  const dir = openSync(dirname(path), "r");
  try {
    fsyncSync(dir);
  } finally {
    closeSync(dir);
  }
}
const dump = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
const saveIntent = (deps: Deps, intent: Intent) => writeDurable(deps.intentFile, dump(intent), false);
const readIntent = (deps: Deps) => JSON.parse(readFileSync(deps.intentFile, "utf8")) as Intent;

function voidIntent(deps: Deps, intent: Intent, why: string) {
  const to = join(dirname(deps.intentFile), `avalanche-lot1.void-${intent.nonce.slice(2, 10)}.json`);
  renameSync(deps.intentFile, to);
  deps.log(`intent voided (${why}); kept as ${to}`);
}

/** Throws if a purchase already exists or may still be in flight. */
export function assertNoPurchase(deps: Pick<Deps, "lotFile" | "intentFile">) {
  must(!existsSync(deps.lotFile), `${deps.lotFile} exists: lot 1 is already bought`);
  must(!existsSync(deps.intentFile), `${deps.intentFile} exists: a purchase is unfinished, run --resume`);
}

// ------------------------------------------------------------------ quote + prepare

type RawCredit = { tokenAddress?: Address; creditToken?: Address; tokenId: number | string; registry: string; vintage: number | string; creditId: string; projectKey: string; projectName: string; liquidityFormatted?: string };
type Klass = { carbonClassId: Hex; name: string; priceUsdcPerTonne: string; minRetirementTonnesFormatted: string; creditsDetailed: RawCredit[] };
type Listing = RawCredit & { listingId: Hex; priceUsdcPerTonne: string; leftToSellFormatted: string; minFillFormatted: string };

async function read(deps: Deps, action: string, body: Json = {}): Promise<Json> {
  const r = await deps.api(action, body);
  if (r.status !== 200) throw new Error(`${action} ${r.status}: ${JSON.stringify(r.json).slice(0, 600)}`);
  return r.json;
}

const toCredit = (c: RawCredit): Credit => ({
  creditToken: (c.tokenAddress ?? c.creditToken) as Address,
  tokenId: String(c.tokenId),
  registry: c.registry,
  projectId: c.projectKey,
  projectName: c.projectName,
  creditId: c.creditId,
  vintage: parseVintage(c.vintage),
});

/** Free: discover + quote + prepare-auth. Moves no funds. Returns a fully checked plan. */
export async function plan(deps: Deps, buyer: Address, tonnes: string, listingId?: Hex): Promise<Plan> {
  const kg = tonnesToKg(tonnes);
  const want = Number(tonnes);
  const d = (await read(deps, "discover")) as { carbonClasses: Klass[]; marketplaceListings: Listing[] };
  const klass = d.carbonClasses
    .filter((k) => Number(k.minRetirementTonnesFormatted) <= want)
    .filter((k) => k.creditsDetailed.some((c) => Number(c.liquidityFormatted ?? 0) >= want))
    .sort((a, b) => Number(a.priceUsdcPerTonne) - Number(b.priceUsdcPerTonne))[0];
  const verra = d.marketplaceListings
    .filter((l) => l.registry === "VCS" && Number(l.leftToSellFormatted) >= want && Number(l.minFillFormatted) <= want)
    .sort((a, b) => Number(a.priceUsdcPerTonne) - Number(b.priceUsdcPerTonne))[0];
  const listing = listingId ? d.marketplaceListings.find((l) => eq(l.listingId, listingId)) : undefined;
  if (listingId) must(listing, "unknown --listing");
  else must(klass, `no liquid protocol class for ${tonnes} t`);

  const base = { chainId: PIN.chainId, inputToken: PIN.usdc, amount: tonnes };
  const show = (label: string, q: Json) =>
    deps.log(
      `${label}, ${q.tonnesFormatted} t\n  credit ${q.retirementPriceFormatted} + fee ${q.feeFormatted} = ${q.totalFormatted} USDC; ` +
        `relayed (incl. executor gas ${q.relayExecutorGasFormatted}) = ${q.relayTotalFormatted} USDC`,
    );
  if (klass) show(`cheapest protocol class: ${klass.name}`, await read(deps, "quote", { ...base, carbonClass: klass.carbonClassId }));
  if (verra) show(`Verra comparison: ${verra.projectKey} "${verra.projectName}" vintage ${verra.vintage}`, await read(deps, "quote", { ...base, listingId: verra.listingId }));

  const supply: Json = listing ? { listingId: listing.listingId } : { carbonClass: klass.carbonClassId };
  const candidates = listing ? [listing] : klass.creditsDetailed;
  const prep = await read(deps, "prepare-auth", {
    ...base,
    ...supply,
    from: buyer,
    beneficiaryIsPayer: true,
    timeToLiveSeconds: PIN.ttlSec,
    details: { beneficiaryString: PIN.beneficiary, retiringEntityString: PIN.beneficiary, retirementMessage: PIN.message },
  });
  const { auth, request, resolved } = checkPrepared(prep, { buyer, tonnes, supply, now: deps.now() });
  // The credit we pay for must be one we discovered: no fallback to "the first one".
  const raw = candidates.find((c) => eq(c.tokenAddress ?? c.creditToken, resolved.creditToken) && String(c.tokenId) === resolved.tokenId);
  if (!raw) throw new Error(`refusing: resolved credit ${resolved.creditToken}#${resolved.tokenId} is not in discover`);
  const credit = toCredit(raw);
  must(credit.registry && credit.projectId && credit.projectName && credit.creditId, "credit metadata is incomplete");
  if (resolved.vintage !== null) must(parseVintage(resolved.vintage) === credit.vintage, "resolved vintage differs from the discovered credit");
  return { buyer, tonnes, kg, listingId: listing?.listingId, credit, auth, request };
}

/** Check a prepare-auth answer against the pinned constants and the request. Pure; throws on any deviation. */
export function checkPrepared(prep: Json, want: { buyer: Address; tonnes: string; supply: Json; now: number }) {
  const td = prep.typedData as { domain: Json; types: Json; primaryType: string; message: Json } | undefined;
  const req = prep.actionsRetireRequest as Json | undefined;
  const resolved = prep.resolvedCredit as { creditToken: Address; tokenId: number | string; vintage: number | null } | undefined;
  const onChain = prep.onChainDetails as Json | undefined;
  if (!td || !req || !resolved || !onChain) throw new Error("refusing: incomplete prepare-auth answer");

  must(prep.scheme === "eip3009" && prep.chainId === PIN.chainId, "wrong scheme or chain");
  must(eq(prep.inputToken, PIN.usdc) && eq(prep.spender, PIN.executor), "wrong input token or spender");

  // domain, types, primary type: exactly EIP-3009 USDC on Base
  must(sameKeys(td.domain, Object.keys(PIN.domain)), "unexpected EIP-712 domain fields");
  must(td.domain.name === PIN.domain.name && td.domain.version === PIN.domain.version, "wrong EIP-712 domain name/version");
  must(td.domain.chainId === PIN.chainId && eq(td.domain.verifyingContract, PIN.usdc), "wrong EIP-712 chain or contract");
  must(td.primaryType === "TransferWithAuthorization", `unexpected primary type ${td.primaryType}`);
  must(JSON.stringify(td.types) === JSON.stringify(PIN.types), "unexpected EIP-712 types");

  // message
  const m = td.message;
  must(sameKeys(m, ["from", "to", "value", "validAfter", "validBefore", "nonce"]), "unexpected message fields");
  must(eq(m.from, want.buyer), "authorization is not from the buyer");
  must(eq(m.to, PIN.executor), "authorization does not pay the pinned executor");
  must(/^\d{1,18}$/.test(String(m.value)) && BigInt(m.value as string) > 0n, "bad authorization value");
  const value = BigInt(m.value as string);
  must(value <= PIN.maxUsdcUnits, `authorization ${formatUnits(value, 6)} USDC is above the ${formatUnits(PIN.maxUsdcUnits, 6)} cap`);
  must(String(prep.authValue) === value.toString(), "authValue does not match the message");
  must(String(m.validAfter) === "0", "unexpected validAfter");
  must(/^\d{1,12}$/.test(String(m.validBefore)), "bad expiry");
  const validBefore = Number(m.validBefore);
  must(validBefore > want.now + 60 && validBefore <= want.now + PIN.ttlSec + 120, "authorization expiry is out of range");
  must(HASH.test(String(m.nonce)), "bad nonce");

  // the request body we post back (the server re-derives the nonce from it)
  const supplyKey = Object.keys(want.supply)[0];
  const allowed = ["action", "chainId", "from", "inputToken", supplyKey, "amount", "creditToken", "tokenId", "vintage", "details", "salt", "authPayload"];
  const extra = Object.keys(req).filter((k) => !allowed.includes(k));
  must(extra.length === 0, `unexpected request fields ${extra.join(", ")}`);
  must(req.action === "actions/retire" && req.chainId === PIN.chainId, "wrong request action or chain");
  must(eq(req.from, want.buyer) && eq(req.inputToken, PIN.usdc), "wrong request payer or token");
  must(eq(req[supplyKey], want.supply[supplyKey]) && req.amount === want.tonnes, "wrong request supply or amount");
  must(eq(req.creditToken, resolved.creditToken) && String(req.tokenId) === String(resolved.tokenId), "request credit differs from the resolved credit");
  must(req.vintage == null || req.vintage === resolved.vintage, "request vintage differs from the resolved credit");
  must(HASH.test(String(req.salt)), "bad salt");
  const ap = req.authPayload as Json;
  must(sameKeys(ap, Object.keys(m)) && Object.keys(m).every((k) => eq(ap[k], m[k])), "authPayload differs from the message");

  // who is credited
  const quote = prep.quote as Json | undefined;
  must(quote?.tonnesFormatted === want.tonnes, "quoted tonnes differ from the request");
  for (const [label, det] of [["details", req.details as Json], ["onChainDetails", onChain]] as const) {
    must(det && det.beneficiaryString === PIN.beneficiary && det.retiringEntityString === PIN.beneficiary, `${label}: wrong beneficiary name`);
    must(det.retirementMessage === PIN.message, `${label}: wrong retirement message`);
    must(eq(det.beneficiaryAddress, want.buyer) && eq(det.retiringAddress, want.buyer), `${label}: wrong beneficiary address`);
  }

  const auth: AuthMessage = { from: want.buyer, to: PIN.executor, value, validAfter: 0n, validBefore: BigInt(validBefore), nonce: m.nonce as Hex };
  return { auth, request: req, resolved: { creditToken: resolved.creditToken, tokenId: String(resolved.tokenId), vintage: resolved.vintage } };
}

export const signable = (auth: AuthMessage): SignableAuth => ({ domain: PIN.domain, types: PIN.types, primaryType: "TransferWithAuthorization", message: auth });

// ------------------------------------------------------------------ buy

/**
 * Sign and relay. `confirmUsd` is the most the owner agreed to pay: the live authorization moves with gas
 * from one second to the next, so it is a ceiling, not an exact match.
 */
export async function execute(deps: Deps, p: Plan, confirmUsd: string | undefined, sign: (td: SignableAuth) => Promise<Hex>) {
  assertNoPurchase(deps);
  must(confirmUsd && /^\d{1,3}(\.\d{1,6})?$/.test(confirmUsd), "--confirm-usd <max USDC> is required");
  must(p.auth.value <= parseUnits(confirmUsd as string, 6), `authorization ${formatUnits(p.auth.value, 6)} USDC is above --confirm-usd ${confirmUsd}`);
  must(p.auth.value <= PIN.maxUsdcUnits, "authorization is above the hard cap");
  must((await deps.chain.chainId()) === PIN.chainId, "BASE_RPC_URL is not Base");
  must((await deps.chain.usdcBalance(p.buyer)) >= p.auth.value, "buyer does not hold enough USDC");
  must(!(await deps.chain.authorizationUsed(p.buyer, p.auth.nonce)), "authorization nonce is already used");
  const head = await deps.chain.head();
  must(Number(p.auth.validBefore) > deps.now() + 60, "authorization is about to expire, run again");

  const intent: Intent = {
    status: "prepared",
    createdAt: new Date(deps.now() * 1000).toISOString(),
    buyer: p.buyer,
    executor: PIN.executor,
    value: p.auth.value.toString(),
    validBefore: p.auth.validBefore.toString(),
    nonce: p.auth.nonce,
    startBlock: head.number.toString(),
    tonnes: p.tonnes,
    kg: p.kg,
    credit: p.credit,
    txHash: null,
    lastAnswer: null,
  };
  writeDurable(deps.intentFile, dump(intent), true); // exclusive: a concurrent run loses here, before signing
  let signature: Hex;
  try {
    signature = await sign(signable(p.auth));
  } catch (e) {
    voidIntent(deps, intent, "signing failed, nothing was sent");
    throw e;
  }
  intent.status = "posting";
  saveIntent(deps, intent);

  let answer: ApiResult;
  try {
    answer = await deps.api("actions/retire", { ...p.request, authPayload: { ...(p.request.authPayload as Json), signature } });
  } catch (e) {
    intent.lastAnswer = `no answer: ${e instanceof Error ? e.message : "unknown"}`.slice(0, 300);
    saveIntent(deps, intent);
    throw new Error("the relay's answer was lost: the purchase may or may not have happened. Do NOT buy again. Run --resume.");
  }
  intent.lastAnswer = `${answer.status} ${JSON.stringify(answer.json)}`.slice(0, 2000);
  const tx = answer.json.transactionHash ?? answer.json.txHash;
  if (HASH.test(String(tx))) {
    intent.txHash = String(tx).toLowerCase() as Hex;
    intent.status = "sent";
  }
  saveIntent(deps, intent);
  if (!intent.txHash) throw new Error(`relay answered ${answer.status} without a tx: ${JSON.stringify(answer.json).slice(0, 400)}. Run --resume.`);
  deps.log(`tx: https://basescan.org/tx/${intent.txHash}`);
  return finish(deps, intent, answer.status === 200 ? answer.json : undefined);
}

// ------------------------------------------------------------------ prove

type Cert = { retirementId: string; certificateUrl: string; amountInTonnes: string; beneficiaryAddress: string; beneficiaryName: string; message: string; projectId: string; creditId: string; timestamp: number };

async function waitReceipt(deps: Deps, hash: Hex): Promise<ChainReceipt | null> {
  for (let i = 0; i < 30; i++) {
    const r = await deps.chain.receipt(hash).catch(() => null);
    if (r) return r;
    await deps.sleep(2000);
  }
  return null;
}

const usedOurAuthorization = (intent: Intent, r: ChainReceipt) =>
  r.usdcLogs.some((l) => eq(l.address, PIN.usdc) && l.event === "AuthorizationUsed" && eq(l.from, intent.buyer) && eq(l.nonce, intent.nonce));

/** The tx succeeded on Base and used exactly our authorization. Returns the net USDC paid. */
export function checkReceipt(intent: Intent, r: ChainReceipt): bigint {
  must(r.status === "success", "the Base transaction reverted");
  const usdc = r.usdcLogs.filter((l) => eq(l.address, PIN.usdc));
  must(usedOurAuthorization(intent, r), "the transaction did not use our authorization");
  const sum = (f: (l: TokenLog) => boolean) => usdc.filter((l) => l.event === "Transfer" && f(l)).reduce((a, l) => a + (l.value ?? 0n), 0n);
  const paid = sum((l) => eq(l.from, intent.buyer)) - sum((l) => eq(l.to, intent.buyer));
  must(paid > 0n && paid <= BigInt(intent.value), `unexpected net payment ${formatUnits(paid, 6)} USDC`);
  return paid;
}

/** The certificate is for exactly what we asked to retire. */
export function checkCertificate(intent: Intent, certs: unknown): Cert {
  must(Array.isArray(certs) && certs.length === 1, "expected exactly one retirement in the transaction");
  const c = (certs as Cert[])[0];
  must(tonnesToKg(String(c.amountInTonnes)) === intent.kg, `certificate is for ${c.amountInTonnes} t, expected ${intent.tonnes} t`);
  must(c.creditId === intent.credit.creditId, `certificate credit ${c.creditId} is not ${intent.credit.creditId}`);
  must(c.projectId === intent.credit.projectId, `certificate project ${c.projectId} is not ${intent.credit.projectId}`);
  must(c.beneficiaryName === PIN.beneficiary, `certificate beneficiary is "${c.beneficiaryName}"`);
  must(eq(c.beneficiaryAddress, intent.buyer), "certificate beneficiary address is not the buyer");
  must(c.message === PIN.message, "certificate message differs");
  must(typeof c.retirementId === "string" && c.retirementId.toLowerCase().includes(String(intent.txHash).toLowerCase()), "certificate is for another transaction");
  const url = URL.parse(String(c.certificateUrl));
  must(url?.protocol === "https:" && url.host === PIN.certificateHost, `unexpected certificate URL ${c.certificateUrl}`);
  return c;
}

async function waitCertificates(deps: Deps, txHash: Hex, answer?: Json): Promise<unknown> {
  const has = (j?: Json) => Array.isArray(j?.retirements) && j.retirements.length > 0;
  if (has(answer)) return answer?.retirements;
  for (let i = 0; i < 40; i++) {
    // 404 = not indexed yet; 429/5xx/network errors are as harmless here, so keep polling
    const r = await deps.api("certificate", { txHash }).catch(() => null);
    if (r?.status === 200 && has(r.json)) return r.json.retirements;
    await deps.sleep(3000);
  }
  return null;
}

/** tx hash known -> receipt, certificate, checks, lot file. Safe to repeat: it spends nothing. */
async function finish(deps: Deps, intent: Intent, answer?: Json) {
  const txHash = intent.txHash as Hex;
  const receipt = await waitReceipt(deps, txHash);
  if (!receipt) throw new Error(`${txHash} is not mined yet. Nothing is lost: run --resume.`);
  const paid = checkReceipt(intent, receipt);
  const certs = await waitCertificates(deps, txHash, answer);
  if (!certs) throw new Error(`retired in ${txHash}, certificate not indexed yet. Nothing is lost: run --resume.`);
  const c = checkCertificate(intent, certs);
  const lot = {
    registry: intent.credit.registry,
    projectId: intent.credit.projectId,
    projectName: intent.credit.projectName,
    serial: `${c.creditId} / ${c.retirementId}`, // the credit class id alone is not unique to a purchase
    vintage: intent.credit.vintage,
    certificateURI: c.certificateUrl,
    retirementTx: `eip155:${PIN.chainId}:${txHash.toLowerCase()}`,
    quantityKg: intent.kg,
    creditId: c.creditId,
    retirementId: c.retirementId,
    beneficiary: c.beneficiaryName,
    paidUsdc: formatUnits(paid, 6),
    retiredAt: new Date(Number(c.timestamp) * 1000).toISOString(),
  };
  writeDurable(deps.lotFile, dump(lot), true);
  intent.status = "done";
  saveIntent(deps, intent);
  deps.log(`retired: https://basescan.org/tx/${txHash}\ncertificate: ${c.certificateUrl}\npaid ${lot.paidUsdc} USDC\nwrote ${deps.lotFile}`);
  return lot;
}

/** Resolve an unfinished intent against Base. Never signs, never spends. */
export async function resume(deps: Deps) {
  must(!existsSync(deps.lotFile), `${deps.lotFile} exists: nothing to resume`);
  must(existsSync(deps.intentFile), "no intent to resume");
  const intent = readIntent(deps);
  must((await deps.chain.chainId()) === PIN.chainId, "BASE_RPC_URL is not Base");
  // Read the head first: an authorization unused at a later read cannot have been used before this time.
  const head = await deps.chain.head();
  const known = intent.txHash ? await deps.chain.receipt(intent.txHash) : null;
  if (known && known.status === "success" && usedOurAuthorization(intent, known)) return finish(deps, intent);

  if (await deps.chain.authorizationUsed(intent.buyer, intent.nonce)) {
    const from = BigInt(intent.startBlock);
    const span = BigInt(Math.max(0, Number(intent.validBefore) - Math.floor(Date.parse(intent.createdAt) / 1000))) / 2n + 600n; // 2 s blocks
    const tx = await deps.chain.findAuthorizationTx(intent.buyer, intent.nonce, from, from + span);
    if (!tx) throw new Error("the authorization is used but its AuthorizationUsed event was not found: check the buyer wallet by hand, do not buy again");
    deps.log(`found the purchase on Base: https://basescan.org/tx/${tx}`);
    intent.txHash = tx.toLowerCase() as Hex;
    intent.status = "sent";
    saveIntent(deps, intent);
    return finish(deps, intent);
  }
  // margin: a load-balanced RPC may answer the second read from a node that is behind the first
  if (head.timestamp > Number(intent.validBefore) + PIN.expiryMarginSec) {
    voidIntent(deps, intent, "authorization expired unused, no money moved");
    return null;
  }
  throw new Error(
    `authorization is unused but valid until ${new Date(Number(intent.validBefore) * 1000).toISOString()}: the relay may still use it. Run --resume again ${PIN.expiryMarginSec / 60} min after that.`,
  );
}
