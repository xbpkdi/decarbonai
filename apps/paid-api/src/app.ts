import { Hono } from "hono";
import type { Address, Hex } from "viem";
import { explorerFor, network, retirementPoolAbi, type Deployment } from "@decarbonai/chain";
import { clientFor, loadDeployment, rpcUrlFor } from "@decarbonai/chain/node";
import { AccrualStore, CarbonMeter, carbonPayment, type CarbonVariables } from "@decarbonai/x402-carbon";
import { rateLimit } from "./ratelimit.ts";

export type AppConfig = {
  meterKey: Hex; // METER_ROLE only. Never an admin/treasury/deployer key.
  payTo: Address; // merchant wallet receiving x402 revenue; the pool pulls surcharges from it
  dbPath: string; // durable accrual queue (SQLite), ":memory:" in tests
  baseAmount?: bigint; // default 10_000 = $0.01
  facilitatorUrl?: string;
  rpcUrl?: string;
  deployment?: Deployment; // default: DECARBONAI_NETWORK (fuji)
  rateLimitPerMinute?: number; // per client, default 120
  trustProxy?: boolean;
};

const json = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

/** Stand-in for a model call. The point of the demo is the payment + carbon path, not the text. */
function simulatedCompletion(model: string, prompt: string, maxOutputTokens: number) {
  const words = ["carbon", "metered", "agent", "settles", "on", "Avalanche", "via", "x402"];
  const n = Math.min(maxOutputTokens, 24);
  return `[simulated ${model}] ${prompt.slice(0, 80)} → ${Array.from({ length: n }, (_, i) => words[i % words.length]).join(" ")}`;
}

export function createApp(cfg: AppConfig) {
  const d = cfg.deployment ?? loadDeployment();
  const rpcUrl = cfg.rpcUrl ?? rpcUrlFor(d);
  const client = clientFor(d, rpcUrl);
  const store = new AccrualStore(cfg.dbPath);
  const meter = new CarbonMeter(client, cfg.meterKey, d, { store, rpcUrl });
  const explorer = explorerFor(d.chainId);
  const app = new Hono<{ Variables: CarbonVariables }>();

  /**
   * B1 guard: refuse to run with a key that can do more than meter, or with a payTo the pool does
   * not pull surcharges from. Call before serving.
   */
  async function preflight(): Promise<void> {
    if (cfg.payTo.toLowerCase() === meter.address.toLowerCase()) {
      throw new Error("PAY_TO_ADDRESS must differ from the meter wallet");
    }
    const pool = { address: d.retirementPool, abi: retirementPoolAbi } as const;
    const [meterRole, treasuryRole, pauserRole, admin, funder] = await Promise.all([
      client.readContract({ ...pool, functionName: "METER_ROLE" }),
      client.readContract({ ...pool, functionName: "TREASURY_ROLE" }),
      client.readContract({ ...pool, functionName: "PAUSER_ROLE" }),
      client.readContract({ ...pool, functionName: "defaultAdmin" }),
      client.readContract({ ...pool, functionName: "surchargeFunder", args: [meter.address] }),
    ]);
    const [isMeter, isTreasury, isPauser] = await Promise.all(
      [meterRole, treasuryRole, pauserRole].map((role) =>
        client.readContract({ ...pool, functionName: "hasRole", args: [role, meter.address] }),
      ),
    );
    if (!isMeter) throw new Error(`meter ${meter.address} lacks METER_ROLE`);
    if (isTreasury || isPauser || admin.toLowerCase() === meter.address.toLowerCase()) {
      throw new Error("meter key holds admin/treasury/pauser rights on the pool; use a METER_ROLE-only key");
    }
    if (funder.toLowerCase() !== cfg.payTo.toLowerCase()) {
      throw new Error(`pool.surchargeFunder(meter) is ${funder}, expected PAY_TO_ADDRESS ${cfg.payTo}`);
    }
  }

  app.get("/health", async (c) => {
    const h = await meter.health();
    return c.json(
      json({ ok: h.ok, reasons: h.reasons, network: network(d.chainId).caip2, pool: d.retirementPool, payTo: cfg.payTo, queue: store.counts() }),
      h.ok ? 200 : 503,
    );
  });

  const limiter = rateLimit({ perMinute: cfg.rateLimitPerMinute ?? 120, trustProxy: cfg.trustProxy });
  app.use("/v1/*", limiter);
  app.use("/carbon/*", limiter);

  app.use(
    "/v1/infer",
    carbonPayment({
      route: "GET /v1/infer",
      description: d.dco2Backed
        ? "Paid LLM inference with a carbon surcharge settled into the DecarbonAI pool on Avalanche"
        : "Paid LLM inference with a carbon surcharge settled into the DecarbonAI pool on Avalanche Fuji (testnet; DCO2 is a mock credit)",
      payTo: cfg.payTo,
      baseAmount: cfg.baseAmount ?? 10_000n,
      meter,
      deployment: d,
      facilitatorUrl: cfg.facilitatorUrl,
    }),
  );

  app.get("/v1/infer", (c) => {
    const q = c.get("carbon");
    return c.json(
      json({
        model: q.model,
        completion: simulatedCompletion(q.model, c.req.query("prompt") ?? "", q.outputTokens),
        carbon: {
          gCO2e: Number(q.mgCO2e) / 1000,
          mgCO2e: q.mgCO2e,
          surchargeUnits: q.surcharge,
          baseUnits: q.baseAmount,
          totalUnits: q.total,
          methodology: { version: q.methodologyVersion, hash: q.methodologyHash },
          pool: explorer.address(d.retirementPool),
          credit: d.dco2Backed ? "DCO2 (custodial v0, backed by off-chain retirements)" : "DCO2 testnet mock (not backed)",
        },
      }),
    );
  });

  // Free: settlement status of a payment (by paymentId or x402 settlement tx). No error details.
  app.get("/carbon/accruals/:id", (c) => {
    const id = c.req.param("id");
    if (!/^0x[0-9a-fA-F]{64}$/.test(id)) return c.json({ error: "bad id" }, 400);
    const r = meter.get(id as Hex);
    if (!r) return c.json({ error: "unknown payment" }, 404);
    return c.json(json({ ...r, explorer: r.txHash ? explorer.tx(r.txHash) : null }));
  });

  return { app, meter, store, preflight };
}

export type { Address };
