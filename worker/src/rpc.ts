// Rate-limited JSON-RPC client over one or more endpoints.
// Each endpoint has its own per-second budget and backs off on 429; requests go to
// whichever endpoint has budget, so keyless public endpoints can share the load.
import type { RawTx } from "@curvebook/core";

export class RpcError extends Error {
  constructor(public code: number, message: string) {
    super(message);
  }
}

type Endpoint = { url: string; tokens: number; pausedUntil: number; strikes: number };

export class Rpc {
  private endpoints: Endpoint[];
  private queue: ((e: Endpoint) => void)[] = [];
  private next = 0;
  errors = 0;

  /** `urls` may be a comma-separated list; `token`, when set, is sent as the `x-token` header (RPC Fast). */
  constructor(urls: string, private rps: number, private token = "") {
    this.endpoints = urls.split(",").map((u) => u.trim()).filter(Boolean).map((url) => ({ url, tokens: rps, pausedUntil: 0, strikes: 0 }));
    setInterval(() => {
      for (const e of this.endpoints) e.tokens = this.rps;
      this.drain();
    }, 1000).unref();
  }

  get url() {
    return this.endpoints[0].url;
  }

  get backlog() {
    return this.queue.length;
  }

  private pick(): Endpoint | null {
    const now = Date.now();
    for (let i = 0; i < this.endpoints.length; i++) {
      const e = this.endpoints[(this.next + i) % this.endpoints.length];
      if (e.tokens > 0 && e.pausedUntil <= now) {
        this.next = (this.next + i + 1) % this.endpoints.length;
        e.tokens--;
        return e;
      }
    }
    return null;
  }

  private drain() {
    while (this.queue.length) {
      const e = this.pick();
      if (!e) return;
      this.queue.shift()!(e);
    }
  }

  private acquire(): Promise<Endpoint> {
    const e = this.pick();
    if (e) return Promise.resolve(e);
    return new Promise((r) => this.queue.push(r));
  }

  async call<T>(method: string, params: unknown[], attempts = 8): Promise<T> {
    let last: unknown;
    for (let i = 0; i < attempts; i++) {
      const ep = await this.acquire();
      try {
        const r = await fetch(ep.url, {
          method: "POST",
          headers: this.token ? { "content-type": "application/json", "x-token": this.token } : { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          signal: AbortSignal.timeout(20_000),
        });
        if (r.status === 429) {
          ep.strikes++;
          const retryAfter = Number(r.headers.get("retry-after")) || 0;
          ep.pausedUntil = Date.now() + Math.max(retryAfter * 1000, Math.min(30_000, 1000 * 2 ** Math.min(ep.strikes, 5)));
          throw new RpcError(429, `HTTP 429 from ${new URL(ep.url).host}`);
        }
        if (r.status >= 500) throw new RpcError(r.status, `HTTP ${r.status}`);
        const j: any = await r.json();
        if (j.error) {
          // Data not available yet on this node: retry (possibly on another endpoint).
          if ([-32004, -32007, -32009, -32014].includes(j.error.code)) throw new RpcError(j.error.code, j.error.message);
          throw Object.assign(new RpcError(j.error.code, j.error.message), { fatal: true });
        }
        ep.strikes = 0;
        return j.result as T;
      } catch (e: any) {
        if (e?.fatal) throw e;
        last = e;
        this.errors++;
        await new Promise((s) => setTimeout(s, 250 * 2 ** Math.min(i, 4)));
      }
    }
    throw last;
  }

  getTransaction(sig: string): Promise<RawTx | null> {
    return this.call("getTransaction", [sig, { encoding: "json", maxSupportedTransactionVersion: 1, commitment: "confirmed" }]);
  }

  getSlot(commitment = "confirmed"): Promise<number> {
    return this.call("getSlot", [{ commitment }]);
  }

  getSignaturesForAddress(addr: string, opts: { before?: string; until?: string; limit?: number } = {}) {
    return this.call<{ signature: string; slot: number; err: unknown; blockTime: number | null }[]>("getSignaturesForAddress", [
      addr,
      { limit: 1000, commitment: "confirmed", ...opts },
    ]);
  }

  async getAccountData(addr: string): Promise<{ owner: string; data: Buffer } | null> {
    const r: any = await this.call("getAccountInfo", [addr, { encoding: "base64", commitment: "confirmed" }]);
    if (!r?.value) return null;
    return { owner: r.value.owner, data: Buffer.from(r.value.data[0], "base64") };
  }
}
