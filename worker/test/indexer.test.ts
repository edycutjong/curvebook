// Pins Indexer's real behavior: queries issued (shape + key values), state transitions
// (pending map, configs cache, stats), and events written — against real DBC decoding
// wherever a fixture is available.
//
// `sql` is faked as a porsager-style tagged-template function: it joins the template
// strings, matches a handler by substring, and logs every call (text + positional
// values) so assertions can inspect exactly what was issued. `.json()` wraps its
// argument in a marker object (no real serialization needed); `.begin(fn)` just runs
// `fn` against the same fake, since writeWindow's transaction is three plain queries.
import { readFileSync } from "node:fs";
import bs58 from "bs58";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DBC_PROGRAM_ID, FINALIZE_LAG_SLOTS, WINDOW_SLOTS, decodePoolConfig, decodeTx,
  type ConfigInfo, type InitEvent, type RawTx, type SwapEvent,
} from "@curvebook/core";
import { Indexer, type Source } from "../src/indexer.js";

// Default implementation delegates to the real crawlWindow, so every test that does not
// override it with mockResolvedValueOnce/mockRejectedValueOnce exercises the real RPC-paging
// + decode logic (see "finalize via tick()" > "real crawl" below).
vi.mock("../src/crawl.js", async () => {
  const actual = await vi.importActual<typeof import("../src/crawl.js")>("../src/crawl.js");
  return { ...actual, crawlWindow: vi.fn(actual.crawlWindow) };
});
import { crawlWindow } from "../src/crawl.js";

const fx = (n: string): RawTx => JSON.parse(readFileSync(new URL(`../../core/test/fixtures/${n}.json`, import.meta.url), "utf8"));
const cfgRaw = JSON.parse(readFileSync(new URL("../../core/test/fixtures/config-3yFxSqnZ.json", import.meta.url), "utf8")) as {
  address: string; owner: string; data: string;
};
const CFG_BUF = () => Buffer.from(cfgRaw.data, "base64");
/** Real decoded config of the mainnet 3yFx... PoolConfig (owner = DBC program), from init.json's launch. */
const REAL_CFG: ConfigInfo = decodePoolConfig(cfgRaw.address, CFG_BUF());

// --- fakes --------------------------------------------------------------------------

type SqlCall = { text: string; values: unknown[] };
type SqlHandler = unknown[] | ((values: unknown[]) => unknown[] | Promise<unknown[]>);

function fakeSql(handlers: Record<string, SqlHandler> = {}): any {
  const log: SqlCall[] = [];
  const sql = (strings: readonly string[], ...values: unknown[]) => {
    const text = strings.join(" ").replace(/\s+/g, " ").trim();
    log.push({ text, values });
    for (const key of Object.keys(handlers)) {
      if (text.includes(key)) {
        const h = handlers[key];
        return Promise.resolve(typeof h === "function" ? h(values) : h);
      }
    }
    return Promise.resolve([]);
  };
  sql.json = (v: unknown) => ({ __pgJson: v });
  sql.begin = async (fn: (tx: unknown) => unknown) => fn(sql);
  sql.log = log;
  return sql;
}

type RpcOverrides = Partial<{
  getAccountData: (addr: string) => Promise<{ owner: string; data: Buffer } | null>;
  getTransaction: (sig: string) => Promise<RawTx | null>;
  getSignaturesForAddress: (
    addr: string,
    opts?: { limit?: number; before?: string },
  ) => Promise<{ signature: string; slot: number; err: unknown; blockTime: number | null }[]>;
}>;

function fakeRpc(overrides: RpcOverrides = {}): any {
  return {
    getAccountData: overrides.getAccountData ?? (async () => null),
    getTransaction: overrides.getTransaction ?? (async () => null),
    getSignaturesForAddress: overrides.getSignaturesForAddress ?? (async () => []),
  };
}

/** A fake, DBC-owned account carrying the real 3yFx PoolConfig bytes (content doesn't depend on `address`). */
const dbcAccount = () => ({ owner: DBC_PROGRAM_ID, data: CFG_BUF() });

function makeIndexer(sql: any, rpc: any, source: Source = "rpc", log?: (...a: unknown[]) => void) {
  return log ? new Indexer(sql, rpc, source, log) : new Indexer(sql, rpc, source);
}

function makeInit(p: { pool: string; config: string; creator?: string; slot?: number; blockTime?: number | null; activationPoint?: bigint; sig?: string }): InitEvent {
  return {
    kind: "init",
    sig: p.sig ?? `sig-${p.pool}`,
    slot: p.slot ?? 1000,
    blockTime: p.blockTime === undefined ? 1_700_000_000 : p.blockTime,
    pool: p.pool,
    config: p.config,
    creator: p.creator ?? "CREATOR",
    baseMint: "BASE",
    poolType: 0,
    activationPoint: p.activationPoint ?? BigInt(p.slot ?? 1000),
    transferHook: false,
  };
}

