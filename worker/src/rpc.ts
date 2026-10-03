// Rate-limited JSON-RPC client with retry on 429 / transient errors.
import type { RawTx } from "@curvebook/core";

export class RpcError extends Error {
  constructor(public code: number, message: string) {
    super(message);
  }
}

export class Rpc {
  private queue: (() => void)[] = [];
  private tokens: number;
  errors = 0;

  constructor(readonly url: string, private rps: number) {
    this.tokens = rps;
    setInterval(() => {
      this.tokens = this.rps;
      while (this.tokens > 0 && this.queue.length) {
        this.tokens--;
        this.queue.shift()!();
      }
    }, 1000).unref();
  }

  private slot(): Promise<void> {
    if (this.tokens > 0) {
      this.tokens--;
      return Promise.resolve();
    }
    return new Promise((r) => this.queue.push(r));
  }

  get backlog() {
    return this.queue.length;
  }

  async call<T>(method: string, params: unknown[], attempts = 6): Promise<T> {
    let last: unknown;
    for (let i = 0; i < attempts; i++) {
      await this.slot();
      try {
        const r = await fetch(this.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          signal: AbortSignal.timeout(20_000),
        });
        if (r.status === 429 || r.status >= 500) throw new RpcError(r.status, `HTTP ${r.status}`);
        const j: any = await r.json();
        if (j.error) {
          // Not-yet-available data is retried; anything else is the caller's problem.
          if (j.error.code === -32004 || j.error.code === -32007 || j.error.code === -32009) throw new RpcError(j.error.code, j.error.message);
          throw Object.assign(new RpcError(j.error.code, j.error.message), { fatal: true });
        }
        return j.result as T;
      } catch (e: any) {
        if (e?.fatal) throw e;
        last = e;
        this.errors++;
        await new Promise((s) => setTimeout(s, 400 * 2 ** i));
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
