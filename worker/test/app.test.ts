// Drives worker/src/app.ts (the startWorker() wiring extracted from main.ts) to 100% coverage:
// every HTTP route/status/auth branch, grpc vs rpc source selection, beam present/absent,
// captureStart reuse vs fallback, the every() busy-guard/error-logging, and the json() double-write guard.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { WorkerConfig } from "../src/env.js";
import { Rpc } from "../src/rpc.js";
import { Indexer } from "../src/indexer.js";
import { aggregate as realAggregateFn } from "../src/agg.js";
import { land as realLandFn, LandError } from "../src/lander.js";
import { startGrpc as realStartGrpcFn } from "../src/sources/grpc.js";
import { startRpcLogs as realStartRpcLogsFn } from "../src/sources/rpc-logs.js";
import { startWorker, every, json, realDeps, type Deps } from "../src/app.js";

// realDeps() wires solami's builder(); mock it so the test never dials a real SWQOS endpoint.
vi.mock("solami", () => ({
  builder: () => ({ withSwqos: (_key: string) => ({ build: async () => ({ beam: async (_tx: any) => "mock-sig" }) }) }),
  CommitmentLevel: {},
  SubscriptionBuilder: class {},
}));

type SqlCall = { text: string; values: unknown[] };

/** Fake tagged-template `sql`. Scriptable per-statement by substring match on the query text. */
function makeSql(handlers: Record<string, (text: string, values: unknown[]) => unknown> = {}) {
  const calls: SqlCall[] = [];
  const fn: any = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    calls.push({ text, values });
    for (const [needle, handler] of Object.entries(handlers)) {
      if (text.includes(needle)) return Promise.resolve(handler(text, values));
    }
    return Promise.resolve([]);
  };
  fn.calls = calls;
  return fn;
}

/** Fake `rpc`: getSlot() returns a fresh, incrementing slot on every call. */
function makeRpc(opts: { slot?: number; backlog?: number; errors?: number; url?: string } = {}) {
  let n = opts.slot ?? 100;
  const rpc: any = {
    url: opts.url ?? "http://rpc1.fake",
    backlog: opts.backlog ?? 0,
    errors: opts.errors ?? 0,
    getSlot: vi.fn(async () => ++n),
  };
  return rpc;
}

/** Fake `indexer`: the subset of Indexer's surface app.ts actually touches. */
function makeIndexer(opts: { lastSlot?: number; pendingSize?: number } = {}) {
  const idx: any = {
    chainSlot: 0,
    lastSlot: opts.lastSlot ?? 0,
    pending: { size: opts.pendingSize ?? 0 },
    stats: { poolsSeen: 0, windowsFinal: 0, windowsIncomplete: 0 },
    resume: vi.fn(async () => {}),
    tick: vi.fn(async () => {}),
    pollWatched: vi.fn(async () => {}),
    watch: vi.fn(),
    onTx: vi.fn(async () => {}),
  };
  return idx;
}

/** Fake `setInterval`: records (ms, callback) instead of scheduling anything real. */
function makeSetInterval() {
  const calls: { ms: number; cb: () => Promise<void> }[] = [];
  const fn: any = (cb: () => Promise<void>, ms: number) => {
    calls.push({ ms, cb });
    return calls.length;
  };
  fn.calls = calls;
  return fn;
}

function makeConfig(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    databaseUrl: "postgres://fake",
    grpcUrl: "",
    grpcToken: "",
    rpcToken: "",
    rpcFallbackUrl: "http://fallback1.fake,http://fallback2.fake",
    rpcFallbackRps: 3,
    wsFallbackUrl: "wss://fallback.fake",
    solamiSwqosKey: "",
    rpcUrl: "http://rpc.fake",
    wsUrl: "ws://rpc.fake",
    rpcRps: 10,
    port: 0,
    workerToken: "secret",
    aggEverySec: 9,
    ...overrides,
  };
}

function baseDeps(config: WorkerConfig, sql: any, rpc: any, indexer: any, setIntervalFn: any): Deps {
  const d = {
    config,
    sql,
    rpc,
    indexerFactory: vi.fn(() => indexer),
    startGrpc: vi.fn(async () => ({ reconnects: () => 0, lastFromSlot: () => null })),
    startRpcLogs: vi.fn(() => ({ reconnects: () => 0, lastFromSlot: () => null })),
    buildBeamer: vi.fn(async () => (async () => "beamed-sig") as any),
    aggregate: vi.fn(async () => ({ windows: 7, configs: 2, ranked: 1 })),
    land: vi.fn(async () => ({ sig: "landed-sig", landedSlot: 42, pool: "poolX", via: "rpc", swqos: null })),
    setInterval: setIntervalFn,
  };
  return d as unknown as Deps;
}

