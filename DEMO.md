# Demo script (Team1 Builders Demo Day, ~3 min)

Before going on stage: `npm run smoke:fuji` (all checks must pass) and wake the hosted API (Render free sleeps after 15 min idle): open `<api>/health` or the site's Developers page about 2 min before, then press Run once. Local alternative: `npm run api`.

Keep-warm: `.github/workflows/keep-render-warm.yml` pings `/health` and `/developers` every 10 min until after Demo Day (28 Nov 2026); disable it in Actions afterwards.

1. **Problem, one line.** Agents pay per call over x402; nobody prices the carbon of the call. A single call is 0.03–20 g, so it has to be metered and pooled, not offset per prompt.
2. **Claude pays for itself.** In Claude Code with the `decarbonai` MCP server: "use paid_inference with reasoning-heavy to explain x402". Show the reply: `$0.0100 + $0.0006 carbon`, `22 gCO2e`, the Snowtrace settlement link (PayAI facilitator, Fuji).
3. **Burst.** `npm run demo:burst` (100 calls, ~45 s). The pool line ticks up per 10 calls; at 1 kg the pool burns DCO2 and mints a soulbound receipt. End state shows receipts with Snowtrace links.
4. **Reputation.** "show carbon_status": the agent's calls, grams and receipts. The pool writes `carbon-settled` ERC-8004 feedback only for a backed lot, so on Fuji (mock lot) it writes none; the 3 entries on agent #360 come from a superseded adapter.
5. **Honesty slide.** DCO2 is a testnet mock (custodial-bridge fields ready for a real tonne); the meter is trusted in v0; factors are v0, EcoLogits next. Business: inference gateways that owe customers Scope 3 data.
