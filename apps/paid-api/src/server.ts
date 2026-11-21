import { serve } from "@hono/node-server";
import { isAddress, type Address, type Hex } from "viem";
import { createApp } from "./app.ts";

// B1: the API server only ever holds the METER_ROLE key. No fallback to deployer/admin keys.
const meterKey = process.env.METER_PRIVATE_KEY as Hex | undefined;
const payTo = process.env.PAY_TO_ADDRESS;
if (!meterKey || !payTo || !isAddress(payTo)) {
  console.error("Set METER_PRIVATE_KEY (METER_ROLE-only key) and PAY_TO_ADDRESS (merchant payTo wallet).");
  process.exit(1);
}
const port = Number(process.env.PORT ?? 4021);
const { app, meter, preflight } = createApp({
  meterKey,
  payTo: payTo as Address,
  dbPath: process.env.ACCRUAL_DB ?? ".data/accruals.sqlite",
  facilitatorUrl: process.env.X402_FACILITATOR_URL,
  baseAmount: process.env.BASE_PRICE_UNITS ? BigInt(process.env.BASE_PRICE_UNITS) : undefined,
  rateLimitPerMinute: process.env.RATE_LIMIT_PER_MINUTE ? Number(process.env.RATE_LIMIT_PER_MINUTE) : undefined,
  trustProxy: process.env.TRUST_PROXY === "1",
});

await preflight();
await meter.recover(); // resolve accruals left in flight by a previous run
meter.start();
serve({ fetch: app.fetch, port }, () => {
  console.log(`paid-api on http://localhost:${port}  meter=${meter.address} payTo=${payTo}`);
});
const shutdown = () => {
  meter.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
