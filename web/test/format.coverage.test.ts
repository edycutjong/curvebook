import { describe, expect, it } from "vitest";
import { age, atoms, bps, duration, int, pct, rankLabel, short, sol, solscanAccount, solscanTx, beamReceipt } from "@/lib/format";

describe("format - coverage gaps", () => {
  describe("short", () => {
    it("uses custom n parameter for truncation", () => {
      expect(short("FTMbCznN9NCdXUd5R5MhuhNg4Mzxtoz5ovqtzA8YoPeJ", 8)).toBe("FTMbCznN…zA8YoPeJ");
      expect(short("FTMbCznN9NCdXUd5R5MhuhNg4Mzxtoz5ovqtzA8YoPeJ", 1)).toBe("F…J");
    });

    it("handles undefined", () => {
      expect(short(undefined)).toBe("—");
    });

    it("handles address exactly at boundary (n*2+1)", () => {
      expect(short("abcdefghij", 5)).toBe("abcdefghij"); // exactly 10 chars = 5*2, not truncated
      expect(short("abcdefghijk", 5)).toBe("abcdefghijk"); // 11 chars = 5*2+1, still not truncated (boundary)
      expect(short("abcdefghijkl", 5)).toBe("abcde…hijkl"); // 12 chars > 5*2+1, truncated
    });
  });

  describe("pct", () => {
    it("handles infinity", () => {
      expect(pct(Infinity)).toBe("—");
      expect(pct(-Infinity)).toBe("—");
    });

    it("handles NaN", () => {
      expect(pct(NaN)).toBe("—");
    });

    it("handles shares below 0.01", () => {
      expect(pct(-0.05)).toBe("<0.01%"); // any value p < 0.01 shows "<0.01%"
      expect(pct(-0.0001)).toBe("<0.01%");
      expect(pct(0.000001)).toBe("<0.01%");
    });

    it("handles undefined", () => {
      expect(pct(undefined)).toBe("—");
    });

    it("handles very small positive shares", () => {
      expect(pct(0.000001)).toBe("<0.01%"); // 0.0001 < 0.01
      expect(pct(0.00005)).toBe("<0.01%"); // 0.005 < 0.01
      expect(pct(0.00009999)).toBe("<0.01%"); // 0.009999 < 0.01
      expect(pct(0.0001)).toBe("0.01%"); // 0.01 is not < 0.01
    });

    it("formats with one decimal for shares >= 1%", () => {
      expect(pct(0.01)).toBe("1.0%");
      expect(pct(0.5)).toBe("50.0%");
    });

    it("formats with two decimals for shares < 1%", () => {
      expect(pct(0.001)).toBe("0.10%");
      expect(pct(0.0099)).toBe("0.99%");
      expect(pct(0.005)).toBe("0.50%");
    });
  });

  describe("int", () => {
    it("handles infinity", () => {
      expect(int(Infinity)).toBe("—");
      expect(int(-Infinity)).toBe("—");
    });

    it("handles NaN", () => {
      expect(int(NaN)).toBe("—");
    });

    it("handles undefined", () => {
      expect(int(undefined)).toBe("—");
    });

    it("formats with locale grouping", () => {
      expect(int(1000)).toBe("1,000");
      expect(int(1000000)).toBe("1,000,000");
    });

    it("rounds numbers correctly", () => {
      expect(int(1.5)).toBe("2");
      expect(int(1.4)).toBe("1");
    });

    it("handles negative numbers", () => {
      expect(int(-1000)).toBe("-1,000");
    });
  });

  describe("duration", () => {
    it("handles infinity", () => {
      expect(duration(Infinity)).toBe("—");
    });

    it("handles NaN", () => {
      expect(duration(NaN)).toBe("—");
    });

    it("handles negative durations", () => {
      expect(duration(-100)).toBe("—");
    });

    it("handles undefined", () => {
      expect(duration(undefined)).toBe("—");
    });

    it("formats seconds under 60s", () => {
      expect(duration(0)).toBe("0s");
      expect(duration(59.5)).toBe("60s"); // rounds up
    });

    it("formats minutes under 60m", () => {
      expect(duration(61)).toBe("1m"); // 1m 1s rounds down to 1m
      expect(duration(3599)).toBe("59m");
    });

    it("formats hours under 24h", () => {
      expect(duration(3600)).toBe("1h00");
      expect(duration(3660)).toBe("1h01");
      expect(duration(86399)).toBe("23h59");
    });

    it("formats days and hours", () => {
      expect(duration(86400)).toBe("1d00");
      expect(duration(90000)).toBe("1d01");
      expect(duration(172800)).toBe("2d00");
    });
  });

  describe("age", () => {
    it("handles undefined iso", () => {
      expect(age(undefined)).toBe("—");
    });

    it("handles null iso", () => {
      expect(age(null)).toBe("—");
    });

    it("handles invalid ISO date string", () => {
      expect(age("not a date")).toBe("—");
    });

    it("handles empty string", () => {
      expect(age("")).toBe("—");
    });

    it("handles future dates (negative elapsed)", () => {
      expect(age("2026-10-03T22:00:00Z", Date.parse("2026-10-03T21:00:00Z"))).toBe("0s ago");
    });

    it("appends 'ago' to duration", () => {
      expect(age("2026-10-03T22:00:00Z", Date.parse("2026-10-03T22:01:00Z"))).toBe("1m ago");
      expect(age("2026-10-03T22:00:00Z", Date.parse("2026-10-03T23:00:00Z"))).toBe("1h00 ago");
    });
  });

  describe("atoms", () => {
    it("handles empty string", () => {
      expect(atoms("", 6)).toBe("—");
    });

    it("handles null", () => {
      expect(atoms(null, 6)).toBe("—");
    });

    it("handles undefined", () => {
      expect(atoms(undefined, 6)).toBe("—");
    });

    it("handles invalid numeric string", () => {
      expect(atoms("abc123xyz", 6)).toBe("—");
    });

    it("handles number input", () => {
      expect(atoms(1000, 6)).toBe("0.001");
    });

    it("handles bigint input", () => {
      expect(atoms(1000n, 6)).toBe("0.001");
    });

    it("handles string with decimal point (takes integer part only)", () => {
      expect(atoms("1000.999", 6)).toBe("0.001");
    });

    it("handles negative values", () => {
      expect(atoms(-1000000000n, 9)).toBe("-1");
      expect(atoms("-1000000000", 9)).toBe("-1");
    });

    it("handles zero", () => {
      expect(atoms(0, 9)).toBe("0");
      expect(atoms("0", 9)).toBe("0");
    });

    it("trims trailing zeros from fractional part", () => {
      expect(atoms("1000000000", 9)).toBe("1");
      expect(atoms("1500000000", 9)).toBe("1.5");
      expect(atoms("1050000000", 9)).toBe("1.05");
    });

    it("respects maxFrac parameter", () => {
      expect(atoms("199002201049297", 6, 2)).toBe("199,002,201.04");
      expect(atoms("199002201049297", 6, 4)).toBe("199,002,201.0492");
    });

    it("formats with locale grouping for whole part", () => {
      expect(atoms("1000000000", 6)).toBe("1,000");
      expect(atoms("1234567890", 6)).toBe("1,234.5678");
      expect(atoms("1234567890", 6, 2)).toBe("1,234.56");
    });
  });

  describe("sol", () => {
    it("uses atoms with decimals=9", () => {
      expect(sol("1000000000")).toBe("1");
      expect(sol("500000000")).toBe("0.5");
    });

    it("respects maxFrac parameter", () => {
      expect(sol("1234567890", 2)).toBe("1.23");
      expect(sol("1234567890")).toBe("1.2345");
    });

    it("handles null", () => {
      expect(sol(null)).toBe("—");
    });
  });

  describe("rankLabel", () => {
    it("handles null rank with tied=true", () => {
      expect(rankLabel(null, true)).toBe("—");
    });

    it("shows tied rank with =", () => {
      expect(rankLabel(1, true)).toBe("=1");
      expect(rankLabel(100, true)).toBe("=100");
    });

    it("shows non-tied rank without =", () => {
      expect(rankLabel(1, false)).toBe("1");
      expect(rankLabel(100, false)).toBe("100");
    });
  });

  describe("bps", () => {
    it("formats basis points as percentage", () => {
      expect(bps(100)).toBe("1%");
      expect(bps(50)).toBe("0.50%");
      expect(bps(10000)).toBe("100%");
    });

    it("shows whole percent without decimals when divisible by 100", () => {
      expect(bps(200)).toBe("2%");
      expect(bps(500)).toBe("5%");
      expect(bps(10100)).toBe("101%");
    });

    it("shows two decimal places when not divisible by 100", () => {
      expect(bps(75)).toBe("0.75%");
      expect(bps(1)).toBe("0.01%");
      expect(bps(250)).toBe("2.50%");
    });

    it("handles zero", () => {
      expect(bps(0)).toBe("0%");
    });

    it("handles large values", () => {
      expect(bps(100000)).toBe("1000%");
    });
  });

  describe("URL builders", () => {
    it("solscanTx builds correct URL", () => {
      expect(solscanTx("abc123")).toBe("https://solscan.io/tx/abc123");
      expect(solscanTx("xyz789")).toBe("https://solscan.io/tx/xyz789");
    });

    it("solscanAccount builds correct URL", () => {
      expect(solscanAccount("FTMbCznN9NCdXUd5R5MhuhNg4Mzxtoz5ovqtzA8YoPeJ")).toBe("https://solscan.io/account/FTMbCznN9NCdXUd5R5MhuhNg4Mzxtoz5ovqtzA8YoPeJ");
    });

    it("beamReceipt builds correct URL", () => {
      expect(beamReceipt("abc123")).toBe("https://api.solami.dev/swqos/tx/abc123");
      expect(beamReceipt("xyz789")).toBe("https://api.solami.dev/swqos/tx/xyz789");
    });
  });
});
