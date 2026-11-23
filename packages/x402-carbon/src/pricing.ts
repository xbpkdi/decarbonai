import { estimateCallMgCO2e, isModelId, METHODOLOGY_HASH, METHODOLOGY_VERSION, type ModelId } from "@decarbonai/core";

const MG_PER_TONNE = 1_000_000_000n;

/** Same rounding as RetirementPool.quote(): ceil(mg * pricePerTonne / 1e9). */
export function quoteSurcharge(mgCO2e: bigint, pricePerTonne: bigint): bigint {
  if (mgCO2e === 0n || pricePerTonne === 0n) return 0n;
  return (mgCO2e * pricePerTonne + MG_PER_TONNE - 1n) / MG_PER_TONNE;
}

export type Usage = { model: ModelId; inputTokens: number; outputTokens: number };

export type CarbonQuote = Usage & {
  mgCO2e: bigint;
  baseAmount: bigint;
  surcharge: bigint;
  total: bigint;
  methodologyHash: `0x${string}`;
  methodologyVersion: string;
};

export function carbonQuote(usage: Usage, baseAmount: bigint, pricePerTonne: bigint): CarbonQuote {
  const mgCO2e = BigInt(estimateCallMgCO2e(usage.model, usage.inputTokens, usage.outputTokens));
  const surcharge = quoteSurcharge(mgCO2e, pricePerTonne);
  return {
    ...usage,
    mgCO2e,
    baseAmount,
    surcharge,
    total: baseAmount + surcharge,
    methodologyHash: METHODOLOGY_HASH,
    methodologyVersion: METHODOLOGY_VERSION,
  };
}

/** Rough token count for pricing before the call runs (~4 chars per token). */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export const MAX_OUTPUT_TOKENS = 4_000;

/** Parse usage from query params: model, prompt, maxOutputTokens. Throws on bad input. */
export function usageFromQuery(q: (name: string) => string | undefined): Usage {
  const model = q("model") ?? "claude-sonnet";
  if (!isModelId(model)) throw new Error(`unknown model "${model}"`);
  const prompt = q("prompt") ?? "";
  const maxOut = Number(q("maxOutputTokens") ?? "500");
  if (!Number.isInteger(maxOut) || maxOut < 1 || maxOut > MAX_OUTPUT_TOKENS) {
    throw new Error(`maxOutputTokens must be an integer in 1..${MAX_OUTPUT_TOKENS}`);
  }
  return { model, inputTokens: approxTokens(prompt), outputTokens: maxOut };
}
