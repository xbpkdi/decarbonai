// Node-only helpers (fs/env). Browser code should import deployments directly.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, type PublicClient } from "viem";
import { FUJI, type Deployment } from "./index.ts";
import { network } from "./networks.ts";

/** DECARBONAI_NETWORK=fuji (default) | avalanche -> deployments/<name>.json */
export function loadDeployment(name = process.env.DECARBONAI_NETWORK ?? "fuji"): Deployment {
  if (name === "fuji") return FUJI;
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`bad network name ${name}`);
  const path = fileURLToPath(new URL(`../../../deployments/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as Deployment;
}

export function clientFor(d: Deployment, rpcUrl?: string): PublicClient {
  const n = network(d.chainId);
  return createPublicClient({ chain: n.chain, transport: http(rpcUrl ?? process.env[n.rpcEnv] ?? n.rpcUrl) }) as PublicClient;
}

export function rpcUrlFor(d: Deployment): string {
  const n = network(d.chainId);
  return process.env[n.rpcEnv] ?? n.rpcUrl;
}
