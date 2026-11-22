"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { WalletIcon } from "@/components/Icons";
import { NETWORK, short } from "@/lib/config";

/** RainbowKit connect button in the navbar's outline style (primary inside the mobile sheet). */
export function WalletButton({ primary = false }: { primary?: boolean }) {
  const cls = primary ? "btn btn-primary wallet" : "btn btn-outline btn-sm wallet";
  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, openConnectModal, openAccountModal, openChainModal }) => {
        if (!mounted || !account)
          return (
            <button type="button" className={cls} onClick={openConnectModal} style={primary ? { flex: 1 } : undefined}>
              <WalletIcon />
              <span>Connect wallet</span>
            </button>
          );
        if (chain?.unsupported)
          return (
            <button type="button" className={cls} onClick={openChainModal}>
              <span>Switch to {NETWORK.short}</span>
            </button>
          );
        return (
          <button type="button" className={`${cls} connected`} onClick={openAccountModal}>
            <WalletIcon />
            <span>{short(account.address)}</span>
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}
