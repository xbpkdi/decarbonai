// Buy + retire a REAL carbon credit on Base through the Carbonmark/Klima x402 endpoint, to back
// mainnet DCO2 lot 1. Gasless relay path: the buyer only signs one EIP-3009 USDC authorization
// (no ETH needed); the relay submits and the certificate is resolved afterwards.
//
//   node --env-file=.env scripts/klima-retire.ts --dry-run [--tonnes 1]
//   node --env-file=.env scripts/klima-retire.ts --execute --confirm-usd 0.091447 [--tonnes 1] [--listing <id>]
//
// --dry-run moves no funds: discover + quote (cheapest liquid protocol class, and the cheapest Verra
// listing for comparison) + prepare-auth to get the exact USDC amount that would be authorized.
// --execute signs and relays ONLY if --confirm-usd equals that exact amount, then writes
// deployments/avalanche-lot1.json, which the mainnet deploy reads via LOT_FILE.
import { writeFileSync } from "node:fs";
import { type Hex, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const API = "https://v1.x402.klimalabs.com/api";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BENEFICIARY = "DecarbonAI";
const MESSAGE = "DecarbonAI custodial bridge v0: backs DCO2 lot 1 on Avalanche C-Chain (carbon-metered x402)";
const LOT_FILE = "deployments/avalanche-lot1.json";

type Json = Record<string, unknown>;
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const tonnes = arg("--tonnes") ?? "1";
const execute = process.argv.includes("--execute");

async function call(action: string, body: Json = {}): Promise<Json> {
  const res = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...body }),
  });
  const json = (await res.json()) as Json;
  if (!res.ok && res.status !== 402) throw new Error(`${action} ${res.status}: ${JSON.stringify(json).slice(0, 600)}`);
  return json;
}

type Credit = { tokenAddress?: string; registry: string; vintage: number | string; creditId: string; projectKey: string; projectName: string; liquidityFormatted?: string };
type Klass = { carbonClassId: Hex; name: string; priceUsdcPerTonne: string; minRetirementTonnesFormatted: string; creditsDetailed: Credit[] };
type Listing = Credit & { listingId: Hex; priceUsdcPerTonne: string; leftToSellFormatted: string; minFillFormatted: string };

const d = (await call("discover")) as { carbonClasses: Klass[]; marketplaceListings: Listing[] };
const want = Number(tonnes);
const klass = d.carbonClasses
  .filter((k) => Number(k.minRetirementTonnesFormatted) <= want)
  .filter((k) => k.creditsDetailed.some((c) => Number(c.liquidityFormatted ?? 0) >= want))
  .sort((a, b) => Number(a.priceUsdcPerTonne) - Number(b.priceUsdcPerTonne))[0];
const verra = d.marketplaceListings
  .filter((l) => l.registry === "VCS" && Number(l.leftToSellFormatted) >= want && Number(l.minFillFormatted) <= want)
  .sort((a, b) => Number(a.priceUsdcPerTonne) - Number(b.priceUsdcPerTonne))[0];
if (!klass) throw new Error(`no liquid protocol class for ${tonnes} t`);

const base = { chainId: 8453, inputToken: USDC_BASE, amount: tonnes };
const qClass = await call("quote", { ...base, carbonClass: klass.carbonClassId });
const qVerra = verra ? await call("quote", { ...base, listingId: verra.listingId }) : null;

const show = (label: string, q: Json, project: string, vintage: unknown, registry: string) =>
  console.log(
    `${label}: ${registry} ${project} vintage ${vintage}, ${q.tonnesFormatted} t\n` +
      `  credit ${q.retirementPriceFormatted} + fee ${q.feeFormatted} = ${q.totalFormatted} USDC; ` +
      `relayed (incl. executor gas ${q.relayExecutorGasFormatted}) = ${q.relayTotalFormatted} USDC`,
  );
const resolved = qClass.resolvedCredit as { creditToken: string; vintage: number };
const credit =
  klass.creditsDetailed.find((c) => c.tokenAddress?.toLowerCase() === resolved.creditToken.toLowerCase()) ??
  klass.creditsDetailed[0];
