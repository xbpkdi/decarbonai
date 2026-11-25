/** Network ids and where the choice travels. Kept apart from config.ts so middleware.ts stays small (no viem). */
export type NetId = "mainnet" | "fuji";
export const NET_IDS: NetId[] = ["mainnet", "fuji"];
export const DEFAULT_NET: NetId = "mainnet";
export const NET_COOKIE = "dc-network";
export const NET_HEADER = "x-dc-network";
export const toNetId = (v: string | null | undefined): NetId | null => (v === "mainnet" || v === "fuji" ? v : null);
