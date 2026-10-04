import { describe, expect, it } from "vitest";
import { baseFeeNumeratorAt, minBaseFeeNumerator, type ConfigInfo } from "../src/index.js";
import { configFixture } from "./helpers.js";

const sched = (mode: number, cliff: bigint, periods: number, freq: bigint, reduction: bigint): ConfigInfo => ({
  ...configFixture("3yFxSqnZ"),
  baseFee: { mode, cliffFeeNumerator: cliff, firstFactor: periods, secondFactor: freq, thirdFactor: reduction },
});

describe("config.ts coverage: missing branches", () => {
  // Line 86: linear fee clamped to 0
  it("linear scheduler clamps negative fees to 0", () => {
    const c = sched(0, 100_000_000n, 5, 1n, 30_000_000n);
    expect(baseFeeNumeratorAt(c, 10)).toBe(0n);
  });

  // Line 108: minBaseFeeNumerator with freq === 0n (uses 1n fallback)
  it("minBaseFeeNumerator handles zero frequency by using 1n as fallback", () => {
    const c = sched(0, 100_000_000n, 5, 0n, 30_000_000n);
    expect(minBaseFeeNumerator(c)).toBe(100_000_000n);
  });
});
