/** Logo N "Offset": emitted (grey) offset by retired (lime); the overlap, settled on chain, is AVAX red. */
export function Mark() {
  return (
    <svg viewBox="6 6 20 20" aria-hidden="true">
      <rect x="6" y="6" width="14" height="14" rx="2" fill="#7d8580" />
      <rect x="12" y="12" width="14" height="14" rx="2" fill="var(--mint)" />
      <rect x="12" y="12" width="8" height="8" fill="#E84142" />
    </svg>
  );
}

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const WalletIcon = () => (
  <svg viewBox="0 0 24 24" {...stroke} aria-hidden="true">
    <path d="M19 7V5a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3v3a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V6" />
  </svg>
);
export const MenuIcon = () => (
  <svg viewBox="0 0 24 24" {...stroke} aria-hidden="true">
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);
export const CloseIcon = () => (
  <svg viewBox="0 0 24 24" {...stroke} aria-hidden="true">
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
export const XIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);