function makeSwap(p: { pool: string; slot: number; config?: string; payer?: string | null; tradeDirection?: number; viaCpi?: boolean; output?: bigint; includedFeeInput?: bigint; excludedFeeInput?: bigint; sig?: string }): SwapEvent {
  return {
    kind: "swap",
    sig: p.sig ?? `swap-${p.pool}-${p.slot}`,
    slot: p.slot,
    blockTime: null,
    pool: p.pool,
    config: p.config ?? "CFG",
    tradeDirection: p.tradeDirection ?? 1,
    hasReferral: false,
    payer: p.payer === undefined ? "PAYER" : p.payer,
    viaCpi: p.viaCpi ?? false,
    includedFeeInput: p.includedFeeInput ?? 1_000n,
    excludedFeeInput: p.excludedFeeInput ?? 990n,
    output: p.output ?? 123n,
    tradingFee: 8n,
    protocolFee: 2n,
    referralFee: 0n,
    currentTimestamp: 0n,
    transferHook: false,
  };
}

/** The pending map's value shape (type is not exported by indexer.ts). */
function pendingEntry(init: InitEvent, open: number | null, opts: { dueSlot: number; attempts?: number; watched?: boolean }) {
  return { init, open, dueSlot: opts.dueSlot, attempts: opts.attempts ?? 0, watched: opts.watched ?? false };
}

beforeEach(() => {
  vi.mocked(crawlWindow).mockClear();
});

// --- config() -------------------------------------------------------------------------

describe("config()", () => {
  it("fetches, decodes, and caches a config account", async () => {
    let calls = 0;
    const rpc = fakeRpc({ getAccountData: async () => { calls++; return dbcAccount(); } });
    const sql = fakeSql();
    const indexer = makeIndexer(sql, rpc);

    const cfg = await indexer.config("ANY-ADDR");
    expect(cfg?.swapBaseAmount).toBe(REAL_CFG.swapBaseAmount);
    expect(cfg?.quoteMint).toBe(REAL_CFG.quoteMint);
    expect(indexer.configs.get("ANY-ADDR")).toBe(cfg);
    expect(sql.log.some((c: SqlCall) => c.text.includes("insert into configs ("))).toBe(true);

    const second = await indexer.config("ANY-ADDR");
    expect(second).toBe(cfg);
    expect(calls).toBe(1); // cache hit: no second RPC round-trip
  });

  it("dedupes concurrent fetches of the same address into a single RPC call", async () => {
    let calls = 0;
    let resolve!: (v: { owner: string; data: Buffer } | null) => void;
    const rpc = fakeRpc({
      getAccountData: async () => {
        calls++;
        return new Promise((r) => { resolve = r; });
      },
    });
    const indexer = makeIndexer(fakeSql(), rpc);

    const p1 = indexer.config("DUP-ADDR");
    const p2 = indexer.config("DUP-ADDR");
    expect(calls).toBe(1);
    resolve(dbcAccount());
    const [c1, c2] = await Promise.all([p1, p2]);
    expect(c1).toBe(c2);
    expect(c1?.address).toBe("DUP-ADDR"); // decodePoolConfig stamps the address it was asked for
    expect(c1?.swapBaseAmount).toBe(REAL_CFG.swapBaseAmount);
  });

  it("resolves null and never caches an account owned by a different program", async () => {
    let calls = 0;
    const rpc = fakeRpc({ getAccountData: async () => { calls++; return { owner: "NotTheDbcProgram11111111111111111111111", data: Buffer.alloc(1) }; } });
    const sql = fakeSql();
    const indexer = makeIndexer(sql, rpc);

    expect(await indexer.config("OTHER-OWNER")).toBeNull();
    expect(indexer.configs.has("OTHER-OWNER")).toBe(false);
    expect(sql.log.some((c: SqlCall) => c.text.includes("insert into configs ("))).toBe(false);

    await indexer.config("OTHER-OWNER");
    expect(calls).toBe(2); // not cached: refetched
  });

  it("resolves null when the account does not exist", async () => {
    const indexer = makeIndexer(fakeSql(), fakeRpc({ getAccountData: async () => null }));
    expect(await indexer.config("MISSING")).toBeNull();
    expect(indexer.configs.has("MISSING")).toBe(false);
  });
});

// --- onInit -----------------------------------------------------------------------------

