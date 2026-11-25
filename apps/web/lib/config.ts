import { avalanche, avalancheFuji } from "viem/chains";
import mainnetDeployment from "../../../deployments/avalanche.json";
import mainnetLot1 from "../../../deployments/avalanche-lot1.json";
import fujiDeployment from "../../../deployments/fuji.json";
import { DEFAULT_NET, type NetId, toNetId } from "./net-id";

/**
 * Two networks, picked per request: Avalanche mainnet (default) or Fuji. The choice travels as
 * ?network=fuji, a cookie (middleware.ts) and localStorage (NetSwitch). Contract addresses come from
 * deployments/<avalanche|fuji>.json.
 */
export * from "./net-id";

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

/** The real retired credit behind a backed DCO2 lot. */
export type Lot = { id: number; project: string; creditId: string; certificate: string; quantityKg: number };

/** ERC-8004 id -> display name, from NEXT_PUBLIC_AGENT_NAMES ({"360":"Demo agent"}). */
export const AGENT_NAMES: Record<string, string> = (() => {
  try {
    return JSON.parse(process.env.NEXT_PUBLIC_AGENT_NAMES || "{}");
  } catch {
    return {};
  }
})();

export const agentName = (id: number | string) => AGENT_NAMES[String(id)] || `Agent #${id}`;

/** The agent the server-side demo key pays as (Developers "Run", Agent "Pay one call"). Fuji only. */
export const DEMO_AGENT_ID = Number(process.env.NEXT_PUBLIC_DEMO_AGENT_ID || 0) || null;

function build(base: {
  id: NetId;
  chain: typeof avalanche | typeof avalancheFuji;
  name: string;
  label: string;
  short: string;
  testnet: boolean;
  explorer: string;
  rpc: string;
  logsApi: string;
  deployment: DeploymentInfo;
  featured: number;
  calls: string;
  lot: Lot | null;
  superseded: Hex[];
}) {
  const D = base.deployment;
  const unbacked = !D.dco2Backed;
  /** Fuji pays in our own faucet token, not Circle USDC. */
  const token = base.testnet ? { name: "TestUSDC", symbol: "tUSDC" } : { name: "USDC", symbol: "USDC" };
  const contractList = [
    ["RetirementPool", D.retirementPool, "Takes the surcharge, emits CarbonAccrued, retires per payer at 1 kg."],
    ["CarbonReceipt", D.carbonReceipt, "ERC-721 + ERC-5192 soulbound receipts."],
    [D.dco2Backed ? "DCO2" : "DCO2 (mock)", D.dco2, "ERC-1155 credit lots, burned on retirement."],
    [token.name, D.paymentToken, base.testnet ? `Testnet payment token (${token.symbol}) with a faucet. Not Circle USDC.` : "Circle USDC."],
    ["ERC-8004 adapter", D.reputationAdapter, unbacked
      ? `Writes carbon-settled feedback for backed lots only. None written on ${base.short}.`
      : "Writes carbon-settled feedback for backed lots."],
  ] as [string, Hex, string][];
  return {
    ...base,
    unbacked,
    token,
    contractList,
    /** Footer and receipts follow the network: Fuji burns a mock credit, mainnet burns backed lots. */
    creditNote: D.dco2Backed ? "DCO2 lots are minted 1:1 against credits retired off-chain" : "DCO2 is a testnet mock credit",
  };
}

export const NETS = {
  mainnet: build({
    id: "mainnet",
    chain: avalanche,
    name: "Avalanche mainnet",
    label: "Avalanche mainnet",
    short: "Avalanche",
    testnet: false,
    explorer: "https://snowtrace.io",
    // api.avax.network caps eth_getLogs at 100 blocks; reads go through this one.
    rpc: process.env.MAINNET_RPC_URL || "https://avalanche-c-chain-rpc.publicnode.com",
    logsApi: "https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan/api",
    deployment: mainnetDeployment as DeploymentInfo,
    featured: 1855,
    // Every mainnet call so far is our own scripted test run, paid in real USDC.
    calls: "scripted test calls",
    lot: {
      id: 1,
      project: mainnetLot1.projectId,
      creditId: mainnetLot1.creditId,
      certificate: mainnetLot1.certificateURI,
      quantityKg: mainnetLot1.quantityKg,
    },
    superseded: [],
  }),
  fuji: build({
    id: "fuji",
    chain: avalancheFuji,
    name: "Avalanche Fuji testnet",
    label: "Fuji testnet",
    short: "Fuji",
    testnet: true,
    explorer: "https://testnet.snowtrace.io",
    rpc: process.env.NEXT_PUBLIC_RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc",
    logsApi: "https://api.routescan.io/v2/network/testnet/evm/43113/etherscan/api",
    deployment: fujiDeployment as DeploymentInfo,
    featured: Number(process.env.NEXT_PUBLIC_FEATURED_AGENT_ID || 0) || DEMO_AGENT_ID || 360,
    calls: "paid testnet calls",
    lot: null,
    // Adapters of earlier pool deployments that still have entries in the ERC-8004 registry.
    superseded: ["0x3f672742dB74baEAD1716E81C82132d3d3F64CE9"],
  }),
};

export type Net = (typeof NETS)[NetId];

/** Mainnet proof, shown on every build. From deployments/avalanche.json and avalanche-lot1.json (24 Nov 2026). */
export const MAINNET_PROOF = {
  credit: "UCR-423-2022",
  certificate: "https://app.carbonmark.com/retirements/id/8453-0x58c8764d321f659b8b0662b594e38b9529e95cd00c3b44dea313dbba5317ba45-0",
  pool: "https://snowtrace.io/address/0x32b7a17Ea7af98E7f161ab82A068D421Da9230DF",
  receiptTxs: [
    "https://snowtrace.io/tx/0x08a33b4b509754ae318ebbb19370b36a590412f5eae5dd0179bff398bc9a8510",
    "https://snowtrace.io/tx/0x35c4e8fd1095eb000cbba1752caf470c05c59fa19f2713663c128004210d65cd",
  ],
} as const;

export const netById = (id: string | null | undefined): Net => NETS[toNetId(id) ?? DEFAULT_NET];

/** This path on network `id`: ?network=<id>, which middleware.ts also stores in the cookie. */
export function netHref(id: NetId, path: string, search = "") {
  const q = new URLSearchParams(search);
  q.set("network", id);
  return `${path}?${q}`;
}

/** Canonical origin for OG/metadata: explicit env, else this Vercel deployment, else production. */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "") ||
  "https://decarbonai.vercel.app"
).replace(/\/$/, "");

export const REPO_URL = "https://github.com/xbpkdi/decarbonai";

export function short(hex: string, head = 6, tail = 4) {
  return hex.length <= head + tail + 1 ? hex : `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}
