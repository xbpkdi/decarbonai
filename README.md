# DecarbonAI: carbon-metered x402 on Avalanche

Every paid agent call carries its own carbon. DecarbonAI is an x402 middleware for Avalanche. For each AI call it:

1. estimates the gCO₂e;
2. folds a carbon surcharge into the same x402 payment;
3. settles it into an on-chain **RetirementPool**.

Once an agent has accrued 1 kg, the pool retires DCO2 credits and mints the agent a **soulbound receipt** (ERC-5192). When the burned lot is backed by a real off-chain retirement, it also writes **"carbon-settled" feedback to the agent's ERC-8004 reputation**. No human in the loop.

**Web:** https://decarbonai.vercel.app

## Acknowledgments

Built for [Protocol Camp](https://www.protocolcamp.com) and Team1 Builders Demo Day (Bangkok, 28 Nov 2026).

**Group Member**
From Team1 Thailand

- [@ktsukixb](https://x.com/ktsukixb)
- [@101beere](https://x.com/101beere)

## How it works

```mermaid
sequenceDiagram
  participant A as Agent (Claude via MCP)
  participant API as Paid API + x402-carbon
  participant Q as Durable queue (SQLite)
  participant F as PayAI facilitator
  participant P as RetirementPool
  participant R as ERC-8004 Reputation
  A->>API: GET /v1/infer?model=…
  API-->>A: 402 · price = $0.01 + carbon surcharge, extra.carbon = {mgCO2e, methodologyHash}
  A->>API: retry with EIP-3009 signature
  API->>F: verify + settle (facilitator pays gas, funds go to payTo)
  API->>Q: insert accrual (before responding)
  API-->>A: 200 completion + carbon breakdown
  Q->>P: meter: accrueBatch([...]) every ~2 s; pool pulls surcharges from payTo
  Note over P: pending ≥ 1 kg → burn DCO2 lot, mint soulbound CarbonReceipt
  P->>R: backed lot only: giveFeedback(agentId, kg, "carbon-settled") via adapter
```

1. **Meter.** `packages/core` estimates mgCO₂e from model and tokens (v0 factor set). The factor set is hashed (`METHODOLOGY_HASH`) and registered on-chain, and every accrual carries that hash.
2. **Price.** `@decarbonai/x402-carbon` sets a dynamic x402 price: `base + ceil(mgCO₂e × pricePerTonne / 1e9)`. It puts the carbon terms in `PaymentRequirements.extra.carbon`, so the payer sees them before signing.
   - **Fail closed:** before quoting, the middleware checks that the pool is unpaused, the methodology is active, the meter has gas, payTo's allowance is in place and the queue backlog is small. Otherwise it returns **503**, never a surcharge it can't settle.
3. **Settle.** PayAI (`https://facilitator.payai.network`) settles the EIP-3009 transfer to the merchant's **payTo** wallet. The accrual is then written **durably** to a SQLite queue before the API responds.
   - The meter worker drains the queue into `RetirementPool.accrueBatch` (about 50k gas per call).
   - The pool pulls the summed surcharge from payTo (`surchargeFunder`).
   - `paymentId = keccak256(chainId, token, payer, eip3009Nonce)` is deduplicated on-chain, and resent batches skip ids already seen.
   - Restarts, a paused pool, an empty meter wallet or an RPC failure never drop an accrual. Rows retry with backoff, and `npm run reconcile` checks every row against `paymentSeen`.
4. **Retire.** For each payer, every `thresholdMg` (1 kg) the pool burns DCO2 and mints a soulbound `CarbonReceipt`. The receipt records the lot, the per-batch surcharge, the call count and whether the lot is **backed**.
   - The agent is linked only if the payer owns, or is the registered wallet of, the ERC-8004 agent. This is checked on-chain against the identity registry.
   - "carbon-settled" feedback is written **only when a backed lot is burned**. If the reputation call fails, `retryFeedback(receiptId)` replays it.

## Roles (no single hot key)

| Role | Holds | Can | Fuji | Mainnet |
|---|---|---|---|---|
| Admin | pool `DEFAULT_ADMIN` (2-step, `AccessControlDefaultAdminRules`), owner of DCO2 / CarbonReceipt / adapter (`Ownable2Step`) | config, methodology, mint lots, rescue | deployer EOA | **Safe multisig**, accepts the hand-off |
| Treasury | `TREASURY_ROLE` | `withdraw` surcharge USDC | = admin | Safe |
| Pauser | `PAUSER_ROLE` | pause | = admin | Safe |
| Meter | `METER_ROLE` **only** | `accrue` / `accrueBatch` | `0x0018…A20E` | own key on the API server |
| payTo | nothing on-chain; approves the pool | receives x402 revenue; funds surcharges | `0x47CE…AaFcD` | own key or Safe |

- The API refuses to start if its key holds any admin, treasury or pauser right, or if `surchargeFunder(meter) != PAY_TO_ADDRESS`.
- A compromised meter can't touch pool funds. It is also bounded by:
  - `maxMgPerAccrual` (100 kg);
  - a rolling `maxMgPerDay` (1 t);
  - an immutable price floor (`minPricePerTonne`, $1/t);
  - the on-chain agent-link check.
- `CarbonReceipt.minter` is set once and can never be re-pointed.

## Deployed on Avalanche Fuji (chainId 43113)

All contracts are verified on Routescan/Snowtrace. Source of truth: [`deployments/fuji.json`](deployments/fuji.json).

| Contract | Address |
|---|---|
| RetirementPool | [`0x36Ac70DFcC1c0CEA0490cC591910C590eF095fb6`](https://testnet.snowtrace.io/address/0x36Ac70DFcC1c0CEA0490cC591910C590eF095fb6) |
| CarbonReceipt (ERC-721 + ERC-5192 soulbound) | [`0xe000b3a0C7774Aa55bD7831eb81d7d3C2e671305`](https://testnet.snowtrace.io/address/0xe000b3a0C7774Aa55bD7831eb81d7d3C2e671305) |
| DCO2 (ERC-1155, **testnet mock**) | [`0x0090b2D054E879B9Fc7F42b0931B01b07DFb4E5c`](https://testnet.snowtrace.io/address/0x0090b2D054E879B9Fc7F42b0931B01b07DFb4E5c) |
| ERC8004ReputationAdapter | [`0xFEA0a65c97556f2048C40692fa955C5e6Fa88c3C`](https://testnet.snowtrace.io/address/0xFEA0a65c97556f2048C40692fa955C5e6Fa88c3C) |
| TestUSDC (tUSDC, EIP-3009, faucet) | [`0xEe3aF37B5af84cDd20e7488F30Ea0b691bA20252`](https://testnet.snowtrace.io/address/0xEe3aF37B5af84cDd20e7488F30Ea0b691bA20252) |
| ERC-8004 Reputation / Identity (external) | [`0x8004B663…8713`](https://testnet.snowtrace.io/address/0x8004B663056A597Dffe9eCcC1965A193B7388713) / [`0x8004A818…BD9e`](https://testnet.snowtrace.io/address/0x8004A818BFB912233c491871b3d84c89A494BD9e) |

- Config: threshold 1 kg, price $25/t (floor $1/t), daily cap 1 t, methodology `v0-2026-08-anchored` = `0x50316f9e…e677`.
- Demo agent: `0x254E5C3cF3e6B90D14F6fC182F167764B8C183bB`, ERC-8004 agent **#360**.
- Superseded deployments, all **paused**:
  - pool `0x4c6c…7252`: its lot cited a Carbonmark test retirement;
  - pool `0x7818…Eef0`: the pre-review build.

### Credit supply

- **Fuji: DCO2 is a testnet mock**, not backed by a real tonne. Its name is "DecarbonAI DCO2 (testnet mock, not backed by a real tonne)" and its symbol is `mockDCO2`. Lots are flagged `backed = false`, receipts say MOCK, and **no ERC-8004 feedback is written** for them.
- **Mainnet: DCO2 is a custodial v0 credit** ("DecarbonAI Carbon Tonne (custodial v0)", `DCO2`, `backedToken = true`).
  - The owner (Safe) retires real credits off-chain (Carbonmark on Base), then mints exactly that quantity in kg.
  - Each lot records: registry, project, serial, vintage, the Carbonmark certificate URL and the source retirement tx.
  - The contract rejects a backed lot without a certificate and retirement tx, and refuses to reuse a serial or retirement tx.
  - Holders trust the custodian for the 1:1 claim; the proof links are public. See [`docs/MAINNET.md`](docs/MAINNET.md).

### Payment token

Circle's Fuji USDC (`0x5425…Bc65`) is only available from a captcha faucet, so Fuji uses **TestUSDC**: a faucet ERC-20 with EIP-3009, which PayAI settles like USDC. Mainnet uses Circle USDC (`0xB97E…8a6E`).

## Repo layout

| Path | What |
|---|---|
| `packages/contracts` | Foundry project: `RetirementPool`, `CarbonReceipt`, `DCO2`, `ERC8004ReputationAdapter`, `TestUSDC`, deploy script, unit + fuzz tests. (`CertificateReceipt` is the v1 contract, kept for its existing deployment.) |
| `packages/core` | Emission factors (v0), per-call estimate, methodology hash. |
| `packages/chain` | ABIs, deployments, network config, typed read helpers for the UI: `getPoolState`, `getAccount`, `getAgentBadge`, `getReceipt`, `getLot`, `listAccruals`, `listRetirements`. |
| `packages/x402-carbon` | Hono middleware `carbonPayment()`, durable `AccrualStore` + `CarbonMeter` worker, pricing, `createPayingFetch()` client. |
| `packages/mcp-server` | stdio MCP server for Claude: `paid_inference`, `carbon_status`, `estimate_carbon`, with per-call and per-session budgets. |
| `apps/paid-api` | Demo paid endpoint `GET /v1/infer` (simulated completion; the payment and carbon path are real), rate limited. |
| `apps/web` | Next.js UI (Live, Agent, Receipts, Developers, Methodology) reading the Fuji pool. The v1 estimate/checkout flow and `POST /api/offset` are removed. |
| `scripts/` | `setup-agent.ts`, `setup-merchant.ts`, `demo-burst.ts`, `smoke-fuji.ts`, `reconcile.ts`, `gen-abis.mjs`, `env.ts` (per-role keys). |

## Run it

```bash
npm ci
cp .env.example .env   # one key per role: FUJI_PRIVATE_KEY (admin), METER_PRIVATE_KEY, PAY_TO_PRIVATE_KEY, AGENT_PRIVATE_KEY
npm run setup:merchant # gas for meter + payTo, payTo approves the pool, prints the role layout
npm run setup:agent    # agent gas + 1000 tUSDC + ERC-8004 identity -> add AGENT_ID to .env
npm run smoke:fuji     # pre-demo health check: wiring, role separation, supply, facilitator, one real paid call
npm run demo:burst     # 100 paid calls, watch the pool fill and auto-retire (args: [calls] [concurrency])
npm run reconcile      # every settled surcharge is on-chain (ACCRUAL_DB=… to point at the API's queue)
```

Run the API and let Claude pay for itself:

```bash
METER_PRIVATE_KEY=… PAY_TO_ADDRESS=0x… npm run api   # http://localhost:4021, queue in apps/paid-api/.data/
claude mcp add decarbonai -- node --env-file=$PWD/.env $PWD/packages/mcp-server/src/server.ts
# then ask Claude: "use paid_inference to ask reasoning-heavy about x402, then show carbon_status"
```

Contracts:

```bash
cd packages/contracts
forge test                               # 67 tests incl. fuzz; 100% lines of src
forge coverage --report summary --no-match-coverage '(test|script)/'
# deploy (writes deployments/fuji.json)
METER_ADDRESS=0x… PAY_TO_ADDRESS=0x… PAYMENT_TOKEN=0xEe3aF37B5af84cDd20e7488F30Ea0b691bA20252 \
METHODOLOGY_HASH=0x50316f9e7beab6cf0a7448d957b7df5f08b46b2625cb05a270208de18de3e677 METHODOLOGY_VERSION=v0-2026-08-anchored \
forge script script/Deploy.s.sol:Deploy --rpc-url $FUJI_RPC_URL --broadcast --slow --verify \
  --verifier etherscan --verifier-url https://api.routescan.io/v2/network/testnet/evm/43113/etherscan --etherscan-api-key verifyContract
npm run contracts:abis                   # regenerate packages/chain/src/abis.ts
```

## Events the UI reads

| Contract | Event |
|---|---|
| RetirementPool | `CarbonAccrued(bytes32 indexed paymentId, address indexed payer, uint256 indexed agentId, uint256 mgCO2e, uint256 surcharge, bytes32 methodologyHash, uint256 pendingMg)` |
| RetirementPool | `Retired(uint256 indexed receiptId, address indexed payer, uint256 indexed agentId, uint256 lotId, uint256 mgCO2e, uint64 accrualCount)` |
| RetirementPool | `AccrualSkipped`, `RetirementDeferred`, `AgentLinked`, `AgentLinkRejected`, `ReputationRecorded`, `ReputationFailed`, `MethodologySet`, `LotAdded`, `ThresholdSet`, `PriceSet`, `LimitsSet(maxMgPerAccrual, maxMgPerDay, maxRetirementsPerCall)`, `ReputationSet`, `SurchargeFunderSet`, `Withdrawn`, `Rescued`, plus the OZ `DefaultAdmin*` and `Paused` events |
| CarbonReceipt | `Transfer` (mint), `Locked(tokenId)` (ERC-5192). Views: `retirement(id)` (incl. `surcharge`, `backed`) and an on-chain `tokenURI` |
| DCO2 | `LotMinted(lotId, to, serial, quantityKg, backed)`, `Retired(lotId, from, mgCO2e)`, `TransferSingle`. View: `lot(id)` with full provenance |
| ERC8004ReputationAdapter | `CarbonFeedbackGiven(agentId, receiptId, mgCO2e)`; the registry emits `NewFeedback` |
| TestUSDC | `AuthorizationUsed(payer, nonce)`: maps a `paymentId` to its x402 settlement tx |

The public Fuji RPC limits `eth_getLogs` to 100 blocks, so `packages/chain` reads logs from the Routescan API by default (`{ source: "rpc" }` to use a node).

## Known limits

- **Fuji DCO2 is a mock** (above). Mainnet lots will be custodial v0: trust in the owner's 1:1 mint, with public proof links.
- **Trusted, bounded meter.** The pool cannot see the x402 transfer, so `METER_ROLE` reports usage. It is capped per accrual and per day, priced above a floor, and can never move pool funds; `paymentId` dedupe stops double counting.
- **Estimates are v0 factors** (`packages/core`), not EcoLogits yet, and are priced from declared `maxOutputTokens` before the call runs.
- **Simulated completion.** The demo API returns placeholder text. The payment, carbon accrual and retirement are real transactions.
- **Single-instance queue.** The SQLite queue is per API instance. Running several instances needs a shared store (Postgres); on-chain dedupe keeps double submits harmless.
- **Surcharge at $25/t is tiny** (≈ $0.0006 for a 22 g call). The economics depend on batching (≈ 50k gas per call) and a base price that covers it.

## Mainnet

Prepared but **not deployed**. [`docs/MAINNET.md`](docs/MAINNET.md) has the roles, costs and runbook. Every TS entry point selects the network with `DECARBONAI_NETWORK=fuji|avalanche`.

## v1 (legacy)

v1 retired Carbonmark credits on Base from a web checkout and mirrored a receipt to `CertificateReceipt` on Fuji ([`0x9dd6…7cc1`](https://testnet.snowtrace.io/address/0x9dd6ae803cab0bd07b4cbc09fab3bc30f7357cc1)). Its `POST /api/offset` spent real credits with no auth. That route, the v1 pages and the local `.data` certificate store were removed; old `/certificate/…` links show a notice.