describe("onInit", () => {
  const init = fx("init");
  const ev = decodeTx(init).find((e) => e.kind === "init") as InitEvent;

  it("inserts a new pool, logs an init event, and tracks it for finalize", async () => {
    const sql = fakeSql({ "insert into pools (": () => [{ address: ev.pool }], "from launches": () => [] });
    const rpc = fakeRpc({ getAccountData: async () => dbcAccount() });
    const indexer = makeIndexer(sql, rpc);

    await indexer.onInit(ev);

    expect(indexer.stats.poolsSeen).toBe(1);
    const insert = sql.log.find((c: SqlCall) => c.text.includes("insert into pools ("));
    expect(insert.values[0]).toBe(ev.pool);
    expect(insert.values[7]).toBe(ev.activationPoint.toString());
    expect(insert.values[8]).toBe(ev.slot); // slot activation, activationPoint <= slot => open = slot
    expect(insert.values[10]).toBe("rpc");

    const evt = sql.log.find((c: SqlCall) => c.text.includes("insert into events (") && c.values[0] === "init");
    expect(evt).toBeDefined();
    expect(evt.values.slice(2, 5)).toEqual([ev.sig, ev.pool, ev.config]);

    const pending = indexer.pending.get(ev.pool);
    expect(pending?.open).toBe(ev.slot);
    expect(pending?.watched).toBe(false);
    expect(pending?.dueSlot).toBe(ev.slot + WINDOW_SLOTS + FINALIZE_LAG_SLOTS);
  });

  it("marks a pool watched when a launches row already references it", async () => {
    const sql = fakeSql({ "insert into pools (": () => [{ address: ev.pool }], "from launches": () => [{ x: 1 }] });
    const indexer = makeIndexer(sql, fakeRpc({ getAccountData: async () => dbcAccount() }));
    await indexer.onInit(ev);
    expect(indexer.pending.get(ev.pool)?.watched).toBe(true);
  });

  it("skips a pool it is already tracking without touching the database", async () => {
    const sql = fakeSql();
    const indexer = makeIndexer(sql, fakeRpc());
    indexer.pending.set(ev.pool, pendingEntry(ev, ev.slot, { dueSlot: 0 }));
    await indexer.onInit(ev);
    expect(sql.log).toHaveLength(0);
  });

  it("treats an ON CONFLICT no-op as a duplicate: no new event, but still re-tracked", async () => {
    let insertCount = 0;
    const sql = fakeSql({
      "insert into pools (": () => (insertCount++ === 0 ? [{ address: ev.pool }] : []),
      "from launches": () => [],
    });
    const indexer = makeIndexer(sql, fakeRpc({ getAccountData: async () => dbcAccount() }));

    await indexer.onInit(ev);
    expect(indexer.stats.poolsSeen).toBe(1);
    indexer.pending.delete(ev.pool); // simulate the window having already been finalized away

    await indexer.onInit(ev);
    expect(indexer.stats.poolsSeen).toBe(1); // unchanged: on conflict do nothing returned no row
    expect(sql.log.filter((c: SqlCall) => c.text.includes("insert into events (") && c.values[0] === "init")).toHaveLength(1);
    expect(indexer.pending.has(ev.pool)).toBe(true); // re-tracked regardless
  });

  it("never inserts or tracks a pool whose config account is not DBC-owned", async () => {
    const sql = fakeSql();
    const rpc = fakeRpc({ getAccountData: async () => ({ owner: "SomeOtherProgram1111111111111111111111111", data: Buffer.alloc(1) }) });
    const indexer = makeIndexer(sql, rpc);

    await indexer.onInit(ev);

    expect(sql.log.some((c: SqlCall) => c.text.includes("insert into pools ("))).toBe(false);
    expect(indexer.pending.has(ev.pool)).toBe(false);
    expect(indexer.stats.poolsSeen).toBe(0);
  });

  it("stamps the current time as created_at when the event carries no blockTime", async () => {
    const sql = fakeSql({ "insert into pools (": () => [{ address: "P" }], "from launches": () => [] });
    const indexer = makeIndexer(sql, fakeRpc({ getAccountData: async () => dbcAccount() }));
    const noBlockTime = makeInit({ pool: "P", config: "C", slot: 50, blockTime: null });

    await indexer.onInit(noBlockTime);

    const insert = sql.log.find((c: SqlCall) => c.text.includes("insert into pools ("));
    expect(insert.values[6]).toBeInstanceOf(Date);
  });
});

// --- track() dueSlot estimate for a future timestamp activation -----------------------

describe("track() dueSlot estimate (timestamp activation, open not yet known)", () => {
  it("projects dueSlot from the activation timestamp at ~0.4s/slot", () => {
    const indexer = makeIndexer(fakeSql(), fakeRpc());
    const init = makeInit({ pool: "P", config: "C", slot: 1000, blockTime: 5000, activationPoint: 5040n }); // 40s later
    (indexer as any).track(init, null, false);
    // ceil(40 / 0.4) = 100 slots away; + WINDOW_SLOTS + FINALIZE_LAG_SLOTS
    expect(indexer.pending.get("P")?.dueSlot).toBe(1000 + 100 + WINDOW_SLOTS + FINALIZE_LAG_SLOTS);
  });

  it("clamps the estimate to the init slot when the activation point has already passed", () => {
    const indexer = makeIndexer(fakeSql(), fakeRpc());
    const init = makeInit({ pool: "P", config: "C", slot: 2000, blockTime: 5000, activationPoint: 4000n }); // already past
    (indexer as any).track(init, null, false);
    expect(indexer.pending.get("P")?.dueSlot).toBe(2000 + WINDOW_SLOTS + FINALIZE_LAG_SLOTS);
  });
});

