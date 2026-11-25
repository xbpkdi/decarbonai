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
    sub: `${NETWORK.testnet ? `${NETWORK.short} testnet demo: ` : ""}surcharge in each x402 payment, accruals batched on-chain, ${UNBACKED ? "mock credit" : "backed credit"} burned per 1 kg.`,
  });
}
