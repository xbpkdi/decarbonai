import { serve } from "@hono/node-server";
import { isAddress, type Address, type Hex } from "viem";
import { loadDeployment } from "@decarbonai/chain/node";
import { createApp } from "./app.ts";
import { accrualDbPath, foreignSecrets } from "./env.ts";

// B1: the API server only ever holds the METER_ROLE key. No fallback to deployer/admin keys, and it refuses
// to run in an environment that contains one.
const foreign = foreignSecrets(process.env);
if (foreign.length) {
  console.error(`Refusing to start: the API may only hold METER_PRIVATE_KEY, but the environment also has ${foreign.join(", ")}.`);
  process.exit(1);
}
const meterKey = process.env.METER_PRIVATE_KEY as Hex | undefined;
const payTo = process.env.PAY_TO_ADDRESS;
if (!meterKey || !payTo || !isAddress(payTo)) {
  console.error("Set METER_PRIVATE_KEY (METER_ROLE-only key) and PAY_TO_ADDRESS (merchant payTo wallet).");
  process.exit(1);
}
const port = Number(process.env.PORT || 4021);
const deployment = loadDeployment();
const { app, meter, preflight } = createApp({
  deployment,
  meterKey,
  payTo: payTo as Address,
  dbPath: accrualDbPath(deployment),
  facilitatorUrl: process.env.X402_FACILITATOR_URL || undefined,
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