// --- watch() ----------------------------------------------------------------------------

describe("watch()", () => {
  it("marks a pending pool as watched", () => {
    const indexer = makeIndexer(fakeSql(), fakeRpc());
    const init = makeInit({ pool: "P", config: "C" });
    indexer.pending.set("P", pendingEntry(init, 10, { dueSlot: 999, watched: false }));
    indexer.watch("P");
    expect(indexer.pending.get("P")?.watched).toBe(true);
  });

  it("is a no-op for a pool that is not pending", () => {
    const indexer = makeIndexer(fakeSql(), fakeRpc());
    expect(() => indexer.watch("ABSENT")).not.toThrow();
    expect(indexer.pending.size).toBe(0);
  });
});

// --- onTx ----------------------------------------------------------------------------------

/** A synthetic migrate_meteora_damm instruction (no mainnet fixture carries one). */
function migrationTx(): RawTx {
  const disc = Buffer.from([27, 1, 48, 22, 180, 63, 118, 217]); // migrate_meteora_damm discriminator
  const accountKeys = [
    DBC_PROGRAM_ID, "VPOOL-ADDR", "META-ADDR", "CFG-ADDR",
    ...Array.from({ length: 22 }, (_, i) => `ACC${i}`),
  ]; // [0]=programId, [1..25]=the 25 migrate_meteora_damm accounts (virtual_pool, migration_metadata, config, ...)
  return {
    slot: 999,
    blockTime: 1_700_000_500,
    meta: { err: null, innerInstructions: [] },
    transaction: {
      signatures: ["MIGRATION-SIG"],
      message: {
        accountKeys,
        instructions: [{ programIdIndex: 0, accounts: Array.from({ length: 25 }, (_, i) => i + 1), data: bs58.encode(disc) }],
      },
    },
  };
}

describe("onTx", () => {
  it("routes every decoded event kind, including a curve-complete, to its handler", async () => {
    const tx = fx("complete");
    const complete = decodeTx(tx).find((e) => e.kind === "complete")!;
    const sql = fakeSql({ "graduated_slot = ": () => [{ config: complete.config }] });
    const indexer = makeIndexer(sql, fakeRpc());

    await indexer.onTx(tx);

    expect(indexer.lastSlot).toBe(tx.slot);
    const update = sql.log.find((c: SqlCall) => c.text.includes("graduated_slot = "));
    expect(update.values.slice(2, 4)).toEqual([complete.sig, complete.pool]);
    expect(sql.log.some((c: SqlCall) => c.text.includes("insert into events (") && c.values[0] === "graduated")).toBe(true);
  });

  it("also graduates a pool whose liquidity migrated to DAMM (no EvtCurveComplete present)", async () => {
    const tx = migrationTx();
    const sql = fakeSql({ "graduated_slot = ": () => [{ config: "CFG-ADDR" }] });
    const indexer = makeIndexer(sql, fakeRpc());

    await indexer.onTx(tx);

    const update = sql.log.find((c: SqlCall) => c.text.includes("graduated_slot = "));
    expect(update.values).toEqual([999, new Date(1_700_000_500 * 1000), "MIGRATION-SIG", "VPOOL-ADDR"]);
  });
});

// --- onLiveSwap guards & insert ---------------------------------------------------------

