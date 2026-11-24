import { NETS } from "@/lib/config";
import { OG_SIZE, ogImage } from "@/lib/og";
import { getSnapshotSafe } from "@/lib/server/chain";
import { getNet } from "@/lib/server/net";

export const alt = NETS.mainnet.unbacked ? "DecarbonAI testnet receipt, mock credit" : "DecarbonAI soulbound retirement receipt";
export const size = OG_SIZE;
export const contentType = "image/png";

const no = (n: number) => `No. ${String(n).padStart(4, "0")}`;

export default async function Image({ params }: { params: Promise<{ n: string }> }) {
  const n = Number((await params).n) || 0;
  const net = await getNet();
  const NETWORK = net;
  const UNBACKED = net.unbacked;
  const r = (await getSnapshotSafe(net))?.retirements.find((x) => x.n === n);
  const kg = r ? `${(r.mg / 1e6).toLocaleString("en-US", { maximumFractionDigits: 3 })} kg CO₂e` : UNBACKED ? "Testnet receipt" : "Retirement receipt";
  const sub = r
    ? `${UNBACKED ? "Mock credit burned for" : "Retired by"} agent #${r.agent} across ${r.calls.toLocaleString("en-US")} ${net.calls}. Soulbound ERC-5192 on ${NETWORK.name}.`
    : `Soulbound ERC-5192 receipt on ${NETWORK.name}.`;
  return ogImage({ eyebrow: `Receipt ${no(n)}`, title: kg, sub, accent: "#c6f36b" });
}
