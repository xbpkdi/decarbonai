import { avalanche, avalancheFuji } from "viem/chains";

/**
 * Network config. NEXT_PUBLIC_NETWORK picks Avalanche Fuji (default) or C-Chain mainnet; contract
 * addresses come from deployments/<network>.json at build time (see next.config.ts).
 */
const NETWORKS = {
  fuji: {
    id: "fuji",
    chain: avalancheFuji,
    name: "Avalanche Fuji testnet",
    short: "Fuji",
    testnet: true,
    explorer: "https://testnet.snowtrace.io",
    rpc: "https://api.avax-test.network/ext/bc/C/rpc",
    logsApi: "https://api.routescan.io/v2/network/testnet/evm/43113/etherscan/api",
  },
  mainnet: {
    id: "mainnet",
    chain: avalanche,
    name: "Avalanche C-Chain",
    short: "C-Chain",
    testnet: false,
    explorer: "https://snowtrace.io",
    rpc: "https://api.avax.network/ext/bc/C/rpc",
    logsApi: "https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan/api",
  },
} as const;

export const NETWORK = NETWORKS[process.env.NEXT_PUBLIC_NETWORK === "mainnet" ? "mainnet" : "fuji"];

type Hex = `0x${string}`;

export type DeploymentInfo = {
  chainId: number;
  deployBlock: number;
  retirementPool: Hex;
  carbonReceipt: Hex;
  dco2: Hex;
  reputationAdapter: Hex;
  erc8004IdentityRegistry: Hex;
  erc8004ReputationRegistry: Hex;
  paymentToken: Hex;
  methodologyHash: Hex;
  methodologyVersion: string;
  thresholdMg: number;
  pricePerTonne: number;
  dco2Backed: boolean;
};

export const DEPLOYMENT = JSON.parse(process.env.NEXT_PUBLIC_DEPLOYMENT || "{}") as DeploymentInfo;

export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || NETWORK.rpc;

/** True while the pool burns a credit with no real retirement behind it (Fuji). */
export const UNBACKED = !DEPLOYMENT.dco2Backed;

/** Fuji pays in our own faucet token, not Circle USDC. */
export const TOKEN = NETWORK.testnet ? { name: "TestUSDC", symbol: "tUSDC" } : { name: "USDC", symbol: "USDC" };

/** Footer and receipts follow the network: Fuji burns a mock credit, mainnet burns backed lots. */
export const CREDIT_NOTE = DEPLOYMENT.dco2Backed
  ? "DCO2 lots are minted 1:1 against credits retired off-chain"
  : "DCO2 is a testnet mock credit";

/** Adapters of earlier pool deployments that still have entries in the ERC-8004 registry. */
export const SUPERSEDED_ADAPTERS: Hex[] = NETWORK.testnet ? ["0x3f672742dB74baEAD1716E81C82132d3d3F64CE9"] : [];

/** ERC-8004 id -> display name, from NEXT_PUBLIC_AGENT_NAMES ({"360":"Demo agent"}). */
export const AGENT_NAMES: Record<string, string> = (() => {
  try {
    return JSON.parse(process.env.NEXT_PUBLIC_AGENT_NAMES || "{}");
  } catch {
    return {};
  }
})();

export const agentName = (id: number | string) => AGENT_NAMES[String(id)] || `Agent #${id}`;

/** The agent the server-side demo key pays as (Developers "Run", Agent "Pay one call"). */
export const DEMO_AGENT_ID = Number(process.env.NEXT_PUBLIC_DEMO_AGENT_ID || 0) || null;

/** Canonical origin for OG/metadata: explicit env, else this Vercel deployment, else production. */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "") ||
  "https://decarbonai.vercel.app"
).replace(/\/$/, "");

export const REPO_URL = "https://github.com/xbpkdi/decarbonai";

export const CONTRACT_LIST = [
  ["RetirementPool", DEPLOYMENT.retirementPool, "Takes the surcharge, emits CarbonAccrued, retires per payer at 1 kg."],
  ["CarbonReceipt", DEPLOYMENT.carbonReceipt, "ERC-721 + ERC-5192 soulbound receipts."],
  [DEPLOYMENT.dco2Backed ? "DCO2" : "DCO2 (mock)", DEPLOYMENT.dco2, "ERC-1155 credit lots, burned on retirement."],
  [TOKEN.name, DEPLOYMENT.paymentToken, NETWORK.testnet ? `Testnet payment token (${TOKEN.symbol}) with a faucet. Not Circle USDC.` : "Payment token."],
  ["ERC-8004 adapter", DEPLOYMENT.reputationAdapter, UNBACKED
    ? `Writes carbon-settled feedback for backed lots only. None written on ${NETWORK.short}.`
    : "Writes carbon-settled feedback for backed lots."],
] as const;

export function short(hex: string, head = 6, tail = 4) {
  return hex.length <= head + tail + 1 ? hex : `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}
