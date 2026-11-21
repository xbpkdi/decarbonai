import { keccak256, toBytes } from "viem";
import { V0_FACTORS, estimateMgCO2e, type ModelId } from "./emissions.ts";

/** Stable JSON (sorted keys) so the hash only changes when the factors change. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export const METHODOLOGY_VERSION = V0_FACTORS.version;
export const METHODOLOGY_JSON = canonical(V0_FACTORS);
/** Registered on-chain in RetirementPool.setMethodology and attached to every accrual. */
export const METHODOLOGY_HASH = keccak256(toBytes(METHODOLOGY_JSON));

export const MODEL_IDS = Object.keys(V0_FACTORS.models) as ModelId[];

export function isModelId(value: string): value is ModelId {
  return value in V0_FACTORS.models;
}

/** Mid estimate in integer mgCO2e for one call. */
export function estimateCallMgCO2e(model: ModelId, inputTokens: number, outputTokens: number): number {
  return estimateMgCO2e({
    model,
    requests: 1,
    inputTokensPerRequest: Math.max(0, inputTokens),
    outputTokensPerRequest: Math.max(0, outputTokens),
  }).midMg;
}
