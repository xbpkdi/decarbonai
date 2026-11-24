// Who may hold mainnet admin: a Safe, never one of our bot wallets. Shared by audit-roles and its test; the
// deploy script (packages/contracts/script/Deploy.s.sol) enforces the same rule and must be changed with it.
import type { Address } from "viem";

/** Owner decision 24 Nov 2026: the admin Safe is 1-of-1 (the owner's personal wallet). Raise to require a multisig again. */
export const MIN_SAFE_THRESHOLD = 1n;

/** Mainnet bot wallets (keys in .env). Update on every key rotation. */
export const BOT_WALLETS: Record<string, Address> = {
  deployer: "0xBc889999FF5A350E7893e673d0D610D94a16B651",
  meter: "0x1A96F7c923c245782c97173fCE555fDb2EC47E8c",
  payTo: "0xf70CA95402f4Ee5093cd370DEC41b0AB67AD804b",
  "demo agent": "0x013f46Cca6D2E88715CC64a1f247fd36a388402F",
  "Base buyer": "0x7a98A0d9F9baA5037CaCF957dc9c8307CDD81806",
};

export type SafeState = { hasCode: boolean; threshold: bigint; owners: readonly Address[] };

/** Every reason `safe` must not hold admin; empty when it may. `hotKeys` adds the deployment's own wallets. */
export function safeProblems(safe: SafeState, hotKeys: Record<string, Address> = {}, minThreshold = MIN_SAFE_THRESHOLD): string[] {
  const problems: string[] = [];
  if (!safe.hasCode) return ["admin has no code: an EOA, not a Safe"];
  const { threshold, owners } = safe;
  // threshold 1 is only a 1-of-1: with more owners any one of them could act alone
  if (threshold === 0n || threshold < minThreshold || threshold > BigInt(owners.length) || (threshold === 1n && owners.length !== 1)) {
    problems.push(`threshold ${threshold} of ${owners.length} owners (need ${minThreshold <= 1n ? "a 1-of-1 or 2+ signers" : `at least ${minThreshold} signers`})`);
  }
  const bots = Object.entries({ ...BOT_WALLETS, ...hotKeys });
  for (const owner of owners) {
    const bot = bots.find(([, a]) => a.toLowerCase() === owner.toLowerCase());
    if (bot) problems.push(`owner ${owner} is the ${bot[0]} bot wallet`);
  }
  return problems;
}
