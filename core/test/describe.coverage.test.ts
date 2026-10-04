import { describe, expect, it } from "vitest";
import { describeConfig, BaseFeeMode, type ConfigInfo } from "../src/index.js";
import { configFixture } from "./helpers.js";

const sched = (mode: number, cliff: bigint, periods: number, freq: bigint, reduction: bigint): ConfigInfo => ({
  ...configFixture("3yFxSqnZ"),
  baseFee: { mode, cliffFeeNumerator: cliff, firstFactor: periods, secondFactor: freq, thirdFactor: reduction },
});

describe("describe.ts coverage: missing branches", () => {
  // Line 22: rate limiter mode description
  it("rate limiter mode describes fee rising with trade size", () => {
    const c = sched(BaseFeeMode.RateLimiter, 50_000_000n, 10, 5n, 1000n);
    const desc = describeConfig(c);
    expect(desc).toContain("Fee starts at 5.0% and rises with trade size for 5 slots (rate limiter).");
  });

  // Line 22 with seconds unit
  it("rate limiter with timestamp activation uses 'second' unit", () => {
    const c = {
      ...sched(BaseFeeMode.RateLimiter, 50_000_000n, 10, 5n, 1000n),
      activationType: 1,
    };
    const desc = describeConfig(c);
    expect(desc).toContain("Fee starts at 5.0% and rises with trade size for 5 seconds (rate limiter).");
  });

  // Line 31: exponential mode with percentage description
  it("exponential scheduler describes fee falling by reduction percentage", () => {
    const c = sched(BaseFeeMode.SchedulerExponential, 500_000_000n, 5, 2n, 5000n);
    const desc = describeConfig(c);
    expect(desc[0]).toContain("falls by 50% of itself every 2 slots");
  });

  // Line 31 with seconds unit for exponential
  it("exponential scheduler with timestamp activation uses 'seconds' unit", () => {
    const c = {
      ...sched(BaseFeeMode.SchedulerExponential, 500_000_000n, 5, 2n, 5000n),
      activationType: 1,
    };
    const desc = describeConfig(c);
    expect(desc[0]).toContain("falls by 50% of itself every 2 seconds");
  });

  // Test enableFirstSwapWithMinFee false branch
  it("describes creator fee line when enableFirstSwapWithMinFee is false", () => {
    const c = { ...sched(0, 500_000_000n, 10, 2n, 40_000_000n), enableFirstSwapWithMinFee: false };
    const desc = describeConfig(c);
    expect(desc).toContain("The creator's first buy pays the same fee as everyone else.");
  });

  // Test migrationOption 0 (DAMM v1)
  it("describes DAMM v1 graduation when migrationOption is 0", () => {
    const c = { ...sched(0, 500_000_000n, 10, 2n, 40_000_000n), migrationOption: 0 };
    const desc = describeConfig(c);
    expect(desc.some((line) => line.includes("DAMM v1"))).toBe(true);
  });

  // Test non-SOL quote mint
  it("describes non-SOL quote mint as atoms", () => {
    const c = {
      ...sched(0, 500_000_000n, 10, 2n, 40_000_000n),
      quoteMint: "EPjFWaLb3odccxiLVXACCqwLgtoawwDFUZJ4Q7XDaiM", // USDC
    };
    const desc = describeConfig(c);
    expect(desc.some((line) => line.includes("quote atoms"))).toBe(true);
  });

  // Test creator fee > 0
  it("describes creator fee share when creatorTradingFeePct > 0", () => {
    const c = { ...sched(0, 500_000_000n, 10, 2n, 40_000_000n), creatorTradingFeePct: 25 };
    const desc = describeConfig(c);
    expect(desc).toContain("The creator keeps 25% of trading fees.");
  });

  // Test poolCreationFee > 0
  it("describes pool creation fee when poolCreationFee > 0", () => {
    const c = { ...sched(0, 500_000_000n, 10, 2n, 40_000_000n), poolCreationFee: 100_000_000n };
    const desc = describeConfig(c);
    expect(desc.some((line) => line.includes("pool creation fee"))).toBe(true);
  });

  // Test dynamicFee true
  it("describes dynamic fee when enabled", () => {
    const c = { ...sched(0, 500_000_000n, 10, 2n, 40_000_000n), dynamicFee: true };
    const desc = describeConfig(c);
    expect(desc).toContain("A volatility-based dynamic fee is added on top.");
  });

  // Test timestamp activation line
  it("describes timestamp activation in the footer", () => {
    const c = { ...sched(0, 500_000_000n, 10, 2n, 40_000_000n), activationType: 1 };
    const desc = describeConfig(c);
    expect(desc).toContain("Timestamp activation.");
  });

  // Test slot activation line
  it("describes slot activation in the footer", () => {
    const c = { ...sched(0, 500_000_000n, 10, 2n, 40_000_000n), activationType: 0 };
    const desc = describeConfig(c);
    expect(desc).toContain("Slot activation.");
  });

  // Test periods === 0 branch (flat fee)
  it("describes flat fee when periods is 0", () => {
    const c = sched(BaseFeeMode.SchedulerLinear, 200_000_000n, 0, 1n, 10_000_000n);
    const desc = describeConfig(c);
    expect(desc).toContain("Flat 20% fee from the first slot. No anti-sniper schedule.");
  });

  // Test reduction === 0n branch (flat fee)
  it("describes flat fee when reduction is 0", () => {
    const c = sched(BaseFeeMode.SchedulerLinear, 200_000_000n, 10, 1n, 0n);
    const desc = describeConfig(c);
    expect(desc).toContain("Flat 20% fee from the first slot. No anti-sniper schedule.");
  });

  // Test percentage formatting: <1%
  it("formats percentages less than 1% with 2 decimals", () => {
    const c = sched(BaseFeeMode.SchedulerLinear, 5_000_000n, 1, 1n, 0n);
    const desc = describeConfig(c);
    expect(desc[0]).toContain("0.50%");
  });

  // Test percentage formatting: 1-10%
  it("formats percentages 1-10% with 1 decimal", () => {
    const c = sched(BaseFeeMode.SchedulerLinear, 50_000_000n, 1, 1n, 0n);
    const desc = describeConfig(c);
    expect(desc[0]).toContain("5.0%");
  });

  // Test percentage formatting: >=10%
  it("formats percentages >=10% with no decimals", () => {
    const c = sched(BaseFeeMode.SchedulerLinear, 100_000_000n, 1, 1n, 0n);
    const desc = describeConfig(c);
    expect(desc[0]).toContain("10%");
  });

  // Test units pluralization: single slot
  it("pluralizes unit names correctly for single slot", () => {
    const c = sched(BaseFeeMode.SchedulerLinear, 500_000_000n, 1, 1n, 100_000_000n);
    const desc = describeConfig(c);
    expect(desc[0]).toContain("every 1 slot");
  });

  // Test units pluralization: multiple slots
  it("pluralizes unit names correctly for multiple slots", () => {
    const c = sched(BaseFeeMode.SchedulerLinear, 500_000_000n, 5, 2n, 100_000_000n);
    const desc = describeConfig(c);
    expect(desc[0]).toContain("every 2 slots");
  });

  // Test slot 9 fee display (line 34-35 in describe.ts)
  it("shows fee at slot 9 for slot-based activation with a scheduled fee", () => {
    const c = {
      ...sched(BaseFeeMode.SchedulerLinear, 500_000_000n, 10, 2n, 40_000_000n),
      activationType: 0,
    };
    const desc = describeConfig(c);
    expect(desc.some((line) => line.includes("A buy in slot 9"))).toBe(true);
  });

  // Ensure slot 9 fee line is NOT shown for timestamp activation
  it("does not show slot 9 fee for timestamp-based activation", () => {
    const c = {
      ...sched(BaseFeeMode.SchedulerLinear, 500_000_000n, 10, 2n, 40_000_000n),
      activationType: 1,
    };
    const desc = describeConfig(c);
    const hasFeeAtSlot9 = desc.some((line) => line.includes("A buy in slot"));
    expect(hasFeeAtSlot9).toBe(false);
  });

  // Test enableFirstSwapWithMinFee true branch
  it("describes first buy minimum fee when enableFirstSwapWithMinFee is true", () => {
    const c = { ...sched(0, 500_000_000n, 10, 2n, 40_000_000n), enableFirstSwapWithMinFee: true };
    const desc = describeConfig(c);
    expect(desc).toContain("The creator's bundled first buy pays the minimum fee.");
  });

  // Test linear scheduler line description
  it("linear scheduler shows drops wording", () => {
    const c = sched(BaseFeeMode.SchedulerLinear, 500_000_000n, 5, 2n, 100_000_000n);
    const desc = describeConfig(c);
    expect(desc[0]).toContain("drops 10%");
  });

  // Test trim function with non-integer SOL amounts (line 13 trim with replacement)
  it("trims trailing zeros from SOL amounts", () => {
    const c = { ...sched(0, 500_000_000n, 10, 2n, 40_000_000n), migrationQuoteThreshold: 1_250_000_000n };
    const desc = describeConfig(c);
    // 1.25 SOL should be shown, testing the trim function replacing /0+$/
    expect(desc.some((line) => line.includes("1.25 SOL"))).toBe(true);
  });

  // Test trim function with trailing dot removal (line 13 replace(/\.$/))
  it("trims trailing dot from whole SOL amounts", () => {
    const c = { ...sched(0, 500_000_000n, 10, 2n, 40_000_000n), migrationQuoteThreshold: 100_000_000n };
    const desc = describeConfig(c);
    // 0.1 SOL should be shown
    expect(desc.some((line) => line.includes("0.1 SOL"))).toBe(true);
  });

  // Test trim function path: number < 1 with toFixed(3)
  it("formats small SOL amounts with 3 decimals", () => {
    const c = { ...sched(0, 500_000_000n, 10, 2n, 40_000_000n), migrationQuoteThreshold: 50_000_000n };
    const desc = describeConfig(c);
    // 0.05 SOL
    expect(desc.some((line) => line.includes("0.05 SOL"))).toBe(true);
  });

  // Test format with complex decimal
  it("handles SOL amounts with multiple decimal places", () => {
    const c = { ...sched(0, 500_000_000n, 10, 2n, 40_000_000n), migrationQuoteThreshold: 1_234_567_890n };
    const desc = describeConfig(c);
    // 1.23 SOL (rounded to 2 decimals)
    expect(desc.some((line) => line.includes("1.23 SOL"))).toBe(true);
  });

  // Test tiny SOL amount that rounds to 0
  it("handles very small SOL amounts", () => {
    const c = { ...sched(0, 500_000_000n, 10, 2n, 40_000_000n), migrationQuoteThreshold: 100n };
    const desc = describeConfig(c);
    // 0 SOL (100 atoms = 0.0000001 SOL, toFixed(3) = "0.000" -> trim -> "0")
    expect(desc.some((line) => line.includes("0 SOL"))).toBe(true);
  });

  // Test trim function: all paths of replace operations
  it("poolCreationFee with very small SOL triggers trim dot removal", () => {
    const c = { ...sched(0, 500_000_000n, 10, 2n, 40_000_000n), poolCreationFee: 1n };
    const desc = describeConfig(c);
    // 1 atom = 0.000000001 SOL, in toFixed(3) becomes "0.000" -> "0." -> "0"
    expect(desc.some((line) => line.includes("pool creation fee"))).toBe(true);
  });

  // Test non-zero decimal less than 1
  it("handles decimals less than 1 with trailing zeros trimmed", () => {
    const c = { ...sched(0, 500_000_000n, 10, 2n, 40_000_000n), migrationQuoteThreshold: 10_000_000n };
    const desc = describeConfig(c);
    // 0.01 SOL
    expect(desc.some((line) => line.includes("0.01 SOL"))).toBe(true);
  });

  // Test edge case where decimal rounds to whole with trim
  it("handles rounding edge cases in decimal formatting", () => {
    const c = { ...sched(0, 500_000_000n, 10, 2n, 40_000_000n), migrationQuoteThreshold: 9_950_000_000n };
    const desc = describeConfig(c);
    // 9.95 SOL
    expect(desc.some((line) => line.includes("9.95 SOL"))).toBe(true);
  });
});