describe("onLiveSwap", () => {
  it("ignores a swap for a pool it is not tracking", async () => {
    const sql = fakeSql();
    const indexer = makeIndexer(sql, fakeRpc());
    await indexer.onLiveSwap(makeSwap({ pool: "UNKNOWN", slot: 5 }));
    expect(sql.log).toHaveLength(0);
  });

  it("ignores a swap while the pool's open slot is not yet known", async () => {
    const sql = fakeSql();
    const indexer = makeIndexer(sql, fakeRpc());
    indexer.pending.set("P", pendingEntry(makeInit({ pool: "P", config: "C" }), null, { dueSlot: 0 }));
    await indexer.onLiveSwap(makeSwap({ pool: "P", slot: 5 }));
    expect(sql.log).toHaveLength(0);
  });

  it("ignores a sell (trade direction 0)", async () => {
    const sql = fakeSql();
    const indexer = makeIndexer(sql, fakeRpc());
    indexer.pending.set("P", pendingEntry(makeInit({ pool: "P", config: "C" }), 100, { dueSlot: 0 }));
    await indexer.onLiveSwap(makeSwap({ pool: "P", slot: 102, tradeDirection: 0 }));
    expect(sql.log).toHaveLength(0);
  });

  it("ignores a buy outside the 10-slot window", async () => {
    const sql = fakeSql();
    const indexer = makeIndexer(sql, fakeRpc());
    indexer.pending.set("P", pendingEntry(makeInit({ pool: "P", config: "C" }), 100, { dueSlot: 0 }));
    await indexer.onLiveSwap(makeSwap({ pool: "P", slot: 100 + WINDOW_SLOTS, tradeDirection: 1 }));
    expect(sql.log).toHaveLength(0);
  });

  it("inserts a window_buys row and a buy event for a qualifying buy", async () => {
    const sql = fakeSql();
    const indexer = makeIndexer(sql, fakeRpc());
    const init = makeInit({ pool: "P", config: "CFG", creator: "CREATOR" });
    indexer.pending.set("P", pendingEntry(init, 100, { dueSlot: 0 }));
    const swap = makeSwap({ pool: "P", slot: 103, payer: "SOMEONE-ELSE", viaCpi: true, output: 777n, includedFeeInput: 1000n, excludedFeeInput: 950n });

    await indexer.onLiveSwap(swap);

    const insert = sql.log.find((c: SqlCall) => c.text.includes("insert into window_buys ("));
    // the trailing `confirmed` column is written as a literal `false` in the SQL text, not a
    // ${} placeholder, so it never lands in `values`.
    expect(insert.values).toEqual([swap.sig, "P", 0, 103, 3, "SOMEONE-ELSE", false, true, "1000", "50", "777"]);
    const evt = sql.log.find((c: SqlCall) => c.text.includes("insert into events (") && c.values[0] === "buy");
    expect(evt.values[6]).toEqual({ __pgJson: { offset: 3, base_out: "777", creator: false, via_cpi: true } });
  });

  it("flags the creator's own buy as is_creator", async () => {
    const sql = fakeSql();
    const indexer = makeIndexer(sql, fakeRpc());
    const init = makeInit({ pool: "P", config: "CFG", creator: "CREATOR" });
    indexer.pending.set("P", pendingEntry(init, 100, { dueSlot: 0 }));
    await indexer.onLiveSwap(makeSwap({ pool: "P", slot: 100, payer: "CREATOR" }));
    const insert = sql.log.find((c: SqlCall) => c.text.includes("insert into window_buys ("));
    expect(insert.values[6]).toBe(true);
  });
});

// --- onGraduated --------------------------------------------------------------------------

describe("onGraduated", () => {
  it("logs a graduated event when the update matches a row", async () => {
    const sql = fakeSql({ "graduated_slot = ": () => [{ config: "CFG" }] });
    const indexer = makeIndexer(sql, fakeRpc());
    await indexer.onGraduated("POOL", 42, 1_700_000_000, "SIG");
    const update = sql.log.find((c: SqlCall) => c.text.includes("graduated_slot = "));
    expect(update.values[3]).toBe("POOL");
    const evt = sql.log.find((c: SqlCall) => c.text.includes("insert into events (") && c.values[0] === "graduated");
    expect(evt.values.slice(1, 5)).toEqual([42, "SIG", "POOL", "CFG"]);
    expect(evt.values[6]).toBeNull(); // detail = null, not wrapped
  });

  it("logs nothing when no row is updated (already graduated)", async () => {
    const sql = fakeSql({ "graduated_slot = ": () => [] });
    const indexer = makeIndexer(sql, fakeRpc());
    await indexer.onGraduated("POOL", 42, null, "SIG");
    expect(sql.log.some((c: SqlCall) => c.text.includes("insert into events ("))).toBe(false);
  });
});

// --- event() ------------------------------------------------------------------------------

describe("event()", () => {
  it("wraps a non-null detail as JSON and passes a null detail through unwrapped", async () => {
    const sql = fakeSql();
    const indexer = makeIndexer(sql, fakeRpc(), "grpc");
    await indexer.event("init", 1, "SIG1", "POOL1", "CFG1", "PAYER1", { a: 1 });
    await indexer.event("graduated", 2, "SIG2", null, null, null, null);

    const [e1, e2] = sql.log;
    expect(e1.values).toEqual(["init", 1, "SIG1", "POOL1", "CFG1", "PAYER1", { __pgJson: { a: 1 } }, "grpc"]);
    expect(e2.values).toEqual(["graduated", 2, "SIG2", null, null, null, null, "grpc"]);
  });
});

// --- resume() -----------------------------------------------------------------------------

