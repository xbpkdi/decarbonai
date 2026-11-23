import type { Address, Chain } from "viem";
import { avalanche, avalancheFuji } from "viem/chains";

export type NetworkConfig = {
  chainId: 43113 | 43114;
  name: "fuji" | "avalanche";
  chain: Chain;
  caip2: "eip155:43113" | "eip155:43114";
  rpcUrl: string;
  rpcEnv: "FUJI_RPC_URL" | "MAINNET_RPC_URL";
  explorer: string;
  routescanApi: string;
  erc8004Identity: Address;
  erc8004Reputation: Address;
  usdc: Address;
};

export const NETWORKS: Record<43113 | 43114, NetworkConfig> = {
  43113: {
    chainId: 43113,
    name: "fuji",
    chain: avalancheFuji,
    caip2: "eip155:43113",
    rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc",
    rpcEnv: "FUJI_RPC_URL",
    explorer: "https://testnet.snowtrace.io",
    routescanApi: "https://api.routescan.io/v2/network/testnet/evm/43113/etherscan/api",
    erc8004Identity: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    erc8004Reputation: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
    usdc: "0x5425890298aed601595a70AB815c96711a31Bc65",
  },
  43114: {
    chainId: 43114,
    name: "avalanche",
    chain: avalanche,
    caip2: "eip155:43114",
    rpcUrl: "https://api.avax.network/ext/bc/C/rpc",
    rpcEnv: "MAINNET_RPC_URL",
    explorer: "https://snowtrace.io",
    routescanApi: "https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan/api",
    // Same ERC-8004 implementation bytecode as Fuji (verified ReputationRegistryUpgradeable).
    erc8004Identity: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    erc8004Reputation: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
    usdc: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
  },
};

export function network(chainId: number): NetworkConfig {
  const n = NETWORKS[chainId as 43113 | 43114];
  if (!n) throw new Error(`unsupported chainId ${chainId}`);
  return n;
}

/** EIP-712 domain of the payment token, needed by x402 "exact" (EIP-3009). */
export function tokenDomain(chainId: number, token: Address): { name: string; version: string } {
  const n = network(chainId);
  return token.toLowerCase() === n.usdc.toLowerCase()
    ? { name: "USD Coin", version: "2" }
    : { name: "DecarbonAI Test USDC", version: "2" };
}

export function explorerFor(chainId: number) {
  const base = network(chainId).explorer;
  return {
    tx: (hash: string) => `${base}/tx/${hash}`,
    address: (addr: string) => `${base}/address/${addr}`,
    nft: (contract: string, id: bigint | number) => `${base}/nft/${contract}/${id}`,
  };
}
