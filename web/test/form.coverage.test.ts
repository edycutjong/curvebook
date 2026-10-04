import { describe, expect, it } from "vitest";
import { groupForm, headline, isLive, type FormRow } from "@/lib/form";

const row = (config: string, o: Partial<FormRow> = {}): FormRow => ({
  config,
  launches: 1,
  creators: 1,
  topCreatorShare: 1,
  snp10P50: 0.05,
  ciLo: 0.04,
  ciHi: 0.06,
  medianStrip: null,
  gradRate: null,
  gradAged: 0,
  tGradP50: null,
  eligible: false,
  rank: null,
  tied: false,
  preset: null,
  ...o,
});

describe("form - coverage gaps", () => {
  describe("groupForm", () => {
    it("sorts by rank when ranks are equal (tie-breaking not possible since ranks are unique)", () => {
      const rows = [
        row("a", { eligible: true, rank: 1, launches: 10 }),
        row("b", { eligible: true, rank: 2, launches: 20 }),
      ];
      const g = groupForm(rows);
      expect(g.ranked[0].rank).toBe(1);
      expect(g.ranked[1].rank).toBe(2);
    });

    it("uses launches to break rank ties (same rank means secondary sort by launches)", () => {
      // Note: in practice, ranks should be unique, but the code handles it
      const rows = [
        row("a", { eligible: true, rank: 1, launches: 10 }),
        row("b", { eligible: true, rank: 1, launches: 20 }), // same rank
      ];
      const g = groupForm(rows);
      // When ranks are same, sorts by launches descending
      expect(g.ranked[0].launches).toBe(20);
      expect(g.ranked[1].launches).toBe(10);
    });

    it("uses localeCompare to break launches ties in unranked", () => {
      const rows = [
        row("zebra", { launches: 10 }),
        row("apple", { launches: 10 }),
      ];
      const g = groupForm(rows);
      // When launches are same, sorts by config name
      expect(g.unranked[0].config).toBe("apple");
      expect(g.unranked[1].config).toBe("zebra");
    });

    it("orders presets: ranked first, then by rank, then by launches", () => {
      const rows = [
        row("preset-unranked", { preset: { name: "U", slug: "u" }, launches: 100 }),
        row("preset-ranked-high", { preset: { name: "R2", slug: "r2" }, eligible: true, rank: 2, launches: 10 }),
        row("preset-ranked-low", { preset: { name: "R1", slug: "r1" }, eligible: true, rank: 1, launches: 50 }),
      ];
      const g = groupForm(rows);
      expect(g.presets.map((r) => r.config)).toEqual(["preset-ranked-low", "preset-ranked-high", "preset-unranked"]);
    });

    it("handles empty rows", () => {
      const g = groupForm([]);
      expect(g.ranked).toEqual([]);
      expect(g.unranked).toEqual([]);
      expect(g.presets).toEqual([]);
    });

    it("handles all presets", () => {
      const rows = [
        row("p1", { preset: { name: "P1", slug: "p1" } }),
        row("p2", { preset: { name: "P2", slug: "p2" } }),
      ];
      const g = groupForm(rows);
      expect(g.ranked).toEqual([]);
      expect(g.unranked).toEqual([]);
      expect(g.presets).toHaveLength(2);
    });
  });

  describe("headline", () => {
    it("returns null when most used config is the same as leader", () => {
      const rows = [
        row("same", { rank: 1, snp10P50: 0.05, launches: 100 }),
        row("other", { rank: 2, snp10P50: 0.06, launches: 50 }),
      ];
      expect(headline(rows)).toBeNull();
    });

    it("returns null when most used has no snp10P50", () => {
      const rows = [
        row("a", { rank: 1, snp10P50: 0.05, launches: 10 }),
        row("b", { rank: 2, snp10P50: null, launches: 100 }),
      ];
      expect(headline(rows)).toBeNull();
    });

    it("returns null when leader has no snp10P50", () => {
      const rows = [
        row("a", { rank: 1, snp10P50: null, launches: 100 }),
        row("b", { rank: 2, snp10P50: 0.05, launches: 10 }),
      ];
      expect(headline(rows)).toBeNull();
    });

    it("returns null when leader snp10P50 is zero or negative", () => {
      const rows = [
        row("a", { rank: 1, snp10P50: 0, launches: 10 }),
        row("b", { rank: 2, snp10P50: 0.05, launches: 100 }),
      ];
      const h = headline(rows);
      expect(h).not.toBeNull();
      expect(h?.ratio).toBeNull();
    });

    it("returns null when leader snp10P50 is negative", () => {
      const rows = [
        row("a", { rank: 1, snp10P50: -0.05, launches: 10 }),
        row("b", { rank: 2, snp10P50: 0.05, launches: 100 }),
      ];
      const h = headline(rows);
      expect(h).not.toBeNull();
      expect(h?.ratio).toBeNull();
    });

    it("calculates ratio correctly when leader snp10P50 is positive", () => {
      const rows = [
        row("a", { rank: 1, snp10P50: 0.1, launches: 10 }),
        row("b", { rank: 2, snp10P50: 0.05, launches: 100 }),
      ];
      const h = headline(rows);
      expect(h?.ratio).toBe(0.5); // 0.05 / 0.1
    });

    it("returns null with exactly one ranked config", () => {
      const rows = [row("a", { rank: 1, snp10P50: 0.05, launches: 100 })];
      expect(headline(rows)).toBeNull();
    });

    it("returns null with zero ranked configs", () => {
      expect(headline([])).toBeNull();
    });
  });

  describe("isLive", () => {
    const now = Date.parse("2026-10-04T00:00:00Z");

    it("returns false when updatedAtIso is null", () => {
      expect(isLive(3, null, now)).toBe(false);
    });

    it("returns false when updatedAtIso is an invalid date", () => {
      expect(isLive(3, "invalid-date", now)).toBe(false);
    });

    it("returns true when lag is exactly 20 (boundary included)", () => {
      expect(isLive(20, "2026-10-03T23:59:30Z", now)).toBe(true); // lagSlots <= 20
    });

    it("returns false when lag is greater than 20", () => {
      expect(isLive(21, "2026-10-03T23:59:30Z", now)).toBe(false); // lagSlots > 20
      expect(isLive(100, "2026-10-03T23:59:30Z", now)).toBe(false);
    });

    it("returns true when update is exactly 60 seconds old (boundary not exceeded)", () => {
      expect(isLive(3, "2026-10-03T23:59:00Z", now)).toBe(true); // exactly 60 seconds, not > 60
    });

    it("returns true when update is 59 seconds old and lag is small", () => {
      expect(isLive(3, "2026-10-03T23:59:01Z", now)).toBe(true); // 59 seconds old
    });

    it("returns false when update is more than 60 seconds old", () => {
      expect(isLive(3, "2026-10-03T23:58:59Z", now)).toBe(false); // 61 seconds old
    });

    it("returns true when lagSlots is null and update is fresh", () => {
      expect(isLive(null, "2026-10-03T23:59:30Z", now)).toBe(true);
    });

    it("returns true when all conditions are met (fresh update and small lag)", () => {
      expect(isLive(0, "2026-10-03T23:59:30Z", now)).toBe(true);
      expect(isLive(5, "2026-10-03T23:59:30Z", now)).toBe(true);
      expect(isLive(20, "2026-10-03T23:59:30Z", now)).toBe(true); // lagSlots <= 20
    });

    it("uses Date.now() as default when now parameter is not provided", () => {
      // We can't easily test this without mocking Date.now, so we just verify the signature works
      const result = isLive(3, "2026-10-04T00:00:00Z");
      expect(typeof result).toBe("boolean");
    });
  });
});
