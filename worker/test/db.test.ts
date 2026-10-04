import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PoolWindow, WindowBuy } from "@curvebook/core";
import { decodePoolConfig } from "@curvebook/core";
import { connect, migrate, upsertConfig, writeWindow } from "../src/db.js";

// Helper to load config fixture
function configFixture(prefix: string) {
  const f = JSON.parse(
    readFileSync(new URL(`../../core/test/fixtures/config-${prefix}.json`, import.meta.url), "utf8")
  );
  return decodePoolConfig(f.address, Buffer.from(f.data, "base64"));
}

// Mock postgres module
vi.mock("postgres");

const postgresModule = await import("postgres");
const postgres = postgresModule.default as any;

describe("db.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("connect", () => {
    it("sets ssl=false for localhost URLs", () => {
      connect("postgres://localhost/db");
      expect(postgres).toHaveBeenCalledWith("postgres://localhost/db", expect.objectContaining({ ssl: false }));
    });

    it("sets ssl=false for 127.0.0.1 URLs", () => {
      connect("postgres://127.0.0.1/db");
      expect(postgres).toHaveBeenCalledWith("postgres://127.0.0.1/db", expect.objectContaining({ ssl: false }));
    });

    it("sets ssl=false for @db: URLs", () => {
      connect("postgres://user@db:5432/db");
      expect(postgres).toHaveBeenCalledWith("postgres://user@db:5432/db", expect.objectContaining({ ssl: false }));
    });

    it("sets ssl=require for remote URLs", () => {
      connect("postgres://prod.supabase.co/db");
      expect(postgres).toHaveBeenCalledWith("postgres://prod.supabase.co/db", expect.objectContaining({ ssl: "require" }));
    });

    it("passes max=5 and custom types", () => {
      connect("postgres://localhost/db");
      expect(postgres).toHaveBeenCalledWith("postgres://localhost/db", expect.objectContaining({ max: 5 }));
      expect(postgres).toHaveBeenCalledWith(
        "postgres://localhost/db",
        expect.objectContaining({ types: expect.objectContaining({ bigint: postgres.BigInt }) })
      );
    });

    it("has an onnotice handler that is callable", () => {
      connect("postgres://localhost/db");
      const call = postgres.mock.calls[0];
      expect(call[1].onnotice).toBeDefined();
      expect(typeof call[1].onnotice).toBe("function");
      // Call the onnotice handler to verify it works (it should do nothing)
      call[1].onnotice();
      expect(true).toBe(true); // Handler executed without error
    });
  });

  describe("migrate", () => {
    it("reads schema.sql and calls sql.unsafe with the schema text", async () => {
      const mockSql = { unsafe: vi.fn() };
      await migrate(mockSql as any);

      expect(mockSql.unsafe).toHaveBeenCalledTimes(1);
      const schemaText = mockSql.unsafe.mock.calls[0][0];
      expect(typeof schemaText).toBe("string");
      expect(schemaText).toContain("create table if not exists");
    });

    it("schema text contains pools table definition", async () => {
      const mockSql = { unsafe: vi.fn() };
      await migrate(mockSql as any);

      const schemaText = mockSql.unsafe.mock.calls[0][0];
      expect(schemaText).toContain("create table if not exists pools");
    });

    it("schema text contains configs table definition", async () => {
      const mockSql = { unsafe: vi.fn() };
      await migrate(mockSql as any);

      const schemaText = mockSql.unsafe.mock.calls[0][0];
      expect(schemaText).toContain("create table if not exists configs");
    });
  });

  describe("upsertConfig", () => {
    it("inserts a ConfigInfo with correct fields using sql.json", async () => {
      const config = configFixture("3yFxSqnZ");
      const jsonCalls: any[] = [];
      const mockSql = vi.fn() as any;
      mockSql.json = vi.fn((obj: any) => {
        jsonCalls.push(obj);
        return obj;
      });
      const describe = ["desc1", "desc2"];
      const raw = Buffer.from("rawdata");
      const slot = 123456;

      await upsertConfig(mockSql, config, describe, raw, slot);

      expect(mockSql).toHaveBeenCalledTimes(1);

      // Verify sql.json was called for baseFee
      expect(jsonCalls).toHaveLength(1);
      expect(jsonCalls[0]).toMatchObject({
        mode: expect.any(Number),
        cliff: expect.any(String),
        first: expect.any(Number),
        second: expect.any(String),
        third: expect.any(String),
      });
    });

    it("uses on conflict to update describe and fetched_at", async () => {
      const config = configFixture("3yFxSqnZ");
      const mockSql = vi.fn() as any;
      mockSql.json = vi.fn((obj: any) => obj);
      const describe = ["desc1"];
      const raw = Buffer.from("data");

      await upsertConfig(mockSql, config, describe, raw, 100);

      const [queryStrings, ...args] = mockSql.mock.calls[0];
      // Verify that the query template contains "on conflict"
      const queryText = queryStrings.join("");
      expect(queryText).toContain("on conflict");
      expect(queryText).toContain("do update");
    });
  });

  describe("writeWindow", () => {
    it("deletes previous window_buys for the pool and inserts new ones in transaction", async () => {
      const calls: string[] = [];

      const mockTx = vi.fn(function (this: any, query: TemplateStringsArray, ...args: any[]) {
        // Record what kind of query this is
        if (typeof query === "object" && query[0]) {
          if (query[0].includes("delete")) calls.push("delete");
          if (query[0].includes("insert into window_buys")) calls.push("window_buys");
          if (query[0].includes("insert into pool_windows")) calls.push("pool_windows");
        }
        return Promise.resolve();
      });

      const mockSql = {
        begin: vi.fn(async (fn: (tx: any) => Promise<void>) => {
          await fn(mockTx);
        }),
      };

      const windowBuy1: WindowBuy = {
        sig: "sig1",
        slot: 100,
        offset: 0,
        payer: "payer1",
        isCreator: false,
        quoteIn: 1000n,
        fee: 10n,
        baseOut: 100n,
        viaCpi: false,
      };

      const windowBuy2: WindowBuy = {
        sig: "sig2",
        slot: 101,
        offset: 1,
        payer: "payer2",
        isCreator: false,
        quoteIn: 2000n,
        fee: 20n,
        baseOut: 200n,
        viaCpi: false,
      };

      const window: PoolWindow = {
        pool: "pool-addr",
        config: "config-addr",
        creator: "creator-addr",
        openSlot: 100,
        buys: [windowBuy1, windowBuy2],
        snp10: 0.5,
        perSlot: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
        ncWallets: 5,
        top3Share: 0.3,
        creatorBase: 1000n,
        ncBase: 2000n,
        ncFees: 100n,
      };

      await writeWindow(mockSql as any, window, true, "test-source");

      expect(mockSql.begin).toHaveBeenCalledTimes(1);
      // Should have 1 delete + 2 window_buys inserts + 1 pool_windows insert = 4 calls
      expect(calls).toEqual(["delete", "window_buys", "window_buys", "pool_windows"]);
    });

    it("handles buys with duplicate sigs and increments idx", async () => {
      const idxValues: number[] = [];

      const mockTx = vi.fn(function (this: any, query: TemplateStringsArray, ...args: any[]) {
        // Extract idx value from window_buys inserts
        if (typeof query === "object" && query[0] && query[0].includes("insert into window_buys")) {
          // The idx is in args[2] based on the query: (sig, pool, idx, ...)
          idxValues.push(args[2]);
        }
        return Promise.resolve();
      });

      const mockSql = {
        begin: vi.fn(async (fn: (tx: any) => Promise<void>) => {
          await fn(mockTx);
        }),
      };

      const windowBuy1: WindowBuy = {
        sig: "duplicate-sig",
        slot: 100,
        offset: 0,
        payer: "payer1",
        isCreator: false,
        quoteIn: 1000n,
        fee: 10n,
        baseOut: 100n,
        viaCpi: false,
      };

      const windowBuy2: WindowBuy = {
        sig: "duplicate-sig",
        slot: 101,
        offset: 1,
        payer: "payer2",
        isCreator: false,
        quoteIn: 2000n,
        fee: 20n,
        baseOut: 200n,
        viaCpi: false,
      };

      const window: PoolWindow = {
        pool: "pool-addr",
        config: "config-addr",
        creator: "creator-addr",
        openSlot: 100,
        buys: [windowBuy1, windowBuy2],
        snp10: 0.5,
        perSlot: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
        ncWallets: 2,
        top3Share: 1.0,
        creatorBase: 1000n,
        ncBase: 2000n,
        ncFees: 100n,
      };

      await writeWindow(mockSql as any, window, true, "test-source");

      // First buy should have idx=0, second with same sig should have idx=1
      expect(idxValues).toEqual([0, 1]);
    });

    it("inserts pool_window with upsert on conflict", async () => {
      let poolWindowInserted = false;

      const mockTx = vi.fn(function (this: any, query: TemplateStringsArray) {
        if (typeof query === "object" && query[0] && query[0].includes("insert into pool_windows")) {
          poolWindowInserted = true;
        }
        return Promise.resolve();
      });

      const mockSql = {
        begin: vi.fn(async (fn: (tx: any) => Promise<void>) => {
          await fn(mockTx);
        }),
      };

      const window: PoolWindow = {
        pool: "pool-addr",
        config: "config-addr",
        creator: "creator-addr",
        openSlot: 100,
        buys: [],
        snp10: 0.5,
        perSlot: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
        ncWallets: 5,
        top3Share: 0.3,
        creatorBase: 1000n,
        ncBase: 2000n,
        ncFees: 100n,
      };

      await writeWindow(mockSql as any, window, false, "test-source");

      expect(poolWindowInserted).toBe(true);
    });

    it("wraps all operations in sql.begin transaction", async () => {
      const mockTx = vi.fn(function (this: any, query: TemplateStringsArray) {
        return Promise.resolve();
      });

      const mockSql = {
        begin: vi.fn(async (fn: (tx: any) => Promise<void>) => {
          await fn(mockTx);
        }),
      };

      const window: PoolWindow = {
        pool: "pool-addr",
        config: "config-addr",
        creator: "creator-addr",
        openSlot: 100,
        buys: [],
        snp10: 0.5,
        perSlot: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
        ncWallets: 0,
        top3Share: 0,
        creatorBase: 0n,
        ncBase: 0n,
        ncFees: 0n,
      };

      await writeWindow(mockSql as any, window, true, "test-source");

      expect(mockSql.begin).toHaveBeenCalledTimes(1);
      expect(typeof mockSql.begin.mock.calls[0][0]).toBe("function");
    });

    it("converts bigint values to strings via s() helper", async () => {
      const capturedParams: any[] = [];

      const mockTx = vi.fn(function (this: any, query: TemplateStringsArray, ...args: any[]) {
        capturedParams.push(...args);
        return Promise.resolve();
      });

      const mockSql = {
        begin: vi.fn(async (fn: (tx: any) => Promise<void>) => {
          await fn(mockTx);
        }),
      };

      const window: PoolWindow = {
        pool: "pool-addr",
        config: "config-addr",
        creator: "creator-addr",
        openSlot: 100,
        buys: [
          {
            sig: "sig1",
            slot: 100,
            offset: 0,
            payer: "payer1",
            isCreator: false,
            quoteIn: 12345n,
            fee: 100n,
            baseOut: 1000n,
            viaCpi: false,
          },
        ],
        snp10: 0.5,
        perSlot: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
        ncWallets: 1,
        top3Share: 1.0,
        creatorBase: 5000n,
        ncBase: 10000n,
        ncFees: 500n,
      };

      await writeWindow(mockSql as any, window, true, "test-source");

      // Check that bigint values are stringified in params
      const paramStrings = capturedParams
        .filter((p) => typeof p === "string" && /^\d+$/.test(p))
        .map((p) => parseInt(p, 10));
      expect(paramStrings.length).toBeGreaterThan(0);
    });
  });
});

describe("acquireIndexLock — one writer per index", () => {
  it("holds a dedicated connection when the lock is free", async () => {
    const release = vi.fn();
    const conn: any = Object.assign(async () => [{ locked: true }], { release });
    const sqlFake: any = { reserve: async () => conn };
    const { acquireIndexLock } = await import("../src/db.js");
    expect(await acquireIndexLock(sqlFake)).toBe(true);
    expect(release).not.toHaveBeenCalled();
  });
  it("second_worker_on_the_same_database_refuses_and_returns_its_connection", async () => {
    const release = vi.fn();
    const conn: any = Object.assign(async () => [{ locked: false }], { release });
    const { acquireIndexLock } = await import("../src/db.js");
    expect(await acquireIndexLock({ reserve: async () => conn } as any)).toBe(false);
    expect(release).toHaveBeenCalledOnce();
  });
  it("treats an empty lock reply as not acquired", async () => {
    const conn: any = Object.assign(async () => [], { release: vi.fn() });
    const { acquireIndexLock } = await import("../src/db.js");
    expect(await acquireIndexLock({ reserve: async () => conn } as any)).toBe(false);
  });
});
