import { describe, expect, it } from "vitest";
import { FULL_CELL_SHARE, MIN_VISIBLE_FILL, cellFill, cellLabel, cellState, normalizeStrip, perSlotFromBuys } from "@/lib/strip";

describe("strip scaling", () => {
  it("fills proportionally up to the full-cell share, never invisibly", () => {
    expect(cellFill(0)).toBe(0);
    expect(cellFill(FULL_CELL_SHARE / 2)).toBeCloseTo(0.5);
    expect(cellFill(0.4)).toBe(1);
    expect(cellFill(1e-9)).toBe(MIN_VISIBLE_FILL);
    expect(cellFill(Number.NaN)).toBe(0);
  });

  it("only ticks green once the window is final", () => {
    expect(cellState(0, true)).toBe("held");
    expect(cellState(0, false)).toBe("open");
    expect(cellState(0.01, false)).toBe("sniped");
    expect(cellState(0.01, true)).toBe("sniped");
  });

  it("labels each cell with the exact share", () => {
    expect(cellLabel(3, 0.032, true)).toBe("slot 3: 3.2% of curve bought by non-creator wallets");
    expect(cellLabel(0, 0, true)).toBe("slot 0: no non-creator buys");
    expect(cellLabel(0, 0, false)).toBe("slot 0: no non-creator buys seen yet");
  });

  it("normalizes to exactly ten cells", () => {
    expect(normalizeStrip([0.1, 0.2])).toEqual([0.1, 0.2, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(normalizeStrip(null)).toHaveLength(10);
    expect(normalizeStrip(new Array(12).fill(0.5))).toHaveLength(10);
  });

  it("sums only non-creator buys per slot against the sellable supply", () => {
    const shares = perSlotFromBuys(
      [
        { slot_offset: 0, is_creator: true, base_out: "500" },
        { slot_offset: 1, is_creator: false, base_out: "100" },
        { slot_offset: 1, is_creator: false, base_out: "50" },
        { slot_offset: 9, is_creator: false, base_out: "10" },
        { slot_offset: 10, is_creator: false, base_out: "999" },
      ],
      "1000",
    );
    expect(shares[0]).toBe(0);
    expect(shares[1]).toBeCloseTo(0.15);
    expect(shares[9]).toBeCloseTo(0.01);
    expect(shares).toHaveLength(10);
    expect(perSlotFromBuys([{ slot_offset: 0, is_creator: false, base_out: "1" }], null)).toEqual(new Array(10).fill(0));
  });
});
