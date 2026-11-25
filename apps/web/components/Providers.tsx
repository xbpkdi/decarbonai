"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider, connectorsForWallets, darkTheme } from "@rainbow-me/rainbowkit";
import { coreWallet, injectedWallet, metaMaskWallet, rabbyWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { WagmiProvider, createConfig, http } from "wagmi";
import { NetProvider } from "@/components/Net";
import { type NetId, NETS } from "@/lib/config";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

// Browser-extension wallets work without a WalletConnect project id; QR wallets need one.
const connectors = connectorsForWallets(
  [{ groupName: "Avalanche", wallets: projectId ? [coreWallet, metaMaskWallet, rabbyWallet, walletConnectWallet] : [injectedWallet] }],
  { appName: "DecarbonAI", projectId: projectId || "decarbonai-local" },
);

const wagmiConfig = createConfig({
  chains: [NETS.mainnet.chain, NETS.fuji.chain],
  connectors,
  transports: { 43114: http(NETS.mainnet.rpc), 43113: http(NETS.fuji.rpc) },
  ssr: true,
});

const theme = darkTheme({ accentColor: "#c6f36b", accentColorForeground: "#141a06", borderRadius: "medium", overlayBlur: "small" });

export function Providers({ net, children }: { net: NetId; children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={theme} initialChain={NETS[net].chain} appInfo={{ appName: "DecarbonAI" }}>
          <NetProvider id={net}>{children}</NetProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
