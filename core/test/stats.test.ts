import { describe, expect, it } from "vitest";
import { quantile, median, bootstrapMedianCI, configStats, rankConfigs, rng, seedFrom, type WindowRow } from "../src/index.js";

const row = (config: string, creator: string, snp10: number, createdAt = 0, graduatedAt: number | null = null): WindowRow => ({
  pool: `${config}-${creator}-${snp10}-${createdAt}`, config, creator, snp10, perSlot: [snp10, 0, 0, 0, 0, 0, 0, 0, 0, 0], createdAt, graduatedAt,
});

describe("quantiles", () => {
  it("median of even and odd sets", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
  it("p90 interpolates", () => {
    expect(quantile([0, 10], 0.9)).toBe(9);
  });
});

describe("bootstrap CI", () => {
  it("is reproducible for a seed and contains the median", () => {
    const xs = Array.from({ length: 50 }, (_, i) => i / 50);
    const a = bootstrapMedianCI(xs, 42);
    expect(bootstrapMedianCI(xs, 42)).toEqual(a);
    expect(a[0]).toBeLessThanOrEqual(median(xs));
    expect(a[1]).toBeGreaterThanOrEqual(median(xs));
  });
  it("rng is deterministic and in [0,1)", () => {
    const r1 = rng(seedFrom("x"));
    const r2 = rng(seedFrom("x"));
    for (let i = 0; i < 100; i++) {
      const v = r1();
      expect(v).toBe(r2());
      expect(v >= 0 && v < 1).toBe(true);
    }
  });
});

describe("configStats + eligibility (D9)", () => {
  it("needs ≥20 windows from ≥5 creators", () => {
    const farmed = Array.from({ length: 30 }, (_, i) => row("F", `c${i % 4}`, 0));
    expect(configStats("F", farmed, 0).eligible).toBe(false);
    const fair = Array.from({ length: 20 }, (_, i) => row("G", `c${i % 5}`, 0.1));
    expect(configStats("G", fair, 0).eligible).toBe(true);
  });
  it("reports the top creator's share of launches", () => {
    const rows = [row("X", "a", 0), row("X", "a", 0), row("X", "a", 0), row("X", "b", 0)];
    expect(configStats("X", rows, 0).topCreatorShare).toBe(0.75);
  });
  it("graduation rate counts only pools aged ≥ 24 h", () => {
    const now = 200_000;
    const rows = [row("X", "a", 0, 0, 3600), row("X", "b", 0, 0, null), row("X", "c", 0, now - 60, null)];
    const s = configStats("X", rows, now);
    expect(s.gradAged).toBe(2);
    expect(s.gradRate).toBe(0.5);
    expect(s.tGradP50).toBe(3600);
  });
});

describe("rankConfigs", () => {
  const mk = (cfg: string, v: number, n = 25) => configStats(cfg, Array.from({ length: n }, (_, i) => row(cfg, `c${i % 6}`, v + (i % 5) * 0.001)), 0);
  it("ranks by SNP10 median ascending and drops ineligible configs", () => {
    const r = rankConfigs([mk("HIGH", 0.3), mk("LOW", 0.02), mk("SMALL", 0, 5)]);
    expect(r.map((x) => x.config)).toEqual(["LOW", "HIGH"]);
    expect(r[0].rank).toBe(1);
    expect(r[1].rank).toBe(2);
  });
  it("declares a tie when CIs overlap", () => {
    const r = rankConfigs([mk("A", 0.1), mk("B", 0.1001)]);
    expect(r[1].tied).toBe(true);
    expect(r[1].rank).toBe(r[0].rank);
  });
});
