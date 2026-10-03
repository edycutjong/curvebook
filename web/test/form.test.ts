import { describe, expect, it } from "vitest";
import { groupForm, headline, isLive, type FormRow } from "@/lib/form";

const row = (config: string, o: Partial<FormRow> = {}): FormRow => ({
  config, launches: 1, creators: 1, topCreatorShare: 1, snp10P50: 0.05, ciLo: 0.04, ciHi: 0.06, medianStrip: null,
  gradRate: null, gradAged: 0, tGradP50: null, eligible: false, rank: null, tied: false, preset: null, ...o,
});

describe("groupForm", () => {
  const rows = [
    row("thin-big", { launches: 19 }),
    row("r2", { eligible: true, rank: 2, launches: 300 }),
    row("r1", { eligible: true, rank: 1, launches: 40 }),
    row("preset-new", { launches: 0, snp10P50: null, preset: { name: "Slow Cliff", slug: "slow-cliff" } }),
    row("preset-ranked", { eligible: true, rank: 3, launches: 25, preset: { name: "Fast", slug: "fast" } }),
    row("thin-small", { launches: 2 }),
  ];
  const g = groupForm(rows);

  it("orders ranked configs by rank and keeps ranked presets in the table", () => {
    expect(g.ranked.map((r) => r.config)).toEqual(["r1", "r2", "preset-ranked"]);
  });

  it("puts non-eligible configs below, most launches first, without presets", () => {
    expect(g.unranked.map((r) => r.config)).toEqual(["thin-big", "thin-small"]);
  });

  it("lists every preset in its own block, ranked first", () => {
    expect(g.presets.map((r) => r.config)).toEqual(["preset-ranked", "preset-new"]);
  });

  it("never ranks an eligible row that has no rank", () => {
    expect(groupForm([row("x", { eligible: true, rank: null })]).ranked).toEqual([]);
  });
});

describe("headline", () => {
  it("compares the busiest ranked config with rank 1", () => {
    const h = headline([row("a", { rank: 1, snp10P50: 0.02, launches: 30 }), row("b", { rank: 2, snp10P50: 0.08, launches: 900 })]);
    expect(h?.mostUsed.config).toBe("b");
    expect(h?.leader.config).toBe("a");
    expect(h?.ratio).toBeCloseTo(4);
  });

  it("stays silent when rank 1 is also the busiest, or with one config", () => {
    expect(headline([row("a", { rank: 1, launches: 99 }), row("b", { rank: 2, launches: 3 })])).toBeNull();
    expect(headline([row("a", { rank: 1 })])).toBeNull();
  });
});

describe("isLive", () => {
  const now = Date.parse("2026-10-04T00:00:00Z");
  it("is live only with a fresh update and small lag", () => {
    expect(isLive(3, "2026-10-03T23:59:30Z", now)).toBe(true);
    expect(isLive(-12, "2026-10-03T23:59:30Z", now)).toBe(true);
    expect(isLive(25, "2026-10-03T23:59:30Z", now)).toBe(false);
    expect(isLive(3, "2026-10-03T23:58:00Z", now)).toBe(false);
    expect(isLive(null, null, now)).toBe(false);
  });
});
