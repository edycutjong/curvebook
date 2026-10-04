import { describe, expect, it, vi } from "vitest";
import { aggregate, loadWindowRows } from "../src/agg.js";

/** Fake SQL: records all inserts and provides canned window rows for select. */
function fakeSql() {
  const inserts: unknown[] = [];

  const sqlFn = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?");
    // If it's a select (loadWindowRows), return canned window rows.
    if (query.includes("select w.pool")) {
      return [
        // Config A: 25 windows from 5 creators (eligible, ≥20 windows, ≥5 creators)
        ...Array.from({ length: 5 }, (_, i) =>
          Array.from({ length: 5 }, (_, j) => ({
            pool: `poolA${i}${j}`,
            config: "configA",
            creator: `creatorA${i}`,
            snp10: 100 + j,
            per_slot: [1, 2, 3],
            created_at: 1000000 + i * 1000 + j * 100,
            graduated_at: 1500000 + i * 1000 + j * 100,
          }))
        ).flat(),
        // Config B: 20 windows from 5 creators (eligible, exactly 20 windows, 5 creators)
        ...Array.from({ length: 5 }, (_, i) =>
          Array.from({ length: 4 }, (_, j) => ({
            pool: `poolB${i}${j}`,
            config: "configB",
            creator: `creatorB${i}`,
            snp10: 50 + j,
            per_slot: [2, 3, 4],
            created_at: 2000000 + i * 1000 + j * 100,
            graduated_at: 2500000 + i * 1000 + j * 100,
          }))
        ).flat(),
        // Config C: 10 windows from 2 creators (not eligible, <5 creators)
        ...Array.from({ length: 2 }, (_, i) =>
          Array.from({ length: 5 }, (_, j) => ({
            pool: `poolC${i}${j}`,
            config: "configC",
            creator: `creatorC${i}`,
            snp10: 75 + j,
            per_slot: [3, 4, 5],
            created_at: 3000000 + i * 1000 + j * 100,
            graduated_at: 3500000 + i * 1000 + j * 100,
          }))
        ).flat(),
      ];
    }
    return [];
  }) as any;

  const beginFn = vi.fn(async (fn: (tx: any) => Promise<void>) => {
    const txFn = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      // Record the insert
      inserts.push({ strings: strings.join("?"), values });
      return [];
    }) as any;
    txFn.begin = beginFn;
    await fn(txFn);
  });

  sqlFn.begin = beginFn;
  sqlFn.inserts = inserts;
  return sqlFn;
}

describe("loadWindowRows", () => {
  it("maps database rows to WindowRow objects with camelCase properties", async () => {
    const sql = fakeSql();
    const rows = await loadWindowRows(sql);

    expect(rows).toHaveLength(55); // 25 + 20 + 10

    const first = rows[0];
    expect(first).toHaveProperty("pool");
    expect(first).toHaveProperty("config");
    expect(first).toHaveProperty("creator");
    expect(first).toHaveProperty("snp10");
    expect(first).toHaveProperty("perSlot");
    expect(first).toHaveProperty("createdAt");
    expect(first).toHaveProperty("graduatedAt");
    expect(first.perSlot).toEqual([1, 2, 3]);
  });

  it("preserves numeric values correctly", async () => {
    const sql = fakeSql();
    const rows = await loadWindowRows(sql);

    const configARows = rows.filter((r) => r.config === "configA");
    expect(configARows).toHaveLength(25);
    expect(configARows[0].snp10).toBeGreaterThanOrEqual(100);
  });
});

