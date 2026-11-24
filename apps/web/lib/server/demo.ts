import "server-only";
import type { Hex } from "viem";

const LOCAL = ["localhost", "127.0.0.1", "[::1]"];

/**
 * Settings for real demo payments, or null unless every one is present and well formed:
 * DEMO_AGENT_PRIVATE_KEY (32-byte 0x hex), DEMO_API_URL (https, or http on localhost) and
 * NEXT_PUBLIC_DEMO_AGENT_ID (a decimal ERC-8004 id). The buttons and the route both use this.
 * Demo payments always run on Fuji, whichever network the page shows.
 */
export function demoConfig(): { key: Hex; api: URL; agentId: bigint } | null {
  const key = process.env.DEMO_AGENT_PRIVATE_KEY ?? "";
  const id = process.env.NEXT_PUBLIC_DEMO_AGENT_ID ?? "";
  const url = process.env.DEMO_API_URL ?? "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(key) || !/^[1-9]\d{0,29}$/.test(id) || !URL.canParse(url)) return null;
  const api = new URL(url);
  if (api.protocol !== "https:" && !(api.protocol === "http:" && LOCAL.includes(api.hostname))) return null;
  return { key: key as Hex, api, agentId: BigInt(id) };
}
