import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Deployment } from "@decarbonai/chain";

const SECRET_NAME = /PRIVATE_KEY|MNEMONIC|SEED_PHRASE/i;

/**
 * Names of secrets this process must not hold (review B1): the API is internet-facing, so the only key it may
 * ever see is the METER_ROLE-only one. Blank values are fine. Names only, never values.
 */
export function foreignSecrets(env: NodeJS.ProcessEnv): string[] {
  return Object.keys(env)
    .filter((name) => SECRET_NAME.test(name) && name !== "METER_PRIVATE_KEY" && env[name]?.trim())
    .sort();
}

/** One accrual DB per chain + pool. An explicit ACCRUAL_DB wins, blank means unset. Same file for API and reconcile. */
export function accrualDbPath(d: Pick<Deployment, "chainId" | "retirementPool">, explicit = process.env.ACCRUAL_DB): string {
  const path = explicit?.trim();
  if (path) {
    // the API and the scripts run in different directories, so a relative path would be two different files
    if (!isAbsolute(path)) throw new Error(`ACCRUAL_DB must be an absolute path, got ${path}`);
    return path;
  }
  return join(fileURLToPath(new URL("../.data/", import.meta.url)), `accruals-${d.chainId}-${d.retirementPool.toLowerCase()}.sqlite`);
}
