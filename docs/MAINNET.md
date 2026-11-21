# Avalanche C-Chain mainnet: prepared, NOT deployed

Nothing has been broadcast to mainnet. Deploying needs an explicit go from the owner after funding.

## Config (chainId 43114)

| Item | Value | Checked |
|---|---|---|
| Payment token | Circle USDC `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` (`USD Coin`, version `2`, EIP-3009) | on-chain `name()`/`version()` |
| ERC-8004 Identity | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | verified `IdentityRegistryUpgradeable` |
| ERC-8004 Reputation | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | verified `ReputationRegistryUpgradeable`, **same implementation bytecode as Fuji**, `getIdentityRegistry()` = identity above |
| x402 facilitator | PayAI `https://facilitator.payai.network`, `exact` on `eip155:43114` | `/supported` |
| Explorer / verify | Routescan `https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan` (`foundry.toml` → `avalanche`) | |
| Deployer / meter | `0x644be9036Cb1C9c672E7594ff3bb316AC9290B90` (key only in local `.env` as `MAINNET_PRIVATE_KEY`) | |
| Demo agent | `0x493451eC85D69d23ce549B8b1a3b602aE3fcDBF9` (key only in local `.env` as `MAINNET_AGENT_PRIVATE_KEY`) | |

The deploy script is the same `script/Deploy.s.sol` used on Fuji. On 43114 it requires `PAYMENT_TOKEN` (it refuses to deploy TestUSDC), defaults the reputation registry to the mainnet one, and mints the mock lot `DCAI-MOCK-avalanche-0001` with `registry: "MOCK (no registry)"`. **DCO2 is a mock on mainnet as well.** Its on-chain name is "DecarbonAI DCO2 (testnet mock, not backed by a real tonne)", kept identical to the verified Fuji source.

## Cost (simulated on a local anvil fork of mainnet, 21 Nov 2026)

| Step | Gas | AVAX @ 7.81 gwei (current base 7.5 + tip) | AVAX @ 15.3 gwei (forge max-fee ceiling) |
|---|---|---|---|
| Deploy + wire + mint mock lot (11 txs) | 7,643,245 | 0.0597 | 0.1169 |
| Meter `approve` (pool pulls surcharges) | 56,167 | 0.0004 | 0.0009 |
| Gas sent to agent for ERC-8004 `register` (297,203 gas) | — | 0.0100 transfer | 0.0100 transfer |
| Contract verification | 0 | 0 | 0 |
| **Deploy + verify + registration total** | | **≈ 0.071 AVAX** | **≈ 0.128 AVAX** |
| Optional: 100-call demo burst (98 × ~125k + 2 retirements × ~650k gas) | ~13.6M | ≈ 0.106 | ≈ 0.208 |

Recommendation: fund the deployer with **0.15 AVAX** for deploy + verify + registration with fee headroom, or **0.35 AVAX** if it should also run a 100-call burst on mainnet. Also send the agent **~$5 USDC** (100 calls ≈ $1.06). The x402 facilitator pays settlement gas.

## Runbook (after "go")

```bash
set -a; . ./.env; set +a
cd packages/contracts
DEPLOYER_PRIVATE_KEY=$MAINNET_PRIVATE_KEY PAYMENT_TOKEN=0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E \
METHODOLOGY_HASH=0x50316f9e7beab6cf0a7448d957b7df5f08b46b2625cb05a270208de18de3e677 METHODOLOGY_VERSION=v0-2026-08-anchored \
forge script script/Deploy.s.sol:Deploy --rpc-url $MAINNET_RPC_URL --broadcast --slow --verify \
  --verifier etherscan --verifier-url https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan --etherscan-api-key verifyContract
cd ../..
DECARBONAI_NETWORK=avalanche npm run setup:agent      # agent gas + ERC-8004 register -> MAINNET_AGENT_ID
DECARBONAI_NETWORK=avalanche npm run smoke:fuji       # same checks + one real USDC paid call (~$0.01)
DECARBONAI_NETWORK=avalanche npm run api              # paid API on mainnet
```

All TS entry points (`paid-api`, MCP server, scripts) pick the deployment from `DECARBONAI_NETWORK` (`fuji` default | `avalanche`, reading `deployments/avalanche.json`).