show(`cheapest (${klass.name})`, qClass, `${credit.projectKey} "${credit.projectName}"`, resolved.vintage, credit.registry);
if (qVerra && verra) show("Verra comparison", qVerra, `${verra.projectKey} "${verra.projectName}"`, verra.vintage, "VCS");

// Choose the supply: the cheapest protocol class by default, or a listing via --listing.
const listingId = arg("--listing");
const supply = listingId ? { listingId } : { carbonClass: klass.carbonClassId };
const chosen = listingId
  ? d.marketplaceListings.find((l) => l.listingId === listingId)
  : { ...credit, vintage: resolved.vintage };
if (!chosen) throw new Error("unknown --listing");

const key = process.env.BASE_BUYER_PRIVATE_KEY as Hex | undefined;
if (!key) throw new Error("BASE_BUYER_PRIVATE_KEY missing in .env");
const buyer = privateKeyToAccount(key);
const prep = (await call("prepare-auth", {
  ...base,
  ...supply,
  from: buyer.address,
  beneficiaryIsPayer: true,
  details: { beneficiaryString: BENEFICIARY, retiringEntityString: BENEFICIARY, retirementMessage: MESSAGE },
})) as { typedData: { domain: Json; types: Json; primaryType: string; message: { value: string } }; actionsRetireRequest: Json };
const authorized = formatUnits(BigInt(prep.typedData.message.value), 6);
console.log(
  `\nwould authorize exactly ${authorized} USDC from buyer ${buyer.address} (Base)\n` +
    `beneficiary "${BENEFICIARY}", message "${MESSAGE}"`,
);

if (!execute) {
  console.log(`\ndry run only. To buy + retire: --execute --confirm-usd ${authorized}${listingId ? ` --listing ${listingId}` : ""}`);
  process.exit(0);
}
const confirm = arg("--confirm-usd");
if (confirm !== authorized) {
  throw new Error(`refusing: --confirm-usd ${confirm ?? "(missing)"} does not match the live authorization ${authorized} USDC`);
}

const signature = await buyer.signTypedData(prep.typedData as Parameters<typeof buyer.signTypedData>[0]);
const r = `0x${signature.slice(2, 66)}` as Hex;
const s = `0x${signature.slice(66, 130)}` as Hex;
const v = Number.parseInt(signature.slice(130, 132), 16);
const req = prep.actionsRetireRequest as Json & { authPayload: Json };
const result = await call("actions/retire", { ...req, authPayload: { ...req.authPayload, v, r, s, signature } });
const txHash = (result.txHash ?? result.transactionHash) as Hex | undefined;
if (!txHash) throw new Error(`retire returned no tx: ${JSON.stringify(result).slice(0, 600)}`);
let certificateURI = (result.certificateUrl ?? result.certificateURL ?? "") as string;
for (let i = 0; i < 20 && !certificateURI; i++) {
  await new Promise((res) => setTimeout(res, 3000));
  const c = (await call("certificate", { txHash })) as { certificates?: { url?: string }[]; url?: string };
  certificateURI = c.url ?? c.certificates?.[0]?.url ?? "";
}

const [registryPrefix, projectNum] = chosen.projectKey.split("-");
const lot = {
  registry: chosen.registry ?? registryPrefix,
  projectId: chosen.projectKey ?? `${registryPrefix}-${projectNum}`,
  projectName: chosen.projectName,
  serial: chosen.creditId,
  vintage: Number(String(chosen.vintage).slice(0, 4)),
  certificateURI,
  retirementTx: `eip155:8453:${txHash}`,
  quantityKg: Math.round(Number(tonnes) * 1000),
  beneficiary: BENEFICIARY,
  paidUsdc: authorized,
  retiredAt: new Date().toISOString(),
};
writeFileSync(LOT_FILE, `${JSON.stringify(lot, null, 2)}\n`);
console.log(`\nretired: https://basescan.org/tx/${txHash}\ncertificate: ${certificateURI || "(pending, re-run certificate)"}\nwrote ${LOT_FILE}`);
