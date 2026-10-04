// The last uncovered branches of describe.ts and stats.ts, each pinned to the behavior it decides.
import { describe, expect, it } from "vitest";
import { configStats, describeConfig, rankConfigs, type WindowRow } from "../src/index.js";
import { configFixture } from "./helpers.js";

describe("describeConfig: sub-SOL amounts", () => {
  it("prints amounts below 1 SOL with up to 3 decimals, trailing zeros trimmed", () => {
    const lines = describeConfig({ ...configFixture("3yFxSqnZ"), poolCreationFee: 50_000_000n, migrationQuoteThreshold: 500_000_000n });
    expect(lines).toContain("Launching costs a 0.05 SOL pool creation fee.");
    expect(lines).toContain("Graduates at 0.5 SOL to DAMM v2.");
  });
  it("prints a whole-SOL amount without decimals", () => {
    expect(describeConfig({ ...configFixture("3yFxSqnZ"), migrationQuoteThreshold: 85_000_000_000n })).toContain("Graduates at 85 SOL to DAMM v2.");
  });
  it("graduation_threshold_below_0.001_SOL_prints_lamports_instead_of_0_SOL", () => {
    // Real mainnet config BeieowyJ… graduates at 10,000 lamports; it used to read "Graduates at 0 SOL".
    expect(describeConfig({ ...configFixture("3yFxSqnZ"), migrationQuoteThreshold: 10_000n })).toContain("Graduates at 10,000 lamports to DAMM v2.");
  });
  it("a zero amount still reads 0 SOL", () => {
    expect(describeConfig({ ...configFixture("3yFxSqnZ"), migrationQuoteThreshold: 0n })).toContain("Graduates at 0 SOL to DAMM v2.");
  });
  it("drops a dangling decimal point when two decimals round to a whole number", () => {
    expect(describeConfig({ ...configFixture("3yFxSqnZ"), migrationQuoteThreshold: 2_001_000_000n })).toContain("Graduates at 2 SOL to DAMM v2.");
  });
});

const row = (config: string, creator: string, snp10: number, perSlot?: number[]): WindowRow => ({
  pool: `${config}-${creator}-${snp10}`, config, creator, snp10, perSlot: perSlot ?? [snp10], createdAt: 0, graduatedAt: null,
});

describe("configStats: strip shape", () => {
  it("an empty config gets an empty median strip and no rate", () => {
    const s = configStats("EMPTY", [], 0);
    expect(s.medianStrip).toEqual([]);
    expect(s.launches).toBe(0);
    expect(s.topCreatorShare).toBe(0);
  });
  it("a window with fewer recorded slots counts the missing slots as zero", () => {
    const s = configStats("C", [row("C", "a", 0.2, [0.2, 0.1, 0]), row("C", "b", 0.3, [0.3])], 0);
    expect(s.medianStrip).toEqual([0.25, 0.05, 0]);
  });
});

describe("rankConfigs: equal medians", () => {
  it("breaks an exact median tie by launch count, more launches first", () => {
    const mk = (cfg: string, n: number) => configStats(cfg, Array.from({ length: n }, (_, i) => row(cfg, `c${i % 6}`, 0.1)), 0);
    const r = rankConfigs([mk("FEW", 20), mk("MANY", 30)]);
    expect(r.map((x) => x.config)).toEqual(["MANY", "FEW"]);
  });
});
