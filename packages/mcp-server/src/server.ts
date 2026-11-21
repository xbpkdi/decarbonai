#!/usr/bin/env node
// stdio MCP server: gives Claude a wallet-backed tool to call a paid x402 API on Avalanche Fuji.
// Every paid call carries a carbon surcharge that settles into the DecarbonAI RetirementPool, so the
// agent pays for, and retires, its own emissions with no human in the loop.
//
// Env: AGENT_PRIVATE_KEY (required), AGENT_ID (ERC-8004 id, optional), API_URL (default
// http://localhost:4021), FUJI_RPC_URL, MAX_PAYMENT_UNITS (default 100000 = $0.10 per call).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Hex } from "viem";
import { z } from "zod";
import { MODEL_IDS, METHODOLOGY_VERSION, estimateCallMgCO2e, type ModelId } from "@decarbonai/core";
import { FUJI, explorer, fujiClient, getAgentBadge, getPoolState, listRetirements, mgToKg } from "@decarbonai/chain";
import { createPayingFetch, settlementFrom } from "@decarbonai/x402-carbon/client";
import { quoteSurcharge } from "@decarbonai/x402-carbon";

const key = process.env.AGENT_PRIVATE_KEY as Hex | undefined;
if (!key) {
  console.error("AGENT_PRIVATE_KEY is required");
  process.exit(1);
}
const apiUrl = process.env.API_URL ?? "http://localhost:4021";
const agentId = process.env.AGENT_ID ? BigInt(process.env.AGENT_ID) : undefined;
const client = fujiClient();
const agent = createPayingFetch({
  privateKey: key,
  agentId,
  maxAmountPerPayment: BigInt(process.env.MAX_PAYMENT_UNITS ?? "100000"),
});

const text = (v: unknown) => ({
  content: [
    { type: "text" as const, text: JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2) },
  ],
});
const models = MODEL_IDS as [ModelId, ...ModelId[]];

const server = new McpServer({ name: "decarbonai", version: "0.2.0" });

server.registerTool(
  "paid_inference",
  {
    title: "Paid inference (x402 on Avalanche, carbon-settled)",
    description:
      "Call the paid inference API. Pays automatically over x402 on Avalanche Fuji from the agent wallet " +
      "(test USDC). The price includes a carbon surcharge for the call's estimated gCO2e, which is " +
      "settled into the DecarbonAI RetirementPool; every 1 kg the pool retires credits and mints a " +
      "soulbound receipt to this agent. Returns the completion, the carbon breakdown and Snowtrace links.",
    inputSchema: {
      prompt: z.string().min(1).max(4000),
      model: z.enum(models).default("claude-sonnet"),
      maxOutputTokens: z.number().int().min(1).max(4000).default(500),
    },
  },
  async ({ prompt, model, maxOutputTokens }) => {
    const url = new URL("/v1/infer", apiUrl);
    url.search = new URLSearchParams({ prompt, model, maxOutputTokens: String(maxOutputTokens) }).toString();
    const res = await agent.fetch(url);
    if (!res.ok) {
      return { isError: true, ...text({ status: res.status, body: await res.text() }) };
    }
    const body = await res.json();
    const s = settlementFrom(res);
    return text({
      ...body,
      payment: {
        payer: agent.address,
        settlementTx: s?.transaction ? explorer.tx(s.transaction) : null,
        network: "avalanche-fuji (eip155:43113)",
      },
    });
  },
);

server.registerTool(
  "carbon_status",
  {
    title: "Agent carbon status",
    description:
      "Read this agent's carbon account from the RetirementPool on Avalanche Fuji: calls, gCO2e accrued, " +
      "kg retired, progress to the next retirement, soulbound receipts and the ERC-8004 carbon-settled reputation.",
    inputSchema: {},
  },
  async () => {
    const [badge, pool, retirements] = await Promise.all([
      getAgentBadge(client, agent.address),
      getPoolState(client),
      listRetirements(client, { payer: agent.address }).catch(() => []),
    ]);
    return text({
      agent: agent.address,
      erc8004AgentId: badge.agentId,
      calls: badge.calls,
      accruedKg: mgToKg(badge.totalMg),
      retiredKg: mgToKg(badge.retiredMg),
      pendingKg: mgToKg(badge.pendingMg),
      progressToNextRetirement: `${(badge.progressToNextRetirement * 100).toFixed(1)}%`,
      reputation: badge.reputation,
      receipts: retirements.map((r) => ({
        receiptId: r.receiptId,
        kg: mgToKg(r.mgCO2e),
        calls: r.accrualCount,
        tx: explorer.tx(r.txHash),
      })),
      pool: {
        address: explorer.address(FUJI.retirementPool),
        totalAccruedKg: mgToKg(pool.totalAccruedMg),
        totalRetiredKg: mgToKg(pool.totalRetiredMg),
        retirements: pool.totalRetirements,
        note: "DCO2 credits are a testnet mock, not backed by a real tonne.",
      },
    });
  },
);

server.registerTool(
  "estimate_carbon",
  {
    title: "Estimate carbon for a call",
    description: "Free: estimated gCO2e and the carbon surcharge for a call, before paying.",
    inputSchema: {
      model: z.enum(models),
      inputTokens: z.number().int().min(0).max(200_000),
      outputTokens: z.number().int().min(0).max(200_000),
    },
  },
  async ({ model, inputTokens, outputTokens }) => {
    const mg = BigInt(estimateCallMgCO2e(model, inputTokens, outputTokens));
    const surcharge = quoteSurcharge(mg, BigInt(FUJI.pricePerTonne));
    return text({
      gCO2e: Number(mg) / 1000,
      surchargeUsd: Number(surcharge) / 1e6,
      pricePerTonneUsd: FUJI.pricePerTonne / 1e6,
      methodology: METHODOLOGY_VERSION,
    });
  },
);

await server.connect(new StdioServerTransport());
