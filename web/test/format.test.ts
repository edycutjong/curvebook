import { describe, expect, it } from "vitest";
import { age, atoms, duration, pct, rankLabel, short, sol } from "@/lib/format";

describe("format", () => {
  it("shortens addresses and leaves short strings alone", () => {
    expect(short("FTMbCznN9NCdXUd5R5MhuhNg4Mzxtoz5ovqtzA8YoPeJ")).toBe("FTMb…oPeJ");
    expect(short("abc")).toBe("abc");
    expect(short(null)).toBe("—");
  });

  it("prints shares as percents without hiding a nonzero share", () => {
    expect(pct(0)).toBe("0%");
    expect(pct(0.074376563)).toBe("7.4%");
    expect(pct(0.0042)).toBe("0.42%");
    expect(pct(0.00000005)).toBe("<0.01%");
    expect(pct(null)).toBe("—");
  });

  it("formats durations racing-form style", () => {
    expect(duration(45)).toBe("45s");
    expect(duration(12 * 60)).toBe("12m");
    expect(duration(3 * 3600 + 12 * 60)).toBe("3h12");
    expect(duration(2 * 86400 + 4 * 3600)).toBe("2d04");
    expect(duration(null)).toBe("—");
  });

  it("scales integer atoms exactly", () => {
    expect(sol("41589093")).toBe("0.0415");
    expect(sol("1000000000")).toBe("1");
    expect(atoms("199002201049297", 6, 2)).toBe("199,002,201.04");
    expect(atoms("not a number", 9)).toBe("—");
  });

  it("marks tied ranks with =", () => {
    expect(rankLabel(3, true)).toBe("=3");
    expect(rankLabel(1, false)).toBe("1");
    expect(rankLabel(null, false)).toBe("—");
  });

  it("prints ages relative to now", () => {
    expect(age("2026-10-03T22:00:00Z", Date.parse("2026-10-03T22:12:00Z"))).toBe("12m ago");
    expect(age(null)).toBe("—");
  });
});
