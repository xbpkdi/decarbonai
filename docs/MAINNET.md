# Avalanche C-Chain mainnet: prepared, NOT deployed

Nothing has been broadcast to mainnet. Deploying needs an explicit go from the owner after funding.

## Config (chainId 43114)

| Item | Value | Checked |
|---|---|---|
| Payment token | Circle USDC `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` (`USD Coin`, version `2`, EIP-3009) | on-chain `name()`/`version()` |
| ERC-8004 Identity | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | verified `IdentityRegistryUpgradeable` |
| ERC-8004 Reputation | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | verified `ReputationRegistryUpgradeable`, **same implementation bytecode as Fuji** |
| x402 facilitator | PayAI `https://facilitator.payai.network`, `exact` on `eip155:43114` | `/supported` |
| Explorer / verify | Routescan `https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan` (`foundry.toml` → `avalanche`) | |
| DCO2 | **backed (custodial v0)**: name "DecarbonAI Carbon Tonne (custodial v0)", symbol `DCO2` | `DCO2_BACKED` defaults to true on 43114 |

## Roles (review B1)

| Role | Address | Key |
|---|---|---|
| Deployer (throwaway: holds nothing after hand-off) | `0xBc889999FF5A350E7893e673d0D610D94a16B651` | local `.env` `MAINNET_PRIVATE_KEY` |
| Admin + Treasury + Pauser | **owner's Safe, 1-of-1** (owner decision 24 Nov 2026: one signer, the owner's personal wallet), `ADMIN_ADDRESS` (required; the script refuses the deployer) | the owner's personal wallet |
| Meter (`METER_ROLE` only, API server) | `0x1A96F7c923c245782c97173fCE555fDb2EC47E8c` | local `.env` `MAINNET_METER_PRIVATE_KEY` |
| payTo (x402 revenue, funds surcharges) | `0xf70CA95402f4Ee5093cd370DEC41b0AB67AD804b` (or a Safe) | local `.env` `MAINNET_PAY_TO_PRIVATE_KEY` |
| Demo agent | `0x013f46Cca6D2E88715CC64a1f247fd36a388402F` | local `.env` `MAINNET_AGENT_PRIVATE_KEY` |
| Base buyer (retires lot 1 on Base, not on Avalanche) | `0x7a98A0d9F9baA5037CaCF957dc9c8307CDD81806` | local `.env` `BASE_BUYER_PRIVATE_KEY` |

Keys rotated 24 Nov 2026: never fund the old addresses (0x644b…0B90, 0x312B…F2F7, 0xa633…2e5f, 0x4934…BF9). The five wallets above are bots: none may be an owner of the admin Safe (the deploy script and `audit:roles` refuse it).

The deploy script:

- grants `TREASURY_ROLE` and `PAUSER_ROLE` to the Safe and renounces them from the deployer;
- starts the 2-step admin transfer (`beginDefaultAdminTransfer`);
- calls `transferOwnership` on DCO2, CarbonReceipt and the adapter.

The Safe must then call:

- `pool.acceptDefaultAdminTransfer()`;
- `acceptOwnership()` on the three Ownable2Step contracts;
- optionally `pool.changeDefaultAdminDelay(2 days)`.

Until then the deployer still holds admin. The API refuses to start if its key holds any admin, treasury or pauser right.

## Credit lots (B2 decision: real credit on mainnet)

- Mainnet mints **only** lots backed by a real off-chain retirement. The deploy script requires the `LOT_FILE` of klima-retire on 43114. When a lot runs out, accruals queue up with `RetirementDeferred` until the next real lot is added.
- To add a lot after a real Carbonmark retirement on Base, the Safe calls `dco2.mintLot(pool, Lot{…})` and then `pool.addLot(id)`. The lot holds:

  | Field | Value |
  |---|---|
  | `registry` | registry name |
  | `projectId`, `projectName` | project |
  | `serial` | credit id + " / " + retirement id (the credit id alone is not unique to a purchase) |
  | `vintage` | vintage year |
  | `certificateURI` | Carbonmark retirement URL |
  | `retirementTx` | `eip155:8453:0x…` |
  | `quantityKg` | exactly the kg retired |

