import { clientIp, rateLimiter } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The worker waits for confirmation (up to ~45 s) before answering.
export const maxDuration = 60;

const allow = rateLimiter(10, 60_000);

export async function POST(req: Request) {
  if (!allow(clientIp(req))) return Response.json({ error: "too many launch requests; wait a minute" }, { status: 429 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.tx !== "string" || body.tx.length > 4000) {
    return Response.json({ error: "send the signed transaction as base64 in `tx`" }, { status: 400 });
  }
  const url = process.env.WORKER_URL;
  const token = process.env.WORKER_TOKEN;
  if (!url || !token) return Response.json({ error: "landing is not configured on this deployment" }, { status: 503 });

  let r: Response;
  try {
    r = await fetch(`${url.replace(/\/$/, "")}/beam`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ tx: body.tx }),
      signal: AbortSignal.timeout(58_000),
    });
  } catch {
    return Response.json({ error: "the landing worker did not answer; the transaction may still land, check the receipt before retrying" }, { status: 502 });
  }
  const json = await r.json().catch(() => ({ error: `worker answered HTTP ${r.status}` }));
  return Response.json(json, { status: r.status });
}
