"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider, connectorsForWallets, darkTheme } from "@rainbow-me/rainbowkit";
import { coreWallet, injectedWallet, metaMaskWallet, rabbyWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { WagmiProvider, createConfig, http } from "wagmi";
import { NETWORK, RPC_URL } from "@/lib/config";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

// Browser-extension wallets work without a WalletConnect project id; QR wallets need one.
const connectors = connectorsForWallets(
  [{ groupName: "Avalanche", wallets: projectId ? [coreWallet, metaMaskWallet, rabbyWallet, walletConnectWallet] : [injectedWallet] }],
  { appName: "DecarbonAI", projectId: projectId || "decarbonai-local" },
);

const chain = NETWORK.chain;
const wagmiConfig = createConfig({ chains: [chain], connectors, transports: { [chain.id]: http(RPC_URL) } as Record<typeof chain.id, ReturnType<typeof http>>, ssr: true });

const theme = darkTheme({ accentColor: "#c6f36b", accentColorForeground: "#141a06", borderRadius: "medium", overlayBlur: "small" });

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={theme} initialChain={chain} appInfo={{ appName: "DecarbonAI" }}>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
