"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";

/** When a wallet is connected: the ERC-8004 agent ids it owns, each linking to its carbon profile. */
export function YourAgents({ current }: { current: number }) {
  const { address } = useAccount();
  const [ids, setIds] = useState<number[] | null>(null);
  useEffect(() => {
    if (!address) return setIds(null);
    let live = true;
    fetch(`/api/agents/owned?address=${address}`)
      .then((r) => (r.ok ? r.json() : { ids: [] }))
      .then((j: { ids?: number[] }) => live && setIds(j.ids ?? []))
      .catch(() => live && setIds([]));
    return () => {
      live = false;
    };
  }, [address]);
  if (!address || ids === null) return null;
  return (
    <div className="your-agents">
      <span className="eyebrow">Your agents</span>
      {ids.length ? (
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