describe("resume()", () => {
  it("re-tracks every window still pending finalize, carrying open_slot and watched through", async () => {
    const rows = [
      {
        address: "POOL1", config: "CFG1", creator: "CREATOR1", base_mint: "BASE1", create_sig: "SIG1",
        create_slot: 1000, created_at: new Date(1_700_000_000 * 1000), activation_point: "1000",
        open_slot: 1005, transfer_hook: false, watched: true,
      },
      {
        address: "POOL2", config: "CFG2", creator: "CREATOR2", base_mint: "BASE2", create_sig: "SIG2",
        create_slot: 2000, created_at: null, activation_point: "2000",
        open_slot: null, transfer_hook: true, watched: false,
      },
    ];
    const sql = fakeSql({ "from pools p": () => rows });
    const log = vi.fn();
    const indexer = makeIndexer(sql, fakeRpc(), "rpc", log);

    await indexer.resume();

    const p1 = indexer.pending.get("POOL1");
    expect(p1?.open).toBe(1005);
    expect(p1?.watched).toBe(true);
    expect(p1?.dueSlot).toBe(1005 + WINDOW_SLOTS + FINALIZE_LAG_SLOTS);
    expect(p1?.init.blockTime).toBe(1_700_000_000);

    const p2 = indexer.pending.get("POOL2");
    expect(p2?.open).toBeNull();
    expect(p2?.watched).toBe(false);
    expect(p2?.init.blockTime).toBeNull();
    // timestamp estimate: slot 2000, blockTime 0 (no created_at), activationPoint 2000 => 5000 slots away
    expect(p2?.dueSlot).toBe(2000 + 5000 + WINDOW_SLOTS + FINALIZE_LAG_SLOTS);

    expect(log).toHaveBeenCalledWith("resumed 2 pending windows");
  });

  it("logs nothing when there is nothing to resume", async () => {
    const log = vi.fn();
    const indexer = makeIndexer(fakeSql({ "from pools p": () => [] }), fakeRpc(), "rpc", log);
    await indexer.resume();
    expect(log).not.toHaveBeenCalled();
    expect(indexer.pending.size).toBe(0);
  });
});

// --- finalize() via tick() -----------------------------------------------------------------