async function portOf(server: Server): Promise<number> {
  if (!server.listening) await new Promise<void>((resolve) => server.once("listening", resolve));
  const addr = server.address();
  if (addr && typeof addr === "object") return addr.port;
  throw new Error("server is not listening on a TCP port");
}

describe("every(): overlap guard, success path, and the fn.name fallback", () => {
  it("skips an overlapping tick while fn is still pending, then allows the next one once it settles", async () => {
    const setIntervalFn = makeSetInterval();
    let resolveFirst = () => {};
    const fn = vi.fn(() => new Promise<void>((r) => { resolveFirst = r; }));
    const log = vi.fn();
    every(setIntervalFn, 100, fn as any, log);
    const cb = setIntervalFn.calls[0].cb;

    const p1 = cb(); // fn call #1 starts; busy flips true synchronously before the await
    await cb(); // overlapping tick: busy guard returns immediately without invoking fn again
    expect(fn).toHaveBeenCalledTimes(1);

    resolveFirst(); // settles fn call #1's promise
    await p1; // wrapper #1 completes, finally releases busy = false

    const p2 = cb(); // now allowed to run again: fn call #2 starts
    expect(fn).toHaveBeenCalledTimes(2);
    resolveFirst(); // resolveFirst was reassigned to fn call #2's resolver
    await p2;
    expect(log).not.toHaveBeenCalled();
  });

  it("logs '<fn.name>: <message>' and swallows the rejection instead of throwing", async () => {
    const setIntervalFn = makeSetInterval();
    const log = vi.fn();
    async function dummyTask() {
      throw new Error("boom");
    }
    every(setIntervalFn, 100, dummyTask, log);
    await expect(setIntervalFn.calls[0].cb()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith("dummyTask: boom");
  });

  it("falls back to the 'task' label when fn has no inferred name", async () => {
    const setIntervalFn = makeSetInterval();
    const log = vi.fn();
    every(setIntervalFn, 100, async () => { throw new Error("boom"); }, log);
    await setIntervalFn.calls[0].cb();
    expect(log).toHaveBeenCalledWith("task: boom");
  });
});

describe("json(): bigint-safe, single-write JSON responses", () => {
  function fakeRes() {
    return {
      headersSent: false,
      statusCode: undefined as number | undefined,
      headers: undefined as Record<string, string> | undefined,
      body: undefined as string | undefined,
      writeHead(status: number, headers: Record<string, string>) {
        this.statusCode = status;
        this.headers = headers;
        this.headersSent = true;
      },
      end(text: string) {
        this.body = text;
      },
    };
  }

  it("writes status, content-type and a bigint-stringified body", () => {
    const res = fakeRes();
    json(res, 200, { ok: true, n: 5n });
    expect(res.statusCode).toBe(200);
    expect(res.headers).toEqual({ "content-type": "application/json" });
    expect(res.body).toBe('{"ok":true,"n":"5"}');
  });

  it("is a no-op once headersSent is true, so a second write never overwrites the first", () => {
    const res = fakeRes();
    json(res, 200, { first: true });
    json(res, 500, { second: true });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('{"first":true}');
  });
});

describe("realDeps(): the production dependency set main.ts wires up", () => {
  it("wires real classes/functions, and buildBeamer resolves via the (mocked) solami builder", async () => {
    const sql = makeSql();
    const config = makeConfig({ grpcUrl: "https://grpc.example", grpcToken: "tok", solamiSwqosKey: "key" });
    const deps = realDeps(config, sql);

    expect(deps.config).toBe(config);
    expect(deps.sql).toBe(sql);
    expect(deps.rpc).toBeInstanceOf(Rpc);
    expect(deps.startGrpc).toBe(realStartGrpcFn);
    expect(deps.startRpcLogs).toBe(realStartRpcLogsFn);
    expect(deps.aggregate).toBe(realAggregateFn);
    expect(deps.land).toBe(realLandFn);
    expect(deps.setInterval).toBe(setInterval);

    const idx = deps.indexerFactory(sql, deps.rpc, "rpc", () => {});
    expect(idx).toBeInstanceOf(Indexer);

    const beamer = await deps.buildBeamer("swqos-key");
    await expect(beamer({} as any)).resolves.toBe("mock-sig");
  });

  it("gives the Rpc a keyless fallback only when an RPC token is set", () => {
    const sql = makeSql();
    const withToken = realDeps(makeConfig({ rpcUrl: "http://provider.fake", rpcToken: "tok" }), sql).rpc as any;
    const without = realDeps(makeConfig({ rpcUrl: "http://provider.fake" }), sql).rpc as any;
    expect(withToken.fallback).toEqual({ urls: "http://fallback1.fake,http://fallback2.fake", rps: 3 });
    expect(without.fallback).toBeUndefined();
  });
});

describe("startWorker(): rpc source (no gRPC endpoint), no beam, fresh capture_start", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let sql: any;
  let rpc: any;
  let indexer: any;
  let setIntervalFn: any;
  let deps: Deps;
  let started: Awaited<ReturnType<typeof startWorker>>;
  let port: number;
  const config = makeConfig({ workerToken: "secret" });

  beforeAll(async () => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    sql = makeSql({
      "select * from health where id = 1": () => [{ id: 1, pools_seen: 5n, source: "rpc" }],
    });
    rpc = makeRpc({ slot: 100, backlog: 3, errors: 2 }); // first getSlot() call -> 101
    indexer = makeIndexer({ lastSlot: 0, pendingSize: 4 });
    setIntervalFn = makeSetInterval();
    deps = baseDeps(config, sql, rpc, indexer, setIntervalFn);
    // ownWallets is parsed from OWN_WALLETS once, synchronously, inside startWorker() itself —
    // it must be set before that call, not inside an individual request test.
    const prevOwn = process.env.OWN_WALLETS;
    process.env.OWN_WALLETS = "walletA,walletB,,";
    started = await startWorker(deps);
    if (prevOwn === undefined) delete process.env.OWN_WALLETS;
    else process.env.OWN_WALLETS = prevOwn;
    port = await portOf(started.server);
  });

  afterAll(() => {
    started.stop();
    logSpy.mockRestore();
  });

  it("resumes pending windows once at startup", () => {
    expect(indexer.resume).toHaveBeenCalledTimes(1);
  });

  it("selects the rpc source and starts startRpcLogs, never startGrpc", () => {
    expect(deps.startGrpc).not.toHaveBeenCalled();
    expect(deps.startRpcLogs).toHaveBeenCalledWith(indexer, rpc, rpc.url, config.wsUrl, expect.any(Function));
  });

  it("falls back capture_start to the fresh chainSlot and logs 'worker up' with landing=rpc", () => {
    const upLine = logSpy.mock.calls.map((c: any) => c.join(" ")).find((l: any) => l.includes("worker up:"));
    expect(upLine).toContain("source=rpc landing=rpc chainSlot=101 captureStart=101");
  });

  it("registers 6 interval tasks for the rpc source, including the 1.5s watched poll", () => {
    expect(setIntervalFn.calls.map((c: any) => c.ms).sort((a: number, b: number) => a - b)).toEqual([1_500, 2_000, 2_000, 5_000, 9_000, 300_000]);
  });

  it("GET /health returns 200 with a bigint-safe body plus pending_windows and rpc_backlog, no auth required", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 1, pools_seen: "5", source: "rpc", pending_windows: 4, rpc_backlog: 3 });
  });

  it("401s with no Authorization header", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/watch`, { method: "POST" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("401s with a wrong bearer token", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/watch`, { method: "POST", headers: { authorization: "Bearer nope" } });
    expect(res.status).toBe(401);
  });

  it("400s on POST /beam when tx is missing from an empty body", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/beam`, { method: "POST", headers: { authorization: "Bearer secret" } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "tx (base64) required" });
  });

  it("400s on POST /beam when the body is not valid JSON (falls back to {})", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/beam`, {
      method: "POST",
      headers: { authorization: "Bearer secret", "content-type": "text/plain" },
      body: "not-json",
    });
    expect(res.status).toBe(400);
  });

  it("POST /beam: a LandError from land() becomes its own status, message and logs", async () => {
    (deps.land as any).mockRejectedValueOnce(new LandError(422, "simulation failed", ["log line"]));
    const res = await fetch(`http://127.0.0.1:${port}/beam`, {
      method: "POST",
      headers: { authorization: "Bearer secret", "content-type": "application/json" },
      body: JSON.stringify({ tx: "base64tx" }),
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "simulation failed", logs: ["log line"] });
  });

  it("POST /beam: a non-LandError from land() becomes 500 and is logged as 'http: <stack>'", async () => {
    (deps.land as any).mockRejectedValueOnce(new Error("boom"));
    const res = await fetch(`http://127.0.0.1:${port}/beam`, {
      method: "POST",
      headers: { authorization: "Bearer secret", "content-type": "application/json" },
      body: JSON.stringify({ tx: "base64tx" }),
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal error" });
    expect(logSpy.mock.calls.some((c: any) => String(c[1] ?? "").startsWith("http: Error: boom"))).toBe(true);
  });

  it("POST /beam: falls back to the raw thrown value when it has no .stack (a rejected non-Error)", async () => {
    (deps.land as any).mockRejectedValueOnce("plain-string-error");
    const res = await fetch(`http://127.0.0.1:${port}/beam`, {
      method: "POST",
      headers: { authorization: "Bearer secret", "content-type": "application/json" },
      body: JSON.stringify({ tx: "base64tx" }),
    });
    expect(res.status).toBe(500);
    expect(logSpy.mock.calls.some((c: any) => String(c[1] ?? "") === "http: plain-string-error")).toBe(true);
  });

  it("logs unhandled promise rejections (using .stack) without crashing the worker", () => {
    process.emit("unhandledRejection", new Error("stray"), Promise.resolve());
    expect(logSpy.mock.calls.some((c: any) => String(c[1] ?? "").startsWith("unhandled: Error: stray"))).toBe(true);
  });

  it("logs uncaught exceptions (using .stack) without crashing the worker", () => {
    process.emit("uncaughtException", new Error("fatal"));
    expect(logSpy.mock.calls.some((c: any) => String(c[1] ?? "").startsWith("uncaught: Error: fatal"))).toBe(true);
  });

  it("logs an unhandled rejection whose reason has no .stack by falling back to the raw value", () => {
    process.emit("unhandledRejection", "stray-reason-no-stack", Promise.resolve());
    expect(logSpy.mock.calls.some((c: any) => String(c[1] ?? "") === "unhandled: stray-reason-no-stack")).toBe(true);
  });

  it("logs an uncaught exception that has no .stack by falling back to the raw value", () => {
    process.emit("uncaughtException", "fatal-no-stack" as any);
    expect(logSpy.mock.calls.some((c: any) => String(c[1] ?? "") === "uncaught: fatal-no-stack")).toBe(true);
  });

  it("POST /beam: success passes sql/rpc/indexer/beam/ownWallets (parsed from OWN_WALLETS at startup) and txBase64 to land()", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/beam`, {
      method: "POST",
      headers: { authorization: "Bearer secret", "content-type": "application/json" },
      body: JSON.stringify({ tx: "base64tx" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sig: "landed-sig", landedSlot: 42, pool: "poolX", via: "rpc", swqos: null });
    const call = (deps.land as any).mock.calls.at(-1)[0];
    expect(call.sql).toBe(sql);
    expect(call.rpc).toBe(rpc);
    expect(call.indexer).toBe(indexer);
    expect(call.beam).toBeNull();
    expect(call.txBase64).toBe("base64tx");
    expect([...call.ownWallets]).toEqual(["walletA", "walletB"]);
  });

  it("POST /watch: marks the pool watched and acks", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/watch`, {
      method: "POST",
      headers: { authorization: "Bearer secret", "content-type": "application/json" },
      body: JSON.stringify({ pool: "poolZ" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(indexer.watch).toHaveBeenCalledWith("poolZ");
  });

  it("POST /watch with no pool in the body watches the empty string", async () => {
    await fetch(`http://127.0.0.1:${port}/watch`, { method: "POST", headers: { authorization: "Bearer secret" } });
    expect(indexer.watch).toHaveBeenCalledWith("");
  });

  it("404s on an unknown path", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/nope`, { headers: { authorization: "Bearer secret" } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("404s on a known path called with the wrong method (GET /beam)", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/beam`, { headers: { authorization: "Bearer secret" } });
    expect(res.status).toBe(404);
  });

  it("the chainSlot (2s) task refreshes indexer.chainSlot from rpc.getSlot()", async () => {
    const twoSec = setIntervalFn.calls.filter((c: any) => c.ms === 2_000);
    const before = indexer.chainSlot;
    await twoSec[0].cb();
    expect(indexer.chainSlot).toBeGreaterThan(before);
  });

  it("the finalize (2s) task calls indexer.tick()", async () => {
    const twoSec = setIntervalFn.calls.filter((c: any) => c.ms === 2_000);
    await twoSec[1].cb();
    expect(indexer.tick).toHaveBeenCalled();
  });

  it("the watched (1.5s, rpc-only) task calls indexer.pollWatched()", async () => {
    const watched = setIntervalFn.calls.find((c: any) => c.ms === 1_500);
    await watched!.cb();
    expect(indexer.pollWatched).toHaveBeenCalled();
  });

  it("the agg task calls deps.aggregate(sql) and logs the windows/configs/ranked summary", async () => {
    const aggTask = setIntervalFn.calls.find((c: any) => c.ms === 9_000);
    await aggTask!.cb();
    expect(deps.aggregate).toHaveBeenCalledWith(sql);
    expect(logSpy.mock.calls.some((c: any) => String(c[1]).includes("agg: 7 windows, 2 configs, 1 ranked"))).toBe(true);
  });

  it("the health task writes lag/reconnects/stats to sql (lastSlot truthy -> numeric lag) and resets per-interval stats", async () => {
    indexer.chainSlot = 150;
    indexer.lastSlot = 100;
    indexer.stats = { poolsSeen: 3, windowsFinal: 2, windowsIncomplete: 1 };
    const healthTask = setIntervalFn.calls.find((c: any) => c.ms === 5_000);
    await healthTask!.cb();
    const call = sql.calls.find((c: SqlCall) => c.text.includes("update health set"));
    expect(call).toBeDefined();
    expect(call!.values[2]).toBe(50); // lag_slots = chainSlot(150) - lastSlot(100)
    expect(indexer.stats).toEqual({ poolsSeen: 0, windowsFinal: 0, windowsIncomplete: 0 });
  });

  it("the prune task deletes old events and expired issued_tx rows", async () => {
    const pruneTask = setIntervalFn.calls.find((c: any) => c.ms === 300_000);
    await pruneTask!.cb();
    expect(sql.calls.some((c: SqlCall) => c.text.includes("delete from events"))).toBe(true);
    expect(sql.calls.some((c: SqlCall) => c.text.includes("delete from issued_tx"))).toBe(true);
  });
});

