// Buy + retire a REAL carbon credit on Base through the Carbonmark/Klima x402 endpoint, to back
// mainnet DCO2 lot 1. Gasless relay path: the buyer only signs one EIP-3009 USDC authorization
// (no ETH needed); the relay submits and the certificate is resolved afterwards.
//
//   node scripts/klima-retire.ts --dry-run --from <buyer address> [--tonnes 1] [--listing <id>]
//   node --env-file=.env scripts/klima-retire.ts --execute --confirm-usd <max USDC> [--tonnes 1] [--listing <id>]
//   node scripts/klima-retire.ts --resume
//
// --dry-run moves no funds and needs no key. --execute signs and relays if the live authorization is at most
// --confirm-usd (and the hard cap in scripts/lib/klima.ts), then writes deployments/avalanche-lot1.json, which
// the mainnet deploy reads via LOT_FILE. It refuses to run if that file or an unfinished intent exists.
// --resume finishes (or voids) an interrupted purchase from the chain. It never signs and never spends.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { type Address, type Hex, createPublicClient, erc20Abi, formatUnits, http, isAddress, parseAbi, parseEventLogs } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { type ApiResult, type Chain, type Deps, type Json, PIN, type TokenLog, assertNoPurchase, execute, plan, resume } from "./lib/klima.ts";

const API = "https://v1.x402.klimalabs.com/api";
const deployments = (name: string) => fileURLToPath(new URL(`../deployments/${name}`, import.meta.url));

const { values: args } = parseArgs({
  options: {
    "dry-run": { type: "boolean" },
    execute: { type: "boolean" },
    resume: { type: "boolean" },
    "confirm-usd": { type: "string" },
    tonnes: { type: "string", default: "1" },
    listing: { type: "string" },
    from: { type: "string" },
  },
});
if ([args["dry-run"], args.execute, args.resume].filter(Boolean).length !== 1) {
  throw new Error("pass exactly one of --dry-run, --execute, --resume");
}

async function api(action: string, body: Json): Promise<ApiResult> {
  const res = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...body }),
    redirect: "error",
    signal: AbortSignal.timeout(action === "actions/retire" ? 180_000 : 30_000),
  });
  return { status: res.status, json: (await res.json()) as Json };
}

const usdcAbi = parseAbi([
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
  "event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

function baseChain(): Chain {
  const client = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL || "https://mainnet.base.org") });
  return {
    chainId: () => client.getChainId(),
    head: async () => {
      const b = await client.getBlock({ blockTag: "latest" });
      return { number: b.number, timestamp: Number(b.timestamp) };
    },
    usdcBalance: (owner) => client.readContract({ address: PIN.usdc, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
    authorizationUsed: (authorizer, nonce) =>
      client.readContract({ address: PIN.usdc, abi: usdcAbi, functionName: "authorizationState", args: [authorizer, nonce] }),
    async findAuthorizationTx(authorizer, nonce, fromBlock, toBlock) {
      const head = await client.getBlockNumber();
      const end = toBlock < head ? toBlock : head;
      for (let from = fromBlock; from <= end; from += 500n) {
        const to = from + 499n < end ? from + 499n : end;
        const logs = await client.getLogs({ address: PIN.usdc, event: usdcAbi[1], args: { authorizer, nonce }, fromBlock: from, toBlock: to });
        if (logs[0]) return logs[0].transactionHash;
      }
      return null;
    },
    async receipt(hash) {
      const r = await client.getTransactionReceipt({ hash }).catch((e) => {
        if (e?.name === "TransactionReceiptNotFoundError") return null;
        throw e;
      });
      if (!r) return null;
      const logs = parseEventLogs({ abi: usdcAbi, logs: r.logs.filter((l) => l.address.toLowerCase() === PIN.usdc.toLowerCase()) });
      return {
        status: r.status,
        usdcLogs: logs.map((l): TokenLog =>
          l.eventName === "Transfer"
            ? { address: l.address, event: "Transfer", from: l.args.from, to: l.args.to, value: l.args.value }
            : { address: l.address, event: "AuthorizationUsed", from: l.args.authorizer, nonce: l.args.nonce },
        ),
      };
    },
  };
}

const deps: Deps = {
  api,
  chain: baseChain(),
  now: () => Math.floor(Date.now() / 1000),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  log: (line) => console.log(line),
  lotFile: deployments("avalanche-lot1.json"),
  intentFile: deployments("avalanche-lot1.intent.json"),
};

if (args.resume) {
  await resume(deps);
  process.exit(0);
}

if (args.execute) assertNoPurchase(deps); // before any network call
else if (existsSync(deps.lotFile) || existsSync(deps.intentFile)) console.log("NOTE: a lot or intent file exists; --execute would refuse\n");

const key = args.execute ? (process.env.BASE_BUYER_PRIVATE_KEY as Hex | undefined) : undefined;
if (args.execute && !key) throw new Error("BASE_BUYER_PRIVATE_KEY missing");
const account = key ? privateKeyToAccount(key) : undefined;
const buyer = account?.address ?? (args.from as Address | undefined);
if (!buyer || !isAddress(buyer)) throw new Error("--dry-run needs --from <buyer address>");

const p = await plan(deps, buyer, args.tonnes, args.listing as Hex | undefined);
const authorized = formatUnits(p.auth.value, 6);
console.log(
  `\nwould retire ${p.kg} kg of ${p.credit.creditId} (${p.credit.registry} ${p.credit.projectId} "${p.credit.projectName}", vintage ${p.credit.vintage})\n` +
    `would authorize ${authorized} USDC from ${buyer} (Base) to ${PIN.executor}, until ${new Date(Number(p.auth.validBefore) * 1000).toISOString()}\n` +
    `beneficiary "${PIN.beneficiary}", message "${PIN.message}"`,
);
if (!account) {
  const ceiling = formatUnits((p.auth.value * 11n) / 10n, 6);
  console.log(
    `\ndry run only. To buy + retire, paying at most ${ceiling} USDC (this quote + 10%, gas moves it by the second):\n` +
      `  --execute --confirm-usd ${ceiling}${args.listing ? ` --listing ${args.listing}` : ""}`,
  );
  process.exit(0);
}
await execute(deps, p, args["confirm-usd"], (td) => account.signTypedData(td));
