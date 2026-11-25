import type { Net } from "@/lib/config";

/** Mainnet only: the real retired credit behind DCO2 lot 1. `left` (kg) is filled by the runtime where it has data. */
export function LotNote({ net }: { net: Net }) {
  if (!net.lot) return null;
  return (
    <p className="lot-note">
      Backed by a real retired tonne ({net.lot.creditId}) ·{" "}
      <a href={net.lot.certificate} target="_blank" rel="noreferrer">
        certificate ↗
      </a>
      <span data-lot-left />
    </p>
  );
}
