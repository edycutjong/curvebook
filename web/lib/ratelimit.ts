// Fixed-window limiter, per process. Enough to stop a loop hammering the RPC; not a WAF.
export function rateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (key: string, now: number = Date.now()): boolean => {
    const h = hits.get(key);
    if (!h || now >= h.reset) {
      if (hits.size > 5_000) for (const [k, v] of hits) if (now >= v.reset) hits.delete(k);
      hits.set(key, { n: 1, reset: now + windowMs });
      return true;
    }
    h.n += 1;
    return h.n <= limit;
  };
}

export const clientIp = (req: Request): string =>
  req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
