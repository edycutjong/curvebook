import { describe, expect, it } from "vitest";
import { cellFill, cellLabel, cellState, normalizeStrip, perSlotFromBuys, FULL_CELL_SHARE } from "@/lib/strip";

describe("strip - coverage gaps", () => {
  describe("cellFill", () => {
    it("returns 0 for negative shares", () => {
      expect(cellFill(-0.05)).toBe(0);
      expect(cellFill(-1)).toBe(0);
    });

    it("returns exactly 1 for shares >= FULL_CELL_SHARE", () => {
      expect(cellFill(FULL_CELL_SHARE)).toBe(1);
      expect(cellFill(FULL_CELL_SHARE * 2)).toBe(1);
    });

    it("scales linearly between MIN_VISIBLE_FILL and 1", () => {
      const midpoint = FULL_CELL_SHARE / 2;
      expect(cellFill(midpoint)).toBeCloseTo(0.5);
    });
  });

  describe("cellState", () => {
    it("returns 'sniped' when share > 0", () => {
      expect(cellState(0.01, true)).toBe("sniped");
      expect(cellState(0.01, false)).toBe("sniped");
    });

    it("returns 'held' when share <= 0 and final is true", () => {
      expect(cellState(0, true)).toBe("held");
      expect(cellState(-0.01, true)).toBe("held");
    });

    it("returns 'open' when share <= 0 and final is false", () => {
      expect(cellState(0, false)).toBe("open");
      expect(cellState(-0.01, false)).toBe("open");
    });
  });

  describe("cellLabel", () => {
    it("uses exponential format for very small positive shares (p < 0.001)", () => {
      // share = 0.000005 -> p = 0.0005 < 0.001
      const label = cellLabel(0, 0.000005, true);
      expect(label).toContain("e");
      expect(label).toContain("slot 0");
      expect(label).toContain("of curve bought by non-creator wallets");
    });

    it("uses fixed format for shares between 0.001% and 100%", () => {
      // share = 0.0001 -> p = 0.01 > 0.001
      const label = cellLabel(5, 0.0001, true);
      expect(label).toContain("slot 5");
      expect(label).toContain("of curve bought by non-creator wallets");
    });

    it("returns 'no non-creator buys' when share is 0 and final is true", () => {
      const label = cellLabel(3, 0, true);
      expect(label).toBe("slot 3: no non-creator buys");
    });

    it("returns 'no non-creator buys seen yet' when share is 0 and final is false", () => {
      const label = cellLabel(3, 0, false);
      expect(label).toBe("slot 3: no non-creator buys seen yet");
    });

    it("trims trailing zeros from fixed format labels", () => {
      // share = 0.05 -> p = 5.0
      const label = cellLabel(0, 0.05, true);
      expect(label).toBe("slot 0: 5% of curve bought by non-creator wallets"); // "5%" not "5.0%"
    });

    it("handles share > 0 with label text", () => {
      const label = cellLabel(7, 0.002, false);
      expect(label).toContain("slot 7");
      expect(label).toContain("of curve bought by non-creator wallets");
    });
  });

  describe("normalizeStrip", () => {
    it("handles undefined input", () => {
      expect(normalizeStrip(undefined)).toEqual(new Array(10).fill(0));
    });

    it("pads with zeros when array is too short", () => {
      const result = normalizeStrip([0.1, 0.2, 0.3]);
      expect(result).toHaveLength(10);
      expect(result.slice(3)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    });

    it("trims when array is too long", () => {
      const result = normalizeStrip(new Array(15).fill(0.5));
      expect(result).toHaveLength(10);
      expect(result).toEqual(new Array(10).fill(0.5));
    });

    it("converts falsy values to 0", () => {
      const result = normalizeStrip([0.1, 0, null as never, undefined as never]);
      expect(result[0]).toBe(0.1);
      expect(result[1]).toBe(0);
      expect(result[2]).toBe(0);
      expect(result[3]).toBe(0);
    });
  });

  describe("perSlotFromBuys", () => {
    it("skips creator buys", () => {
      const shares = perSlotFromBuys(
        [
          { slot_offset: 0, is_creator: true, base_out: "100" },
          { slot_offset: 0, is_creator: false, base_out: "100" },
        ],
        "1000",
      );
      expect(shares[0]).toBe(0.1); // only the non-creator buy counts
    });

    it("skips buys with negative slot_offset", () => {
      const shares = perSlotFromBuys(
        [
          { slot_offset: -1, is_creator: false, base_out: "100" },
          { slot_offset: 0, is_creator: false, base_out: "100" },
        ],
        "1000",
      );
      expect(shares[0]).toBe(0.1);
      expect(Math.max(...shares)).toBe(0.1); // only slot 0 has the buy
    });

    it("skips buys with slot_offset >= WINDOW_SLOTS", () => {
      const shares = perSlotFromBuys(
        [
          { slot_offset: 10, is_creator: false, base_out: "100" },
          { slot_offset: 11, is_creator: false, base_out: "100" },
          { slot_offset: 9, is_creator: false, base_out: "100" },
        ],
        "1000",
      );
      expect(shares[9]).toBe(0.1);
      expect(shares.every((v, i) => i !== 9 ? v === 0 : true)).toBe(true); // all except index 9 are 0
    });

    it("accumulates multiple buys in same slot", () => {
      const shares = perSlotFromBuys(
        [
          { slot_offset: 0, is_creator: false, base_out: "250" },
          { slot_offset: 0, is_creator: false, base_out: "250" },
        ],
        "1000",
      );
      expect(shares[0]).toBe(0.5);
    });

    it("returns zeros when swapBaseAmount is zero", () => {
      const shares = perSlotFromBuys(
        [{ slot_offset: 0, is_creator: false, base_out: "100" }],
        "0",
      );
      expect(shares).toEqual(new Array(10).fill(0));
    });

    it("handles empty buys array", () => {
      const shares = perSlotFromBuys([], "1000");
      expect(shares).toEqual(new Array(10).fill(0));
    });
  });
});
