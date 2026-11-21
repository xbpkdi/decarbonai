import type { Context, MiddlewareHandler } from "hono";
import { every } from "hono/combine";
import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";
import { HTTPFacilitatorClient, x402ResourceServer, type HTTPRequestContext } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware } from "@x402/hono";
import { FUJI, type Deployment } from "@decarbonai/chain";
import { carbonQuote, usageFromQuery, type CarbonQuote, type Usage } from "./pricing.ts";
import type { CarbonMeter } from "./meter.ts";

export const FUJI_NETWORK = "eip155:43113" as const;
export const PAYAI_FACILITATOR = "https://facilitator.payai.network";
export const AGENT_ID_HEADER = "x-agent-id";

export type CarbonPaymentOptions = {
  /** METHOD + path pattern, e.g. "GET /v1/infer". */
  route: string;
  description: string;
  payTo: Address; // must be the meter wallet: it forwards the surcharge to the pool
  baseAmount: bigint; // price of the API call itself, token units
  meter: CarbonMeter;
  deployment?: Deployment;
  facilitatorUrl?: string;
  asset?: { address: Address; name: string; version: string };
  /** How to read model + token usage from a request. Default: query params. */
  usage?: (q: (name: string) => string | undefined) => Usage;
};

/** Carbon terms embedded in the x402 PaymentRequirements.extra, so the payer sees them in the 402. */
export type CarbonExtra = {
  mgCO2e: string;
  surcharge: string;
  baseAmount: string;
  methodologyHash: Hex;
  methodologyVersion: string;
  agentId: string;
  pool: Address;
};

export type CarbonVariables = { carbon: CarbonQuote };

/**
 * One id per x402 payment. Facilitators (PayAI on Fuji) batch several EIP-3009 settlements into
 * one Multicall3 tx, so the tx hash is not unique per payment; the authorization nonce is.
 * The settlement tx can be found from the token's AuthorizationUsed(payer, nonce) event.
 */
export function paymentIdOf(chainId: number, asset: Address, payer: Address, nonce: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "address" }, { type: "address" }, { type: "bytes32" }],
      [BigInt(chainId), asset, payer, nonce],
    ),
  );
}

function agentIdOf(get: (name: string) => string | undefined): bigint {
  const raw = get(AGENT_ID_HEADER);
  return raw && /^\d{1,30}$/.test(raw) ? BigInt(raw) : 0n;
}

/**
 * x402 paywall for one route with a carbon surcharge folded into the same payment:
 *   total = baseAmount + ceil(mgCO2e x pricePerTonne / 1e9)
 * After the facilitator settles, the surcharge and the estimate are reported to the
 * RetirementPool (paymentId = settlement tx hash), which auto-retires DCO2 per payer.
 */
export function carbonPayment(opts: CarbonPaymentOptions): MiddlewareHandler<{ Variables: CarbonVariables }> {
  const d = opts.deployment ?? FUJI;
  const asset = opts.asset ?? { address: d.paymentToken, name: "DecarbonAI Test USDC", version: "2" };
  const pricePerTonne = BigInt(d.pricePerTonne);
  const parseUsage = opts.usage ?? usageFromQuery;

  const quoteFor = (q: (n: string) => string | undefined) => carbonQuote(parseUsage(q), opts.baseAmount, pricePerTonne);

  const server = new x402ResourceServer(
    new HTTPFacilitatorClient({ url: opts.facilitatorUrl ?? PAYAI_FACILITATOR }),
  ).register(FUJI_NETWORK, new ExactEvmScheme());

  server.onAfterSettle(async (ctx) => {
    const c = ctx.requirements.extra?.carbon as CarbonExtra | undefined;
    const auth = (ctx.paymentPayload.payload as { authorization?: { from: Address; nonce: Hex } }).authorization;
    if (!c || !ctx.result.success || !auth) return;
    void opts.meter.accrue({
      paymentId: paymentIdOf(d.chainId, ctx.requirements.asset as Address, auth.from, auth.nonce),
      settlementTx: ctx.result.transaction as Hex,
      payer: auth.from,
      agentId: BigInt(c.agentId),
      mgCO2e: BigInt(c.mgCO2e),
      surcharge: BigInt(c.surcharge),
      methodologyHash: c.methodologyHash,
    });
  });

  const price = (ctx: HTTPRequestContext) => {
    const q = (n: string) => {
      const v = ctx.adapter.getQueryParam?.(n);
      return Array.isArray(v) ? v[0] : v;
    };
    const quote = quoteFor(q);
    const extra: CarbonExtra = {
      mgCO2e: quote.mgCO2e.toString(),
      surcharge: quote.surcharge.toString(),
      baseAmount: quote.baseAmount.toString(),
      methodologyHash: quote.methodologyHash,
      methodologyVersion: quote.methodologyVersion,
      agentId: agentIdOf((n) => ctx.adapter.getHeader(n)).toString(),
      pool: d.retirementPool,
    };
    return {
      asset: asset.address,
      amount: quote.total.toString(),
      extra: { name: asset.name, version: asset.version, carbon: extra },
    };
  };

  const validate: MiddlewareHandler<{ Variables: CarbonVariables }> = async (c: Context, next) => {
    try {
      c.set("carbon", quoteFor((n) => c.req.query(n)));
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "bad request" }, 400);
    }
    await next();
  };

  const pay = paymentMiddleware(
    {
      [opts.route]: {
        accepts: { scheme: "exact", network: FUJI_NETWORK, payTo: opts.payTo, price, maxTimeoutSeconds: 120 },
        description: opts.description,
        mimeType: "application/json",
      },
    },
    server,
  );

  return every(validate, pay) as MiddlewareHandler<{ Variables: CarbonVariables }>;
}
