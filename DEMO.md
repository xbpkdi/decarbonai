# Demo script (Team1 Builders Demo Day, ~3 min)

Before going on stage: `npm run smoke:fuji` (all checks must pass) and start `npm run api`.

1. **Problem, one line.** Agents pay per call over x402; nobody prices the carbon of the call. A single call is 0.03–20 g, so it has to be metered and pooled, not offset per prompt.
2. **Claude pays for itself.** In Claude Code with the `decarbonai` MCP server: "use paid_inference with reasoning-heavy to explain x402". Show the reply: `$0.0100 + $0.0006 carbon`, `22 gCO2e`, the Snowtrace settlement link (PayAI facilitator, Fuji).
3. **Burst.** `npm run demo:burst` (100 calls, ~45 s). The pool line ticks up per 10 calls; at 1 kg the pool burns DCO2 and mints a soulbound receipt. End state shows receipts with Snowtrace links.
4. **Reputation.** "show carbon_status": ERC-8004 agent #360 now has `carbon-settled` feedback from our adapter, readable by any other agent before it hires this one.
5. **Honesty slide.** DCO2 is a testnet mock (custodial-bridge fields ready for a real tonne); the meter is trusted in v0; factors are v0, EcoLogits next. Business: inference gateways that owe customers Scope 3 data.
