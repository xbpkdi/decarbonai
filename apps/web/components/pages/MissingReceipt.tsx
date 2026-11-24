"use client";

import { usePathname } from "next/navigation";

type Next = { n: number; agent: number | null; mg: number; thresholdMg: number; receipts: number[] } | null;

const no = (n: number) => `No. ${String(n).padStart(4, "0")}`;
const mass = (mg: number) => (mg >= 1e6 ? `${(mg / 1e6).toLocaleString("en-US", { maximumFractionDigits: 3 })} kg` : `${(mg / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })} g`);

/* Receipt-specific 404: the number asked for, the receipts that do exist, and the next one forming. */
export function MissingReceipt({ next, network, testnet }: { next: Next; network: string; testnet: boolean }) {
  const seg = usePathname().split("/").pop() ?? "";
  const n = /^\d+$/.test(seg) ? Number(seg) : null;
  const kind = testnet ? "testnet receipt" : "receipt";
  const shown = next ? next.receipts.slice(-6) : [];
  return (
    <>
      <span className="eyebrow">404</span>
      <h1 className="display">{n === null ? "That isn't a receipt number." : `${no(n)} isn't minted.`}</h1>
      <div className="r404">
        {next && (
          <div className="r404-coin" aria-hidden="true">
            <div className="lq" style={{ height: `${Math.min(1, next.mg / next.thresholdMg) * 100}%` }} />
            <span>{no(next.n)}</span>
          </div>
        )}
        <div>
          {next ? (
            <p className="lead">
              {next.receipts.length.toLocaleString("en-US")} {kind}
              {next.receipts.length === 1 ? "" : "s"} {next.receipts.length === 1 ? "exists" : "exist"} on {network}.{" "}
              {next.agent !== null ? (
                <>
                  The next one, <b>{no(next.n)}</b>, mints when agent #{next.agent}&apos;s account reaches {mass(next.thresholdMg)}: <b>{mass(next.mg)}</b> metered so far.
                </>
              ) : (
                <>
                  The next one, <b>{no(next.n)}</b>, mints when an agent&apos;s account reaches {mass(next.thresholdMg)}.
                </>
              )}
            </p>
          ) : (
            <p className="lead">Could not read {network} right now, so this receipt has not been checked.</p>
          )}
          {shown.length > 0 && (
            <div className="r404-list">
              {shown.map((k) => (
                <a key={k} href={`/receipt/${k}`}>
                  {no(k)}
                </a>
              ))}
            </div>
          )}
          <div className="acts">
            <a className="btn btn-primary" href="/receipts">
              All receipts
            </a>
            {next?.agent != null && (
              <a className="btn btn-outline" href={`/agent/${next.agent}`}>
                Agent #{next.agent}
              </a>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