describe("startWorker(): grpc source (gRPC endpoint set) with beam, and a reused capture_start", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let sql: any;
  let rpc: any;
  let indexer: any;
  let setIntervalFn: any;
  let deps: Deps;
  let started: Awaited<ReturnType<typeof startWorker>>;
  const config = makeConfig({ grpcUrl: "https://grpc.example", grpcToken: "tok-123", solamiSwqosKey: "swqos-key", workerToken: "secret" });

  beforeAll(async () => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    sql = makeSql({
      "select capture_start_slot from health where id = 1": () => [{ capture_start_slot: 777 }],
    });
    rpc = makeRpc({ slot: 50 }); // first getSlot() call -> 51
    indexer = makeIndexer({ lastSlot: 0 });
    setIntervalFn = makeSetInterval();
    deps = baseDeps(config, sql, rpc, indexer, setIntervalFn);
    started = await startWorker(deps);
  });

  afterAll(() => {
    started.stop();
    logSpy.mockRestore();
  });

  it("selects the grpc source and starts startGrpc with the gRPC endpoint and token, never startRpcLogs", () => {
    expect(deps.startRpcLogs).not.toHaveBeenCalled();
    expect(deps.startGrpc).toHaveBeenCalledWith(indexer, "https://grpc.example", "tok-123", expect.any(Function), { onAuthFailure: expect.any(Function) });
  });

  it("builds a beamer from solamiSwqosKey and logs landing=beam with the reused capture_start", () => {
    expect(deps.buildBeamer).toHaveBeenCalledWith("swqos-key");
    expect(started.beam).not.toBeNull();
    const upLine = logSpy.mock.calls.map((c: any) => c.join(" ")).find((l: any) => l.includes("worker up:"));
    expect(upLine).toContain("source=grpc landing=beam chainSlot=51 captureStart=777");
  });

  it("registers only 5 interval tasks for the grpc source (no 1.5s watched poll)", () => {
    expect(setIntervalFn.calls).toHaveLength(5);
    expect(setIntervalFn.calls.some((c: any) => c.ms === 1_500)).toBe(false);
  });

  it("the health task reports a null lag while lastSlot is still 0", async () => {
    const healthTask = setIntervalFn.calls.find((c: any) => c.ms === 5_000);
    await healthTask!.cb();
    const call = sql.calls.find((c: SqlCall) => c.text.includes("update health set"));
    expect(call!.values[2]).toBeNull(); // lag_slots
  });
});