describe("aggregate", () => {
  it("groups rows by config and returns correct counts", async () => {
    const sql = fakeSql();
    const result = await aggregate(sql, 4000000);

    expect(result.windows).toBe(55);
    expect(result.configs).toBe(3);
    // Ranked should be 2 (configA and configB are eligible; configC is not)
    expect(result.ranked).toBe(2);
  });

  it("inserts stats for all configs with correct rank values", async () => {
    const sql = fakeSql();
    await aggregate(sql, 4000000);

    expect(sql.inserts).toHaveLength(3); // One insert per config

    // Extract the values from inserts to find rank positions.
    // The insert query is:
    // INSERT INTO config_stats (...eligible, rank, tied, ...)
    // VALUES (...${s.eligible}, ${r?.rank ?? null}, ${r?.tied ?? false}, ...)
    // We need to find which insert corresponds to which config and check the rank value.

    const inserts = sql.inserts.map((insert: any) => ({ ...insert }));

    // Find inserts by matching config in values; they're positional:
    // [config, launches, creators, topCreatorShare, snp10P50, snp10P90, ci_lo, ci_hi,
    //  medianStrip, gradRate, gradAged, tGradP50, eligible, rank, tied, updated_at]
    const configIndex = 0;
    const eligibleIndex = 12;
    const rankIndex = 13;

    const configAInsert = inserts.find((i: any) => i.values[configIndex] === "configA");
    const configBInsert = inserts.find((i: any) => i.values[configIndex] === "configB");
    const configCInsert = inserts.find((i: any) => i.values[configIndex] === "configC");

    // Config A and B are eligible and should have non-null ranks
    expect(configAInsert).toBeDefined();
    expect(configBInsert).toBeDefined();
    expect(configCInsert).toBeDefined();

    expect(configAInsert.values[eligibleIndex]).toBe(true);
    expect(configBInsert.values[eligibleIndex]).toBe(true);
    expect(configCInsert.values[eligibleIndex]).toBe(false);

    // Config C should have rank = null because it's not eligible
    expect(configCInsert.values[rankIndex]).toBeNull();

    // Config A and B should have non-null ranks (actual rank numbers)
    expect(typeof configAInsert.values[rankIndex]).toBe("number");
    expect(typeof configBInsert.values[rankIndex]).toBe("number");
    expect(configAInsert.values[rankIndex]).toBeGreaterThanOrEqual(0);
    expect(configBInsert.values[rankIndex]).toBeGreaterThanOrEqual(0);
  });

  it("records tied flag for ranked configs", async () => {
    const sql = fakeSql();
    await aggregate(sql, 4000000);

    const inserts = sql.inserts.map((insert: any) => ({ ...insert }));
    const configIndex = 0;
    const tiedIndex = 14;

    const configAInsert = inserts.find((i: any) => i.values[configIndex] === "configA");
    const configBInsert = inserts.find((i: any) => i.values[configIndex] === "configB");
    const configCInsert = inserts.find((i: any) => i.values[configIndex] === "configC");

    // All should have a tied property (boolean for A/B, false for C by default)
    expect(typeof configAInsert.values[tiedIndex]).toBe("boolean");
    expect(typeof configBInsert.values[tiedIndex]).toBe("boolean");
    expect(configCInsert.values[tiedIndex]).toBe(false);
  });

  it("uses transaction (sql.begin) to execute inserts", async () => {
    const sql = fakeSql();
    const beginSpy = { called: false };

    const originalBegin = sql.begin;
    sql.begin = async (fn: (tx: any) => Promise<void>) => {
      beginSpy.called = true;
      return originalBegin.call(sql, fn);
    };

    await aggregate(sql, 4000000);
    expect(beginSpy.called).toBe(true);
  });

  it("handles configs with different window counts and creator distributions", async () => {
    const sql = fakeSql();
    const result = await aggregate(sql, 4000000);

    // ConfigA: 25 windows from 5 creators → eligible
    // ConfigB: 20 windows from 5 creators → eligible
    // ConfigC: 10 windows from 2 creators → not eligible

    expect(result.windows).toBe(55);
    expect(result.configs).toBe(3);
    expect(result.ranked).toBe(2);
  });

  it("returns null rank via r?.rank ?? null ternary for ineligible configs", async () => {
    const sql = fakeSql();
    await aggregate(sql, 4000000);

    const inserts = sql.inserts.map((insert: any) => ({ ...insert }));
    const configIndex = 0;
    const rankIndex = 13;

    // Find configC insert (ineligible)
    const configCInsert = inserts.find((i: any) => i.values[configIndex] === "configC");
    expect(configCInsert.values[rankIndex]).toBeNull();
  });

  it("preserves config and launches in each insert", async () => {
    const sql = fakeSql();
    await aggregate(sql, 4000000);

    const inserts = sql.inserts.map((insert: any) => ({ ...insert }));
    expect(inserts.length).toBeGreaterThan(0);

    // Each insert should have a config (index 0) and launches (index 1)
    inserts.forEach((insert: any) => {
      expect(typeof insert.values[0]).toBe("string"); // config
      expect(typeof insert.values[1]).toBe("number"); // launches
    });
  });
});
