import { type NextRequest, NextResponse } from "next/server";
import { DEFAULT_NET, NET_COOKIE, NET_HEADER, toNetId } from "@/lib/net-id";

/** Picks the network for this request: ?network=, else the cookie, else mainnet. A ?network= is remembered in the cookie. */
export function middleware(req: NextRequest) {
  const asked = toNetId(req.nextUrl.searchParams.get("network"));
  const saved = toNetId(req.cookies.get(NET_COOKIE)?.value);
  const headers = new Headers(req.headers);
  headers.set(NET_HEADER, asked ?? saved ?? DEFAULT_NET);
  const res = NextResponse.next({ request: { headers } });
  if (asked && asked !== saved) res.cookies.set(NET_COOKIE, asked, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  return res;
}

export const config = { matcher: ["/((?!_next/|fonts/|favicon|icon|apple-icon).*)"] };