- `serialUsed` and `retirementUsed` stop the same retirement from backing two lots.
- "carbon-settled" ERC-8004 feedback is only written when a backed lot is burned.
- Research on the existing retirement and current Carbonmark quotes: `~/.orca/bots/new-bot/reports/carbonmark-research-b2.md`. Short version: retirement `0x6693…` is 1 t UCR-419-2023, but it was made with a **sandbox** key, its beneficiary is "test", and the paused Fuji deployment already cites it. Do not reuse it. Buy a fresh production retirement whose beneficiary is "DecarbonAI".

## Cost (simulated on a local anvil fork of mainnet, 21 Nov 2026, base fee 7.5 gwei)

| Step | Payer | Gas | AVAX @ 7.81 gwei | AVAX @ 15.3 gwei |
|---|---|---|---|---|
| Deploy + wire + role hand-off (18 txs, no lot) | deployer | 9,877,261 | 0.0771 | 0.1511 |
| Gas sent to agent for ERC-8004 `register` (297k gas) | deployer | — | 0.0100 transfer | 0.0100 transfer |
| Contract verification | — | 0 | 0 | 0 |
| **Deploy + verify + registration** | | | **≈ 0.087 AVAX** | **≈ 0.161 AVAX** |
| payTo `approve(pool)` | payTo | 56k | 0.0004 | 0.0009 |
| Safe: accept admin + 3 ownerships, mint + add first lot | Safe | ~0.6M | ≈ 0.005 | ≈ 0.009 |
| 100 paid calls, batched (~50k gas/call + ~600k per backed retirement) | meter | ~6.2M | ≈ 0.048 | ≈ 0.095 |

**Fund:**

| Wallet | Amount |
|---|---|
| Deployer | **0.25 AVAX** |
| Meter | **0.15 AVAX** |
| payTo | **0.01 AVAX** |
| Safe signer (owner's personal wallet) | ~0.01 AVAX |
| Agent | **~$5 USDC** (100 calls ≈ $1.06) |

The x402 facilitator pays settlement gas. The cost of the first real tonne itself is in the research report: the Carbonmark API needs a $50 minimum card top-up, while the x402 retire endpoint takes about $0.10 USDC on Base.

## Runbook (after "go")

The step-by-step runbook (funding, commands, checks) is kept with the owner, outside the repo. The order is fixed:

1. Safe on C-Chain: 1 owner (the owner's personal wallet), threshold 1. The deploy script refuses an EOA, threshold 0, a 1-of-N Safe with N > 1, and any bot wallet as owner. Trade-off: one lost or compromised personal wallet is full admin (pool admin, treasury, pauser, all three contract owners), with no second signer to stop it.
2. `npm run retire:lot1 -- --dry-run --from <buyer>`, then `--execute`; check the certificate by eye. If it is interrupted: `--resume`, never a second `--execute`.
3. Deploy: simulate, read every printed parameter, then broadcast. If the broadcast stops half way, run the same command with `--resume` **instead of** `--broadcast`.
4. Safe accepts (`acceptDefaultAdminTransfer`, 3x `acceptOwnership`), then `DECARBONAI_NETWORK=avalanche npm run audit:roles` must pass.
5. Only then fund the agent: `setup:merchant`, `setup:agent`, `smoke:fuji`, `demo:burst`.

What the deploy script enforces on 43114: `DEPLOYER_PRIVATE_KEY` only (no fallback), ADMIN is a Safe that is 1-of-1 or has threshold >= 2 (`MAINNET_MIN_SAFE_THRESHOLD` = 1; never 1-of-N) and no bot wallet among its owners, TREASURY = PAUSER = ADMIN, canonical USDC and ERC-8004 registries, backed DCO2, the default tunables, a `LOT_FILE` written by klima-retire, and no existing `deployments/avalanche.json`. A simulation writes no deployment file.

All TS entry points (`paid-api`, MCP server, scripts) pick the deployment from `DECARBONAI_NETWORK` (`fuji` default | `avalanche`, reading `deployments/avalanche.json`).
