// Pins Rpc: multi-endpoint round robin, per-endpoint token bucket + queueing,
// 429 backoff (with/without Retry-After, strikes reset on success), 5xx retry,
// retryable vs fatal JSON-RPC errors, attempts exhaustion, and the helper methods.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Rpc, RpcError } from "../src/rpc.js";

type Spec =
  | { status: 429; retryAfter?: string }
  | { status: number } // >= 500
  | { result?: unknown; error?: { code: number; message: string } };

function fakeResponse(spec: Spec) {
  const status = (spec as any).status ?? 200;
  return {
    status,
    headers: { get: (name: string) => (name.toLowerCase() === "retry-after" ? (spec as any).retryAfter ?? null : null) },
    async json() {
      if (status === 429 || status >= 500) throw new Error(`json() must not be called on HTTP ${status}`);
      return spec;
    },
  };
}

/** Scripts one fake Response per fetch() call, in order, and records url/body/time. */
function mockFetch(specs: Spec[]) {
  const queue = [...specs];
  const calls: { url: string; body: any; headers: Record<string, string>; t: number }[] = [];
  const fn = vi.fn(async (url: string, init: any) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers, t: Date.now() });
    const spec = queue.shift();
    if (!spec) throw new Error("fetch invoked more times than scripted");
    return fakeResponse(spec);
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("endpoint parsing", () => {
  it("splits comma-separated urls, trims whitespace, drops empty entries, and exposes the first as .url", async () => {
    const calls = mockFetch([{ result: 1 }, { result: 2 }, { result: 3 }]);
    const rpc = new Rpc(" http://a.test , http://b.test ,, http://c.test ", 10);
    expect(rpc.url).toBe("http://a.test");
    await rpc.call("m", []);
    await rpc.call("m", []);
    await rpc.call("m", []);
    expect(calls.map((c) => c.url)).toEqual(["http://a.test", "http://b.test", "http://c.test"]);
  });
});

describe("round robin", () => {
  it("cycles requests across endpoints in order, wrapping back to the first", async () => {
    const calls = mockFetch([{ result: 1 }, { result: 2 }, { result: 3 }, { result: 4 }]);
    const rpc = new Rpc("http://a.test,http://b.test", 10);
    for (let i = 0; i < 4; i++) await rpc.call("m", []);
    expect(calls.map((c) => c.url)).toEqual(["http://a.test", "http://b.test", "http://a.test", "http://b.test"]);
  });
});

describe("token bucket queueing", () => {
  it("queues a call once the per-second budget is spent and drains it on the next refill tick", async () => {
    const calls = mockFetch([{ result: "r1" }, { result: "r2" }]);
    const rpc = new Rpc("http://only.test", 1);
    expect(rpc.backlog).toBe(0);

    await rpc.call("m1", []);
    expect(calls).toHaveLength(1);

    const p2 = rpc.call("m2", []);
    expect(rpc.backlog).toBe(1); // no token left; queued synchronously before the refill tick
    await vi.advanceTimersByTimeAsync(1000); // setInterval refill -> drain()
    expect(await p2).toBe("r2");
    expect(rpc.backlog).toBe(0);
  });
});

describe("429 backoff", () => {
  it("with Retry-After: pauses only the failing endpoint; both this call's retry and the next call route to the other endpoint", async () => {
    const calls = mockFetch([{ status: 429, retryAfter: "5" }, { result: "ok1" }, { result: "ok2" }]);
    const rpc = new Rpc("http://e0.test,http://e1.test", 10);

    const p1 = rpc.call("m", []);
    await vi.advanceTimersByTimeAsync(250); // the 250ms backoff sleep between attempt 0 and 1
    expect(await p1).toBe("ok1");
    expect(calls.map((c) => c.url)).toEqual(["http://e0.test", "http://e1.test"]);

    // Still well inside the 5s Retry-After pause: a brand new call must skip e0 too.
    expect(await rpc.call("m", [])).toBe("ok2");
    expect(calls[2].url).toBe("http://e1.test");
  });

  it("without Retry-After: pauses the endpoint for the computed backoff (2s on first strike), then releases it", async () => {
    const calls = mockFetch([{ status: 429 }, { result: "ok1" }, { result: "ok2" }, { result: "ok3" }]);
    const rpc = new Rpc("http://e2.test,http://e3.test", 10);

    const p1 = rpc.call("m", []);
    await vi.advanceTimersByTimeAsync(250);
    expect(await p1).toBe("ok1");
    expect(calls.map((c) => c.url)).toEqual(["http://e2.test", "http://e3.test"]);

    // t=250: still within the 2s pause -> routes to e3 again, not e2.
    expect(await rpc.call("m", [])).toBe("ok2");
    expect(calls[2].url).toBe("http://e3.test");

    // Advance past the 2s pause (t=250 -> t=2001): e2 becomes eligible again.
    await vi.advanceTimersByTimeAsync(1751);
    expect(await rpc.call("m", [])).toBe("ok3");
    expect(calls[3].url).toBe("http://e2.test");
  });

  it("strikes reset to 0 after a success, so a later 429 on the same endpoint re-pauses for 2s, not the doubled 4s", async () => {
    const calls = mockFetch([{ status: 429 }, { result: "ok1" }, { status: 429 }, { result: "ok2" }]);
    const rpc = new Rpc("http://strikes.test", 10);

    const p1 = rpc.call("m", []);
    await vi.advanceTimersByTimeAsync(2000); // 250ms sleep + refill ticks @1000/@2000 until the pause lifts
    expect(await p1).toBe("ok1");

    const p2 = rpc.call("m", []);
    await vi.advanceTimersByTimeAsync(2000); // if strikes had not reset this would need 4000ms, not 2000ms
    expect(await p2).toBe("ok2");

    expect(calls.map((c) => c.t)).toEqual([0, 2000, 2000, 4000]);
  });
});

