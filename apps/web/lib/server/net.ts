import "server-only";
import { headers } from "next/headers";
import { NET_HEADER, type Net, netById } from "@/lib/config";

/** The network this request reads, as picked by middleware.ts. */
export async function getNet(): Promise<Net> {
  return netById((await headers()).get(NET_HEADER));
}
