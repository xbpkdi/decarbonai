import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { FUJI, network, type Deployment } from "@decarbonai/chain";
import { AGENT_ID_HEADER, type CarbonExtra } from "./middleware.ts";

export type PayingFetchOptions = {
  privateKey: Hex;
  agentId?: bigint;
  /** Hard cap per call in token units (default 100_000 = $0.10). */
  maxAmountPerPayment?: bigint;
  deployment?: Deployment;
  onPayment?: (carbon: CarbonExtra | undefined, amount: string) => void;
};

/** fetch() that pays x402 challenges on the deployment's chain (Fuji by default) with the agent's key, only for the configured token. */
export function createPayingFetch(opts: PayingFetchOptions) {
  const d = opts.deployment ?? FUJI;
  const account = privateKeyToAccount(opts.privateKey);
  const caip2 = network(d.chainId).caip2;
  const client = x402Client.fromConfig({
    schemes: [{ network: caip2, client: new ExactEvmScheme(account) }],
    spendControls: {
      allowedAssets: [
        { network: caip2, asset: d.paymentToken, maxAmountPerPayment: (opts.maxAmountPerPayment ?? 100_000n).toString() },
      ],
    },
  });
  client.onAfterPaymentCreation(async (ctx) => {
    const req = ctx.selectedRequirements;
    opts.onPayment?.(req.extra?.carbon as CarbonExtra | undefined, req.amount);
  });
  const paying = wrapFetchWithPayment(fetch, client);
  return {
    address: account.address,
    fetch: (input: string | URL, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      if (opts.agentId) headers.set(AGENT_ID_HEADER, opts.agentId.toString());
      return paying(input, { ...init, headers });
    },
  };
}

/** Decode the PAYMENT-RESPONSE header (base64 JSON) returned after settlement. */
export function settlementFrom(res: Response): { transaction?: string; payer?: string; success?: boolean } | null {
  const h = res.headers.get("payment-response") ?? res.headers.get("x-payment-response");
  if (!h) return null;
  try {
    return JSON.parse(Buffer.from(h, "base64").toString("utf8"));
  } catch {
    return null;
  }
}
