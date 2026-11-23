import type { NextConfig } from "next";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Optional peers that wallet SDKs import but never use in a browser dapp.
const OPTIONAL_PEERS = ["@react-native-async-storage/async-storage", "pino-pretty"];
const STUBS: Record<string, string> = {
  ...Object.fromEntries(OPTIONAL_PEERS.map((m) => [m, "./lib/shims/empty.js"])),
  // wagmi's Base Account connector pulls in the Coinbase CDP SDK and its x402 peers; we never offer it.
  "@base-org/account": "./lib/shims/base-account.js",
};

/**
 * NEXT_PUBLIC_NETWORK picks fuji (default) or mainnet. Contract addresses for it come from
 * deployments/<fuji|avalanche>.json, written by the contracts deploy script.
 */
const network = process.env.NEXT_PUBLIC_NETWORK === "mainnet" ? "mainnet" : "fuji";
const deploymentFile = path.join(__dirname, "../../deployments", `${network === "mainnet" ? "avalanche" : "fuji"}.json`);
const deployment = existsSync(deploymentFile) ? readFileSync(deploymentFile, "utf8") : "{}";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_NETWORK: network,
    NEXT_PUBLIC_DEPLOYMENT: deployment,
  },
  transpilePackages: ["@decarbonai/chain", "@decarbonai/core", "@decarbonai/x402-carbon"],
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // The old individual estimate/checkout flow is gone. /certificate/:id explains that v1 certificates were not carried over.
  async redirects() {
    return [
      { source: "/receipts/:n(\\d+)", destination: "/receipt/:n", permanent: false },
      { source: "/estimate", destination: "/methodology", permanent: false },
      { source: "/checkout", destination: "/", permanent: false },
    ];
  },
  turbopack: {
    root: path.join(__dirname, "../.."),
    resolveAlias: STUBS,
  },
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      ...Object.fromEntries(Object.entries(STUBS).map(([m, file]) => [m, path.join(__dirname, file)])),
    };
    config.resolve.extensionAlias = { ".js": [".ts", ".js"] };
    return config;
  },
};

export default nextConfig;
