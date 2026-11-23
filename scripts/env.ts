// Per-network, per-role keys for the scripts. No role falls back to another role's key (review B1).
//   Fuji:     FUJI_PRIVATE_KEY (deployer/admin), METER_PRIVATE_KEY, PAY_TO_PRIVATE_KEY, AGENT_PRIVATE_KEY, AGENT_ID
//   Mainnet:  MAINNET_PRIVATE_KEY (throwaway deployer), MAINNET_METER_PRIVATE_KEY, MAINNET_PAY_TO_PRIVATE_KEY,
//             MAINNET_AGENT_PRIVATE_KEY, MAINNET_AGENT_ID   (admin/treasury = Safe, never a local key)
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Deployment } from "@decarbonai/chain";
import { loadDeployment } from "@decarbonai/chain/node";

export function scriptEnv() {
  const d: Deployment = loadDeployment();
  const mainnet = d.chainId === 43114;
  const v = (fuji: string, main: string) => process.env[mainnet ? main : fuji] || undefined; // blank = unset
  const key = (fuji: string, main: string) => v(fuji, main) as Hex | undefined;
  const payToKey = key("PAY_TO_PRIVATE_KEY", "MAINNET_PAY_TO_PRIVATE_KEY");
  const payTo = (v("PAY_TO_ADDRESS", "MAINNET_PAY_TO_ADDRESS") ??
    (payToKey ? privateKeyToAccount(payToKey).address : undefined)) as Address | undefined;
  const agentId = v("AGENT_ID", "MAINNET_AGENT_ID");
  return {
    d,
    mainnet,
    deployerKey: key("FUJI_PRIVATE_KEY", "MAINNET_PRIVATE_KEY"),
    meterKey: key("METER_PRIVATE_KEY", "MAINNET_METER_PRIVATE_KEY"),
    payToKey,
    payTo,
    agentKey: key("AGENT_PRIVATE_KEY", "MAINNET_AGENT_PRIVATE_KEY"),
    agentId: agentId ? BigInt(agentId) : undefined,
    agentIdVar: mainnet ? "MAINNET_AGENT_ID" : "AGENT_ID",
  };
}

export function need<T>(value: T | undefined, name: string): T {
  if (value === undefined || value === "") throw new Error(`${name} missing in .env (see scripts/env.ts)`);
  return value;
}
