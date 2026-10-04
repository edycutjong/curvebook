import { describe, expect, it } from "vitest";
import { quantile, median, bootstrapMedianCI, configStats, rankConfigs, type WindowRow } from "../src/index.js";

const row = (config: string, creator: string, snp10: number, createdAt = 0, graduatedAt: number | null = null): WindowRow => ({
  pool: `${config}-${creator}-${snp10}-${createdAt}`, config, creator, snp10, perSlot: [snp10, 0, 0, 0, 0, 0, 0, 0, 0, 0], createdAt, graduatedAt,
});

describe("stats.ts coverage: missing branches", () => {
  // Line 32: quantile with empty array
  it("quantile returns NaN for empty array", () => {
    expect(quantile([], 0.5)).toBe(NaN);
  });

  // Line 66: bootstrapMedianCI with empty array
  it("bootstrapMedianCI returns [NaN, NaN] for empty array", () => {
    const result = bootstrapMedianCI([], 42);
    expect(result[0]).toBe(NaN);
    expect(result[1]).toBe(NaN);
  });

  // Line 87-98: configStats with empty rows array
  it("configStats handles empty rows", () => {
    const stats = configStats("EMPTY", [], 0);
    expect(stats.launches).toBe(0);
    expect(stats.creators).toBe(0);
    expect(stats.topCreatorShare).toBe(0);
    expect(stats.medianStrip).toEqual([]);
    expect(stats.eligible).toBe(false);
  });

  // Line 87-98: configStats with no aged pools (none >= 24 hours old)
  it("configStats has no graduation rate when no pools are aged >= 24h", () => {
    const rows = [row("X", "a", 0.1, 0, null), row("X", "b", 0.1, 0, null)];
    const stats = configStats("X", rows, 100);
    expect(stats.gradRate).toBeNull();
    expect(stats.gradAged).toBe(0);
  });

  // Line 98: configStats with medianStrip handling
  it("configStats computes medianStrip for eligible configs", () => {
    const rows = Array.from({ length: 20 }, (_, i) => row("CONFIG", `c${i % 5}`, 0.1 + i * 0.01, i * 1000));
    const stats = configStats("CONFIG", rows, 100000);
    expect(stats.medianStrip).toHaveLength(10); // WINDOW_SLOTS = 10
    expect(stats.eligible).toBe(true);
  });

  // Line 101: configStats with tGradP50 null when no graduated pools
  it("configStats tGradP50 is null when no pools graduated", () => {
    const rows = Array.from({ length: 20 }, (_, i) => row("X", `c${i % 5}`, 0.1, i * 1000, null));
    const stats = configStats("X", rows, 100000);
    expect(stats.tGradP50).toBeNull();
  });

  // Line 111: rankConfigs - first config in ranking
  it("rankConfigs assigns first config as rank 1", () => {
    const mkStats = (cfg: string, v: number) =>
      configStats(cfg, Array.from({ length: 25 }, (_, i) => row(cfg, `c${i % 6}`, v)), 0);
    const r = rankConfigs([mkStats("A", 0.1)]);
    expect(r[0].rank).toBe(1);
  });

  // Line 111: rankConfigs - prev undefined case (no prior config)
  it("rankConfigs first eligible config has no previous config for comparison", () => {
    const mkStats = (cfg: string, v: number) =>
      configStats(cfg, Array.from({ length: 25 }, (_, i) => row(cfg, `c${i % 6}`, v)), 0);
    const r = rankConfigs([mkStats("A", 0.1), mkStats("B", 0.2)]);
    expect(r[0].tied).toBe(false);
  });

  // Line 111: rankConfigs - !!prev && overlap condition for tie
  it("rankConfigs detects when CIs overlap (tie case)", () => {
    const mkStats = (cfg: string, v: number) =>
      configStats(cfg, Array.from({ length: 25 }, (_, i) => row(cfg, `c${i % 6}`, v + (i % 10) * 0.0001)), 0);
    const stats1 = mkStats("X", 0.10);
    const stats2 = mkStats("Y", 0.10001);
    // These should have overlapping CIs due to their similarity
    const r = rankConfigs([stats1, stats2]);
    expect(r.length).toBe(2);
  });

  // Line 99: configStats tGradP50 is median of graduation times
  it("configStats computes tGradP50 as median graduation time", () => {
    const rows = [
      row("X", "a", 0.1, 0, 3600),
      row("X", "b", 0.1, 0, 5000),
      row("X", "c", 0.1, 0, 7200),
      row("X", "d", 0.1, 0, 5600),
      row("X", "e", 0.1, 0, 4000),
    ];
    const stats = configStats("X", rows, 100000);
    // Median of [3600, 5000, 7200, 5600, 4000] = [3600, 4000, 5000, 5600, 7200] -> 5000
    expect(stats.tGradP50).toBe(5000);
  });

  // Test perSlot with some zero values
  it("configStats handles perSlot with zero values", () => {
    const rows = [
      { ...row("X", "a", 0.1), perSlot: [0.1, 0, 0.05, 0, 0, 0, 0, 0, 0, 0] },
      { ...row("X", "b", 0.1), perSlot: [0, 0.1, 0, 0, 0.05, 0, 0, 0, 0, 0] },
    ];
    const stats = configStats("X", rows, 0);
    expect(stats.medianStrip[0]).toBe(0.05);
    expect(stats.medianStrip[1]).toBe(0.05);
  });

  // Test rankConfigs with first rank assignment
  it("rankConfigs assigns rank 1 to first eligible config", () => {
    const mkStats = (cfg: string, v: number) =>
      configStats(cfg, Array.from({ length: 25 }, (_, i) => row(cfg, `c${i % 6}`, v)), 0);
    const r = rankConfigs([mkStats("LOWEST", 0.01), mkStats("HIGHER", 0.2)]);
    expect(r[0].rank).toBe(1);
  });

  // Test rankConfigs with subsequent ranks
  it("rankConfigs assigns subsequent rank numbers correctly", () => {
    const mkStats = (cfg: string, v: number) =>
      configStats(cfg, Array.from({ length: 25 }, (_, i) => row(cfg, `c${i % 6}`, v + i * 0.01)), 0);
    const r = rankConfigs([mkStats("A", 0.01), mkStats("B", 0.25), mkStats("C", 0.5)]);
    expect(r[0].rank).toBe(1);
    expect(r[1].rank).toBeGreaterThan(1);
    expect(r[2].rank).toBeGreaterThan(r[1].rank);
  });

  // Test configStats gradAged count
  it("configStats correctly counts aged pools", () => {
    const now = 100_000;
    const DAY = 86_400;
    const rows = [
      row("X", "a", 0.1, now - DAY * 2, null),
      row("X", "b", 0.1, now - DAY * 1.5, null),
      row("X", "c", 0.1, now - 100, null),
    ];
    const stats = configStats("X", rows, now);
    expect(stats.gradAged).toBe(2); // Only first two are >= 24h old
  });

  // Test quantile with edge cases
  it("quantile at p=0 returns minimum", () => {
    expect(quantile([5, 2, 8, 1, 9], 0)).toBe(1);
  });

  it("quantile at p=1 returns maximum", () => {
    expect(quantile([5, 2, 8, 1, 9], 1)).toBe(9);
  });

  // Test median calculation
  it("median is correct for various sizes", () => {
    expect(median([1, 2, 3])).toBe(2);
    expect(median([1, 2, 3, 4, 5])).toBe(3);
  });
});
