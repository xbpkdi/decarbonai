import { serve } from "@hono/node-server";
import type { Hex } from "viem";
import { createApp } from "./app.ts";

const mainnet = process.env.DECARBONAI_NETWORK === "avalanche";
const meterKey = (process.env.METER_PRIVATE_KEY ?? (mainnet ? process.env.MAINNET_PRIVATE_KEY : process.env.FUJI_PRIVATE_KEY)) as
  | Hex
  | undefined;
if (!meterKey) {
  console.error("Set METER_PRIVATE_KEY (or FUJI_/MAINNET_PRIVATE_KEY): the wallet with METER_ROLE on the RetirementPool.");
  process.exit(1);
}
const port = Number(process.env.PORT ?? 4021);
const { app, meter } = createApp({
  meterKey,
  facilitatorUrl: process.env.X402_FACILITATOR_URL,
  baseAmount: process.env.BASE_PRICE_UNITS ? BigInt(process.env.BASE_PRICE_UNITS) : undefined,
});

const approval = await meter.ensureAllowance();
if (approval) console.log(`approved pool to pull surcharges: ${approval}`);
serve({ fetch: app.fetch, port }, () => {
  console.log(`paid-api on http://localhost:${port}  payTo/meter=${meter.address}`);
});
