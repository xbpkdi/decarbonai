"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useNet } from "@/components/Net";

/** When a wallet is connected: the ERC-8004 agent ids it owns, each linking to its carbon profile. */
export function YourAgents({ current }: { current: number }) {
  const { address } = useAccount();
  const net = useNet();
  const [ids, setIds] = useState<number[] | "failed" | null>(null);
  useEffect(() => {
    if (!address) return setIds(null);
    let live = true;
    fetch(`/api/agents/owned?address=${address}&network=${net.id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("lookup failed"))))
      .then((j: { ids?: number[] }) => live && setIds(j.ids ?? "failed"))
      .catch(() => live && setIds("failed"));
    return () => {
      live = false;
    };
  }, [address, net.id]);
  if (!address || ids === null) return null;
  return (
    <div className="your-agents">
      <span className="eyebrow">Your agents</span>
      {ids === "failed" ? (
        <span className="dim">Could not look up this wallet's agents right now.</span>
      ) : ids.length ? (
        ids.map((id) => (
          <a key={id} href={`/agent/${id}`} aria-current={id === current ? "page" : undefined}>
            #{id}
          </a>
        ))
      ) : (
        <span className="dim">This wallet owns no ERC-8004 agent identity.</span>
      )}
    </div>
  );
}
