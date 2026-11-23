import type { Context, MiddlewareHandler } from "hono";
import { every } from "hono/combine";
import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";
import { HTTPFacilitatorClient, x402ResourceServer, type HTTPRequestContext } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware } from "@x402/hono";
import { FUJI, network, tokenDomain, type Deployment } from "@decarbonai/chain";
import { carbonQuote, usageFromQuery, type CarbonQuote, type Usage } from "./pricing.ts";
import type { CarbonMeter } from "./meter.ts";

export const FUJI_NETWORK = "eip155:43113" as const;
export const AVALANCHE_NETWORK = "eip155:43114" as const;
export const PAYAI_FACILITATOR = "https://facilitator.payai.network";
export const AGENT_ID_HEADER = "x-agent-id";

export type CarbonPaymentOptions = {
  /** METHOD + path pattern, e.g. "GET /v1/infer". */
  route: string;
  description: string;
  payTo: Address; // merchant wallet; the pool pulls surcharges from it (pool.surchargeFunder(meter))
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
 * After the facilitator settles, the accrual (paymentId = paymentIdOf(chain, token, payer, EIP-3009
 * nonce)) is queued durably; the meter settles it into the RetirementPool, which pulls the surcharge
 * from the payTo wallet and auto-retires DCO2 per payer.
 */
export function carbonPayment(opts: CarbonPaymentOptions): MiddlewareHandler<{ Variables: CarbonVariables }> {
  const d = opts.deployment ?? FUJI;
  const caip2 = network(d.chainId).caip2;
  const asset = opts.asset ?? { address: d.paymentToken, ...tokenDomain(d.chainId, d.paymentToken) };
  const pricePerTonne = BigInt(d.pricePerTonne);
  const parseUsage = opts.usage ?? usageFromQuery;

  const quoteFor = (q: (n: string) => string | undefined) => carbonQuote(parseUsage(q), opts.baseAmount, pricePerTonne);

  const server = new x402ResourceServer(
    new HTTPFacilitatorClient({ url: opts.facilitatorUrl ?? PAYAI_FACILITATOR }),
  ).register(caip2, new ExactEvmScheme());

  type Authorization = { from: Address; nonce: Hex; validBefore: string };
  const paymentOf = (requirements: { asset: string; extra?: Record<string, unknown> }, payload: unknown) => {
    const c = requirements.extra?.carbon as CarbonExtra | undefined;
    const auth = (payload as { authorization?: Authorization }).authorization;
    if (!c || !auth) return undefined;
    const accrual = {
      paymentId: paymentIdOf(d.chainId, requirements.asset as Address, auth.from, auth.nonce),
      payer: auth.from,
      agentId: BigInt(c.agentId),
      mgCO2e: BigInt(c.mgCO2e),
      surcharge: BigInt(c.surcharge),
      methodologyHash: c.methodologyHash,
    };
    return { auth, accrual };
  };

  // Write-ahead: a settle response we never get must not hide a charged payment. If this throws, x402 core
  // aborts before calling the facilitator and nobody is charged.
  server.onBeforeSettle(async (ctx) => {
    const p = paymentOf(ctx.requirements, ctx.paymentPayload.payload);
    if (!p) return;
    await opts.meter.openIntent({
      ...p.accrual,
      nonce: p.auth.nonce,
      asset: ctx.requirements.asset as Address,
      payTo: ctx.requirements.payTo as Address,
      amount: BigInt(ctx.requirements.amount),
      validBefore: Number(p.auth.validBefore),
    });
  });

  // Durable: the accrual is written to the meter's SQLite queue before the response goes out.
  server.onAfterSettle(async (ctx) => {
    const p = paymentOf(ctx.requirements, ctx.paymentPayload.payload);
    if (!p || !ctx.result.success) return;
    opts.meter.enqueue({ ...p.accrual, settlementTx: ctx.result.transaction as Hex });
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
    // Fail closed: never quote a carbon surcharge the pool cannot settle right now.
    const health = await opts.meter.health();
    if (!health.ok) {
      return c.json({ error: "carbon settlement unavailable, try again later", reasons: health.reasons }, 503);
    }
    await next();
  };

  const pay = paymentMiddleware(
    {
      [opts.route]: {
        accepts: { scheme: "exact", network: caip2, payTo: opts.payTo, price, maxTimeoutSeconds: 120 },
        description: opts.description,
        mimeType: "application/json",
      },
    },
    server,
  );

  return every(validate, pay) as MiddlewareHandler<{ Variables: CarbonVariables }>;
}