describe("finalize via tick()", () => {
  it("[real crawl] rebuilds the bundled creator buy from the init fixture and writes a complete window", async () => {
    const init = fx("init");
    const ev = decodeTx(init).find((e) => e.kind === "init") as InitEvent;
    const rpc = fakeRpc({
      getSignaturesForAddress: async () => [{ signature: ev.sig, slot: ev.slot, err: null, blockTime: ev.blockTime }],
      getTransaction: async (sig) => (sig === ev.sig ? init : null),
    });
    const sql = fakeSql();
    const indexer = makeIndexer(sql, rpc, "rpc");
    indexer.configs.set(ev.config, REAL_CFG);
    indexer.chainSlot = ev.slot + WINDOW_SLOTS + FINALIZE_LAG_SLOTS;
    indexer.pending.set(ev.pool, pendingEntry(ev, ev.slot, { dueSlot: indexer.chainSlot }));

    await indexer.tick();

    expect(vi.mocked(crawlWindow)).toHaveBeenCalledTimes(1); // real implementation, not overridden
    const win = sql.log.find((c: SqlCall) => c.text.includes("insert into pool_windows ("));
    expect(win.values[11]).toBe(true); // complete
    expect(win.values[12]).toBe("rpc"); // source === "rpc" => label "rpc"
    expect(win.values[10]).toBe(1); // one buy (the creator's bundled buy)
    expect(sql.log.filter((c: SqlCall) => c.text.includes("insert into events (") && c.values[0] === "buy")).toHaveLength(1);
    expect(sql.log.some((c: SqlCall) => c.text.includes("insert into events (") && c.values[0] === "window")).toBe(true);
    expect(indexer.stats.windowsFinal).toBe(1);
    expect(indexer.pending.has(ev.pool)).toBe(false);
  });

  it("writes a complete window labeled 'grpc+rpc' without per-buy events when source is grpc", async () => {
    const OPEN = 100;
    const init = makeInit({ pool: "P", config: "CFG", creator: "CREATOR" });
    const buy = makeSwap({ pool: "P", slot: OPEN + 2, payer: "NON-CREATOR", output: 50n });
    vi.mocked(crawlWindow).mockResolvedValueOnce({ open: OPEN, swaps: [buy], complete: true, createBlockTime: null });

    const sql = fakeSql();
    const indexer = makeIndexer(sql, fakeRpc(), "grpc");
    indexer.configs.set("CFG", REAL_CFG);
    indexer.chainSlot = OPEN + WINDOW_SLOTS + FINALIZE_LAG_SLOTS;
    indexer.pending.set("P", pendingEntry(init, OPEN, { dueSlot: indexer.chainSlot }));

    await indexer.tick();

    const win = sql.log.find((c: SqlCall) => c.text.includes("insert into pool_windows ("));
    expect(win.values[11]).toBe(true);
    expect(win.values[12]).toBe("grpc+rpc");
    expect(sql.log.some((c: SqlCall) => c.text.includes("insert into events (") && c.values[0] === "buy")).toBe(false);
    expect(indexer.stats.windowsFinal).toBe(1);
  });

  it("deletes a pending window outright when its config account is gone (never crawls)", async () => {
    const init = makeInit({ pool: "P", config: "CFG" });
    const rpc = fakeRpc({ getAccountData: async () => ({ owner: "NotDbc111111111111111111111111111111111", data: Buffer.alloc(1) }) });
    const indexer = makeIndexer(fakeSql(), rpc, "rpc");
    indexer.chainSlot = 1000;
    indexer.pending.set("P", pendingEntry(init, 100, { dueSlot: 1000 }));

    await indexer.tick();

    expect(vi.mocked(crawlWindow)).not.toHaveBeenCalled();
    expect(indexer.pending.has("P")).toBe(false);
  });

  it("reschedules (without deleting) when the timestamp activation hasn't opened yet", async () => {
    vi.mocked(crawlWindow).mockResolvedValueOnce({ open: null, swaps: [], complete: false, createBlockTime: null });
    const init = makeInit({ pool: "P", config: "CFG" });
    const indexer = makeIndexer(fakeSql(), fakeRpc(), "rpc");
    indexer.configs.set("CFG", REAL_CFG);
    indexer.chainSlot = 1000;
    indexer.pending.set("P", pendingEntry(init, null, { dueSlot: 1000, attempts: 0 }));

    await indexer.tick();

    const p = indexer.pending.get("P");
    expect(p).toBeDefined();
    expect(p?.dueSlot).toBe(1075);
    expect(p?.attempts).toBe(1);
  });

  it("gives up on an open-slot estimate that never resolves after too many attempts", async () => {
    vi.mocked(crawlWindow).mockResolvedValueOnce({ open: null, swaps: [], complete: false, createBlockTime: null });
    const init = makeInit({ pool: "P", config: "CFG" });
    const indexer = makeIndexer(fakeSql(), fakeRpc(), "rpc");
    indexer.configs.set("CFG", REAL_CFG);
    indexer.chainSlot = 1000;
    indexer.pending.set("P", pendingEntry(init, null, { dueSlot: 1000, attempts: 24 })); // MAX_ATTEMPTS * 4

    await indexer.tick();

    expect(indexer.pending.has("P")).toBe(false);
  });

  it("retries an incomplete crawl (reschedules, does not write)", async () => {
    const OPEN = 100;
    vi.mocked(crawlWindow).mockResolvedValueOnce({ open: OPEN, swaps: [], complete: false, createBlockTime: null });
    const init = makeInit({ pool: "P", config: "CFG" });
    const sql = fakeSql();
    const indexer = makeIndexer(sql, fakeRpc(), "rpc");
    indexer.configs.set("CFG", REAL_CFG);
    indexer.chainSlot = OPEN + WINDOW_SLOTS + FINALIZE_LAG_SLOTS;
    indexer.pending.set("P", pendingEntry(init, OPEN, { dueSlot: indexer.chainSlot, attempts: 0 }));

    await indexer.tick();

    const p = indexer.pending.get("P");
    expect(p?.dueSlot).toBe(indexer.chainSlot + 25);
    expect(p?.attempts).toBe(1);
    expect(sql.log.some((c: SqlCall) => c.text.includes("insert into pool_windows ("))).toBe(false);
  });

  it("writes an incomplete window anyway once the retry budget is exhausted", async () => {
    const OPEN = 100;
    vi.mocked(crawlWindow).mockResolvedValueOnce({ open: OPEN, swaps: [], complete: false, createBlockTime: null });
    const init = makeInit({ pool: "P", config: "CFG" });
    const sql = fakeSql();
    const indexer = makeIndexer(sql, fakeRpc(), "rpc");
    indexer.configs.set("CFG", REAL_CFG);
    indexer.chainSlot = OPEN + WINDOW_SLOTS + FINALIZE_LAG_SLOTS;
    indexer.pending.set("P", pendingEntry(init, OPEN, { dueSlot: indexer.chainSlot, attempts: 5 })); // one short of MAX_ATTEMPTS (6)

    await indexer.tick();

    const win = sql.log.find((c: SqlCall) => c.text.includes("insert into pool_windows ("));
    expect(win.values[11]).toBe(false); // written as incomplete
    expect(indexer.stats.windowsIncomplete).toBe(1);
    expect(indexer.pending.has("P")).toBe(false);
  });

  it("on a crawl error, reschedules without dropping while under the attempt budget", async () => {
    vi.mocked(crawlWindow).mockRejectedValueOnce(new Error("rpc boom"));
    const init = makeInit({ pool: "P", config: "CFG" });
    const log = vi.fn();
    const indexer = makeIndexer(fakeSql(), fakeRpc(), "rpc", log);
    indexer.configs.set("CFG", REAL_CFG);
    indexer.chainSlot = 1000;
    indexer.pending.set("P", pendingEntry(init, 100, { dueSlot: 1000, attempts: 0 }));

    await indexer.tick();

    const p = indexer.pending.get("P");
    expect(p).toBeDefined();
    expect(p?.attempts).toBe(1);
    expect(p?.dueSlot).toBe(1025);
    expect(log).not.toHaveBeenCalled();
    expect(indexer.stats.windowsIncomplete).toBe(0);
  });

  it("drops a window and logs it after repeated crawl errors exhaust the attempt budget", async () => {
    vi.mocked(crawlWindow).mockRejectedValueOnce(new Error("rpc boom"));
    const init = makeInit({ pool: "P", config: "CFG" });
    const log = vi.fn();
    const indexer = makeIndexer(fakeSql(), fakeRpc(), "rpc", log);
    indexer.configs.set("CFG", REAL_CFG);
    indexer.chainSlot = 1000;
    indexer.pending.set("P", pendingEntry(init, 100, { dueSlot: 1000, attempts: 5 })); // next failure hits MAX_ATTEMPTS (6)

    await indexer.tick();

    expect(indexer.pending.has("P")).toBe(false);
    expect(indexer.stats.windowsIncomplete).toBe(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain("dropped after 6 attempts");
    expect(log.mock.calls[0][0]).toContain("rpc boom");
  });

  it("tick() skips windows not yet due and windows already being crawled", async () => {
    const indexer = makeIndexer(fakeSql(), fakeRpc(), "rpc");
    const init = makeInit({ pool: "NOT-DUE", config: "CFG" });
    indexer.chainSlot = 100;
    indexer.pending.set("NOT-DUE", pendingEntry(init, 50, { dueSlot: 101 })); // dueSlot > chainSlot
    await indexer.tick();
    expect(vi.mocked(crawlWindow)).not.toHaveBeenCalled();
    expect(indexer.pending.has("NOT-DUE")).toBe(true);
  });
});

// --- pollWatched() -------------------------------------------------------------------------

describe("pollWatched()", () => {
  it("never calls the RPC for an unwatched, unopened, or already-closed window", async () => {
    const getSigs = vi.fn(async () => []);
    const indexer = makeIndexer(fakeSql(), fakeRpc({ getSignaturesForAddress: getSigs }), "rpc");
    indexer.chainSlot = 100_000;
    indexer.pending.set("A", pendingEntry(makeInit({ pool: "A", config: "C" }), 10, { dueSlot: 0, watched: false }));
    indexer.pending.set("B", pendingEntry(makeInit({ pool: "B", config: "C" }), null, { dueSlot: 0, watched: true }));
    indexer.pending.set("C", pendingEntry(makeInit({ pool: "C", config: "C" }), 1, { dueSlot: 0, watched: true })); // window long closed

    await indexer.pollWatched();

    expect(getSigs).not.toHaveBeenCalled();
  });

  it("replays only the unknown, confirmed, in-window signature of a watched open pool", async () => {
    const init = fx("init");
    const ev = decodeTx(init).find((e) => e.kind === "init") as InitEvent;
    const txSig = init.transaction.signatures[0];
    const getTxCalls: string[] = [];

    const rpc = fakeRpc({
      getSignaturesForAddress: async () => [
        { signature: "errSig", slot: ev.slot, err: { InstructionError: [] }, blockTime: null },
        { signature: "knownSig", slot: ev.slot, err: null, blockTime: null },
        { signature: "outsideSig", slot: ev.slot + WINDOW_SLOTS, err: null, blockTime: null },
        { signature: txSig, slot: ev.slot, err: null, blockTime: ev.blockTime },
      ],
      getTransaction: async (sig) => { getTxCalls.push(sig); return sig === txSig ? init : null; },
    });
    const sql = fakeSql({ "select sig from window_buys": () => [{ sig: "knownSig" }] });
    const indexer = makeIndexer(sql, rpc, "rpc");
    indexer.chainSlot = ev.slot;
    indexer.pending.set(ev.pool, pendingEntry(ev, ev.slot, { dueSlot: 0, watched: true }));

    await indexer.pollWatched();

    expect(getTxCalls).toEqual([txSig]); // only the new, confirmed, in-window signature
    expect(sql.log.some((c: SqlCall) => c.text.includes("insert into window_buys ("))).toBe(true); // onTx -> onLiveSwap
    expect(sql.log.some((c: SqlCall) => c.text.includes("insert into pools ("))).toBe(false); // already pending: onInit short-circuits
  });

  it("tolerates a signature whose transaction cannot be fetched yet", async () => {
    const init = makeInit({ pool: "P", config: "C" });
    const rpc = fakeRpc({
      getSignaturesForAddress: async () => [{ signature: "sig1", slot: 100, err: null, blockTime: null }],
      getTransaction: async () => null,
    });
    const sql = fakeSql({ "select sig from window_buys": () => [] });
    const indexer = makeIndexer(sql, rpc, "rpc");
    indexer.chainSlot = 100;
    indexer.pending.set("P", pendingEntry(init, 100, { dueSlot: 0, watched: true }));

    await expect(indexer.pollWatched()).resolves.toBeUndefined();
    expect(sql.log.some((c: SqlCall) => c.text.includes("insert into window_buys ("))).toBe(false);
  });
});
