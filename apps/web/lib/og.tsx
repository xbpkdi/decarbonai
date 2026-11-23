import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 };

const INK = "#080a09";
const LIME = "#c6f36b";
const RED = "#e84142";

/** Shared OG frame in the v3 brand: ink ground, lime glow, the Offset mark, big headline. */
export function ogImage({ eyebrow, title, sub, accent }: { eyebrow: string; title: string; sub: string; accent?: string }) {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
        backgroundColor: INK,
        backgroundImage: "radial-gradient(circle at 85% 15%, rgba(198,243,107,0.28), transparent 45%), radial-gradient(circle at 10% 100%, rgba(61,220,151,0.16), transparent 50%)",
        color: "#f1f2e9",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <svg width="56" height="56" viewBox="6 6 20 20" aria-hidden="true">
          <rect x="6" y="6" width="14" height="14" rx="2" fill="#7d8580" />
          <rect x="12" y="12" width="14" height="14" rx="2" fill={LIME} />
          <rect x="12" y="12" width="8" height="8" fill={RED} />
        </svg>
        <span style={{ fontSize: 34, fontWeight: 700 }}>DecarbonAI</span>
        <span style={{ marginLeft: "auto", fontSize: 22, color: "#7d8580", letterSpacing: 3, textTransform: "uppercase" }}>{eyebrow}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: accent ? 150 : 84, fontWeight: 900, lineHeight: 0.95, letterSpacing: -2, color: accent ?? "#f1f2e9" }}>{title}</div>
        <div style={{ fontSize: 34, color: "#b9c0bb", marginTop: 26, lineHeight: 1.3 }}>{sub}</div>
      </div>
      <div style={{ display: "flex", height: 14, gap: 8 }}>
        {Array.from({ length: 10 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed ten-slot scale
          <div key={i} style={{ flex: 1, borderRadius: 4, background: i < 8 ? LIME : "rgba(241,242,233,0.12)" }} />
        ))}
      </div>
    </div>,
    OG_SIZE,
  );
}
