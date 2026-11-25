import { NETS } from "@/lib/config";
import { HEADLINE } from "@/lib/copy";
import { OG_SIZE, ogImage } from "@/lib/og";

export const alt = `DecarbonAI: ${HEADLINE}`;
export const size = OG_SIZE;
export const contentType = "image/png";

/** The default (mainnet) card: crawlers do not carry the network choice. */
export default function Image() {
  const NETWORK = NETS.mainnet;
  const UNBACKED = NETWORK.unbacked;
  return ogImage({
    eyebrow: `x402 · ${NETWORK.name}`,
    title: `${HEADLINE}.`,
    sub: `${NETWORK.testnet ? `${NETWORK.short} testnet demo: ` : ""}Each x402 payment includes a carbon surcharge. Every 1 kg burns a ${UNBACKED ? "mock" : "backed"} credit.`,
  });
}
