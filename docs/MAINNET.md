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
| Deployer (throwaway: holds nothing after hand-off) | `0x644be9036Cb1C9c672E7594ff3bb316AC9290B90` | local `.env` `MAINNET_PRIVATE_KEY` |
| Admin + Treasury + Pauser | **owner's Safe multisig**, `ADMIN_ADDRESS` (required; the script refuses the deployer) | Safe signers |
| Meter (`METER_ROLE` only, API server) | `0x312B2A1acacd57c3399dFC130202aFf025CDf2F7` | local `.env` `MAINNET_METER_PRIVATE_KEY` |
| payTo (x402 revenue, funds surcharges) | `0xa6339Cd237b7aF717C1D43630e7A643375622e5f` (or a Safe) | local `.env` `MAINNET_PAY_TO_PRIVATE_KEY` |
| Demo agent | `0x493451eC85D69d23ce549B8b1a3b602aE3fcDBF9` | local `.env` `MAINNET_AGENT_PRIVATE_KEY` |

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

- Mainnet mints **only** lots backed by a real off-chain retirement. With no `LOT_*` env the script mints no lot, and accruals queue up with `RetirementDeferred` until the first real lot is added.
- To add a lot after a real Carbonmark retirement on Base, the Safe calls `dco2.mintLot(pool, Lot{…})` and then `pool.addLot(id)`. The lot holds:

  | Field | Value |
  |---|---|
  | `registry` | registry name |
  | `projectId`, `projectName` | project |
  | `serial` | credit id |
  | `vintage` | vintage year |
  | `certificateURI` | Carbonmark retirement URL |
  | `retirementTx` | `eip155:8453:0x…` |
  | `quantityKg` | exactly the kg retired |

  Or pass the same values as `LOT_*` env to the deploy script.
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
| Deployer | **0.2 AVAX** |
| Meter | **0.15 AVAX** |
| payTo | **0.01 AVAX** |
| Safe signer | ~0.01 AVAX |
| Agent | **~$5 USDC** (100 calls ≈ $1.06) |

The x402 facilitator pays settlement gas. The cost of the first real tonne itself is in the research report: the Carbonmark API needs a $50 minimum card top-up, while the x402 retire endpoint takes about $0.10 USDC on Base.

## Runbook (after "go")

```bash
set -a; . ./.env; set +a
cd packages/contracts
DEPLOYER_PRIVATE_KEY=$MAINNET_PRIVATE_KEY ADMIN_ADDRESS=<safe> \
METER_ADDRESS=0x312B2A1acacd57c3399dFC130202aFf025CDf2F7 PAY_TO_ADDRESS=0xa6339Cd237b7aF717C1D43630e7A643375622e5f \
PAYMENT_TOKEN=0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E \
METHODOLOGY_HASH=0x50316f9e7beab6cf0a7448d957b7df5f08b46b2625cb05a270208de18de3e677 METHODOLOGY_VERSION=v0-2026-08-anchored \
forge script script/Deploy.s.sol:Deploy --rpc-url $MAINNET_RPC_URL --broadcast --slow --verify \
  --verifier etherscan --verifier-url https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan --etherscan-api-key verifyContract
cd ../..
# Safe: acceptDefaultAdminTransfer + acceptOwnership x3, then mintLot + addLot for the real retirement
DECARBONAI_NETWORK=avalanche npm run setup:merchant   # payTo approves the pool
DECARBONAI_NETWORK=avalanche npm run setup:agent      # agent gas + ERC-8004 register -> MAINNET_AGENT_ID
DECARBONAI_NETWORK=avalanche npm run smoke:fuji       # same checks + one real USDC paid call (~$0.01)
DECARBONAI_NETWORK=avalanche METER_PRIVATE_KEY=$MAINNET_METER_PRIVATE_KEY PAY_TO_ADDRESS=0xa633… npm run api
```

All TS entry points (`paid-api`, MCP server, scripts) pick the deployment from `DECARBONAI_NETWORK` (`fuji` default | `avalanche`, reading `deployments/avalanche.json`).
