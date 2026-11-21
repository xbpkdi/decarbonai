import type { Context, MiddlewareHandler } from "hono";

/**
 * Small per-client token bucket (in memory). Keyed by the first X-Forwarded-For hop when behind a
 * proxy (TRUST_PROXY=1), else by the socket address hono/node-server exposes.
 */
export function rateLimit(opts: { perMinute: number; burst?: number; trustProxy?: boolean }): MiddlewareHandler {
  const capacity = opts.burst ?? opts.perMinute;
  const refillPerMs = opts.perMinute / 60_000;
  const buckets = new Map<string, { tokens: number; at: number }>();
  return async (c: Context, next) => {
    const now = Date.now();
    const key = clientKey(c, opts.trustProxy ?? false);
    const b = buckets.get(key) ?? { tokens: capacity, at: now };
    b.tokens = Math.min(capacity, b.tokens + (now - b.at) * refillPerMs);
    b.at = now;
    if (b.tokens < 1) {
      buckets.set(key, b);
      c.header("Retry-After", String(Math.ceil((1 - b.tokens) / refillPerMs / 1000)));
      return c.json({ error: "rate limited" }, 429);
    }
    b.tokens -= 1;
    buckets.set(key, b);
    if (buckets.size > 10_000) {
      for (const [k, v] of buckets) if (now - v.at > 120_000) buckets.delete(k);
    }
    await next();
  };
}

function clientKey(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = c.req.header("x-forwarded-for");
    if (xff) return xff.split(",")[0].trim();
  }
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming;
  return incoming?.socket?.remoteAddress ?? "unknown";
}