describe("auth header", () => {
  it("sends x-token when a token is set, and no x-token without one", async () => {
    const calls = mockFetch([{ result: 1 }, { result: 2 }]);
    await new Rpc("http://only.test", 10, "tok").call("getSlot", []);
    await new Rpc("http://only.test", 10).call("getSlot", []);
    expect(calls[0].headers).toEqual({ "content-type": "application/json", "x-token": "tok" });
    expect(calls[1].headers).toEqual({ "content-type": "application/json" });
  });
});

describe("retry policy", () => {
  it("retries on HTTP 5xx and succeeds on a later attempt", async () => {
    const calls = mockFetch([{ status: 503 }, { result: "ok" }]);
    const rpc = new Rpc("http://only.test", 10);
    const p = rpc.call("m", [], 2);
    await vi.advanceTimersByTimeAsync(250);
    expect(await p).toBe("ok");
    expect(calls).toHaveLength(2);
    expect(rpc.errors).toBe(1);
  });

  it("retries a retryable JSON-RPC error code (node data not yet available) and succeeds", async () => {
    const calls = mockFetch([{ error: { code: -32004, message: "not yet available" } }, { result: "ok" }]);
    const rpc = new Rpc("http://only.test", 10);
    const p = rpc.call("m", [], 2);
    await vi.advanceTimersByTimeAsync(250);
    expect(await p).toBe("ok");
    expect(calls).toHaveLength(2);
    expect(rpc.errors).toBe(1);
  });

  it("throws a fatal JSON-RPC error immediately, with no retry and no error-count increment", async () => {
    const calls = mockFetch([{ error: { code: -32601, message: "method not found" } }]);
    const rpc = new Rpc("http://only.test", 10);
    const err: any = await rpc.call("m", [], 5).catch((e) => e);
    expect(err).toBeInstanceOf(RpcError);
    expect(err.code).toBe(-32601);
    expect(err.fatal).toBe(true);
    expect(calls).toHaveLength(1);
    expect(rpc.errors).toBe(0);
  });

  it("rethrows the last error and counts one `errors` increment per failed attempt once attempts are exhausted", async () => {
    const calls = mockFetch([
      { error: { code: -32004, message: "first" } },
      { error: { code: -32004, message: "second" } },
    ]);
    const rpc = new Rpc("http://only.test", 10);
    const p = rpc.call("m", [], 2).catch((e) => e);
    await vi.advanceTimersByTimeAsync(1000);
    const err: any = await p;
    expect(err).toBeInstanceOf(RpcError);
    expect(err.message).toBe("second");
    expect(calls).toHaveLength(2);
    expect(rpc.errors).toBe(2);
  });
});

describe("helper methods", () => {
  it("getTransaction sends the expected method and params", async () => {
    const calls = mockFetch([{ result: { slot: 1 } }]);
    const rpc = new Rpc("http://only.test", 10);
    expect(await rpc.getTransaction("sig1")).toEqual({ slot: 1 });
    expect(calls[0].body).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "getTransaction",
      params: ["sig1", { encoding: "json", maxSupportedTransactionVersion: 1, commitment: "confirmed" }],
    });
  });

  it("getSlot defaults commitment to confirmed and accepts an override", async () => {
    const calls = mockFetch([{ result: 100 }, { result: 101 }]);
    const rpc = new Rpc("http://only.test", 10);
    expect(await rpc.getSlot()).toBe(100);
    expect(calls[0].body.params).toEqual([{ commitment: "confirmed" }]);

    expect(await rpc.getSlot("processed")).toBe(101);
    expect(calls[1].body.params).toEqual([{ commitment: "processed" }]);
  });

  it("getSignaturesForAddress defaults limit/commitment and lets opts override them", async () => {
    const calls = mockFetch([{ result: [] }, { result: [] }]);
    const rpc = new Rpc("http://only.test", 10);

    await rpc.getSignaturesForAddress("addr1");
    expect(calls[0].body.params).toEqual(["addr1", { limit: 1000, commitment: "confirmed" }]);

    await rpc.getSignaturesForAddress("addr1", { before: "sigX", limit: 5 });
    expect(calls[1].body.params).toEqual(["addr1", { limit: 5, commitment: "confirmed", before: "sigX" }]);
  });

  it("getAccountData returns null when the account has no value", async () => {
    const calls = mockFetch([{ result: null }, { result: {} }]);
    const rpc = new Rpc("http://only.test", 10);
    expect(await rpc.getAccountData("missing1")).toBeNull();
    expect(await rpc.getAccountData("missing2")).toBeNull();
    expect(calls[0].body.params).toEqual(["missing1", { encoding: "base64", commitment: "confirmed" }]);
  });

  it("getAccountData base64-decodes the account data alongside the owner", async () => {
    mockFetch([{ result: { value: { owner: "Owner111111111111111111111111111111111111", data: ["aGVsbG8=", "base64"] } } }]);
    const rpc = new Rpc("http://only.test", 10);
    const acc = await rpc.getAccountData("addr1");
    expect(acc).not.toBeNull();
    expect(acc!.owner).toBe("Owner111111111111111111111111111111111111");
    expect(acc!.data).toEqual(Buffer.from("aGVsbG8=", "base64"));
    expect(acc!.data.toString("utf8")).toBe("hello");
  });
});
