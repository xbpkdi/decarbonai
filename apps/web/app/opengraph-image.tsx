import { NETWORK } from "@/lib/config";
import { OG_SIZE, ogImage } from "@/lib/og";

export const alt = "DecarbonAI: every paid AI call settles its own carbon";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return ogImage({
    eyebrow: `x402 · ${NETWORK.name}`,
    title: "Every paid AI call settles its own carbon.",
    sub: "A carbon surcharge rides inside each x402 payment, retires credit for the agent and mints a soulbound receipt.",
  });
}