describe("startWorker(): auth guard treats an empty WORKER_TOKEN as always-401", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let started: Awaited<ReturnType<typeof startWorker>>;
  let port: number;
  const config = makeConfig({ workerToken: "" });

  beforeAll(async () => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const sql = makeSql();
    const rpc = makeRpc();
    const indexer = makeIndexer();
    const setIntervalFn = makeSetInterval();
    const deps = baseDeps(config, sql, rpc, indexer, setIntervalFn);
    started = await startWorker(deps);
    port = await portOf(started.server);
  });

  afterAll(() => {
    started.stop();
    logSpy.mockRestore();
  });

  it("401s even when the Authorization header exactly matches 'Bearer ' + the empty token", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/watch`, { method: "POST", headers: { authorization: "Bearer " } });
    expect(res.status).toBe(401);
  });

  it("401s with no header at all", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/watch`, { method: "POST" });
    expect(res.status).toBe(401);
  });
});

describe("startWorker(): grpc cold start replays from the last saved slot, and falls back to keyless on auth failure", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let sql: any;
  let rpc: any;
  let indexer: any;
  let setIntervalFn: any;
  let deps: Deps;
  let started: Awaited<ReturnType<typeof startWorker>>;
  const config = makeConfig({ grpcUrl: "https://grpc.example", grpcToken: "tok" });

  beforeAll(async () => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    sql = makeSql({ "select last_slot from health where id = 1": () => [{ last_slot: "40" }] });
    rpc = makeRpc({ slot: 50 }); // chainSlot 51 > saved 40
    indexer = makeIndexer();
    setIntervalFn = makeSetInterval();
    deps = baseDeps(config, sql, rpc, indexer, setIntervalFn);
    started = await startWorker(deps);
  });

  afterAll(() => {
    started.stop();
    logSpy.mockRestore();
  });

  it("seeds indexer.lastSlot from health.last_slot so the stream replays the redeploy gap", () => {
    expect(indexer.lastSlot).toBe(40);
  });

  it("onAuthFailure switches to the keyless logs source on the fallback endpoints and starts the watched poll", async () => {
    const { onAuthFailure } = (deps.startGrpc as any).mock.calls[0][4];
    const before = setIntervalFn.calls.length;
    onAuthFailure();
    expect(indexer.source).toBe("rpc");
    expect(deps.startRpcLogs).toHaveBeenCalledWith(indexer, rpc, "http://fallback1.fake", "wss://fallback.fake", expect.any(Function));
    expect(setIntervalFn.calls.length).toBe(before + 1);
    expect(setIntervalFn.calls.at(-1).ms).toBe(1_500);
    await new Promise((r) => setImmediate(r));
    expect(sql.calls.some((c: SqlCall) => c.text.includes("update health set source = 'rpc'"))).toBe(true);
    expect(logSpy.mock.calls.some((c: any) => c.join(" ").includes("source=rpc (fallback)"))).toBe(true);
  });

  it("logs, rather than throws, when the health source update fails", async () => {
    const failing = makeSql({ "update health set source": () => Promise.reject(new Error("db down")) });
    const d2 = baseDeps(config, failing, makeRpc({ slot: 50 }), makeIndexer(), makeSetInterval());
    const w2 = await startWorker(d2);
    expect(() => (d2.startGrpc as any).mock.calls[0][4].onAuthFailure()).not.toThrow();
    await new Promise((r) => setImmediate(r));
    expect(logSpy.mock.calls.some((c: any) => c.join(" ").includes("health: db down"))).toBe(true);
    w2.stop();
  });
});

describe("startWorker(): no replay seed when the saved slot is missing or the source is rpc", () => {
  it("leaves lastSlot at 0 for the rpc source even with a saved slot", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const indexer = makeIndexer();
    const sql = makeSql({ "select last_slot from health where id = 1": () => [{ last_slot: "40" }] });
    const w = await startWorker(baseDeps(makeConfig(), sql, makeRpc({ slot: 50 }), indexer, makeSetInterval()));
    expect(indexer.lastSlot).toBe(0);
    w.stop();
    logSpy.mockRestore();
  });
});

