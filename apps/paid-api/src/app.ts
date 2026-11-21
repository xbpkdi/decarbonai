import { Hono } from "hono";
import type { Address, Hex } from "viem";
import { FUJI, explorer, fujiClient } from "@decarbonai/chain";
import { CarbonMeter, carbonPayment, type CarbonVariables } from "@decarbonai/x402-carbon";

export type AppConfig = {
  meterKey: Hex;
  baseAmount?: bigint; // default 10_000 = $0.01
  facilitatorUrl?: string;
  rpcUrl?: string;
};

const json = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

/** Stand-in for a model call. The point of the demo is the payment + carbon path, not the text. */
function simulatedCompletion(model: string, prompt: string, maxOutputTokens: number) {
  const words = ["carbon", "metered", "agent", "settles", "on", "Avalanche", "via", "x402"];
  const n = Math.min(maxOutputTokens, 24);
  return `[simulated ${model}] ${prompt.slice(0, 80)} → ${Array.from({ length: n }, (_, i) => words[i % words.length]).join(" ")}`;
}

export function createApp(cfg: AppConfig) {
  const client = fujiClient(cfg.rpcUrl);
  const meter = new CarbonMeter(client, cfg.meterKey, FUJI, cfg.rpcUrl);
  const app = new Hono<{ Variables: CarbonVariables }>();

  app.get("/health", (c) =>
    c.json({ ok: true, network: "avalanche-fuji", pool: FUJI.retirementPool, payTo: meter.address }),
  );

  app.use(
    "/v1/infer",
    carbonPayment({
      route: "GET /v1/infer",
      description: "Paid LLM inference with a carbon surcharge settled into the DecarbonAI pool on Avalanche Fuji",
      payTo: meter.address,
      baseAmount: cfg.baseAmount ?? 10_000n,
      meter,
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
          pool: explorer.address(FUJI.retirementPool),
        },
      }),
    );
  });

  // Free: status of the pool accrual for a settled payment (paymentId = paymentIdOf(...), see x402-carbon).
  app.get("/carbon/accruals/:paymentId", (c) => {
    const id = c.req.param("paymentId").toLowerCase();
    const r = meter.get(id as Hex) ?? meter.list().find((x) => x.settlementTx.toLowerCase() === id);
    if (!r) return c.json({ error: "unknown payment" }, 404);
    return c.json(json({ ...r, explorer: r.txHash ? explorer.tx(r.txHash) : null }));
  });

  return { app, meter };
}

export type { Address };
