import { describe, expect, it } from "vitest";
import { baseFeeNumeratorAt, minBaseFeeNumerator, describeConfig, feeBps, type ConfigInfo } from "../src/index.js";
import { configFixture } from "./helpers.js";

const sched = (mode: number, cliff: bigint, periods: number, freq: bigint, reduction: bigint): ConfigInfo => ({
  ...configFixture("3yFxSqnZ"),
  baseFee: { mode, cliffFeeNumerator: cliff, firstFactor: periods, secondFactor: freq, thirdFactor: reduction },
});

describe("PoolConfig decoding (real mainnet accounts)", () => {
  it("reads the SNP10 denominator and fee fields", () => {
    const c = configFixture("3yFxSqnZ");
    expect(c.swapBaseAmount).toBe(793014749213242n);
    expect(c.activationType).toBe(0);
    expect(c.collectFeeMode).toBe(0);
    expect(feeBps(c.baseFee.cliffFeeNumerator)).toBe(200);
  });
});

describe("fee scheduler", () => {
  it("flat fee when there is no schedule", () => {
    const c = configFixture("2toDxUnv");
    expect(baseFeeNumeratorAt(c, 0)).toBe(baseFeeNumeratorAt(c, 100));
  });
  it("linear: cliff − n·reduction, clamped at numberOfPeriod", () => {
    const c = sched(0, 500_000_000n, 10, 2n, 40_000_000n);
    expect(baseFeeNumeratorAt(c, 0)).toBe(500_000_000n);
    expect(baseFeeNumeratorAt(c, 3)).toBe(460_000_000n);
    expect(baseFeeNumeratorAt(c, 1000)).toBe(100_000_000n);
    expect(minBaseFeeNumerator(c)).toBe(100_000_000n);
  });
  it("exponential: halves per period with reduction 5000 bps", () => {
    const c = sched(1, 500_000_000n, 5, 1n, 5000n);
    expect(baseFeeNumeratorAt(c, 0)).toBe(500_000_000n);
    expect(baseFeeNumeratorAt(c, 1)).toBe(250_000_000n);
    expect(baseFeeNumeratorAt(c, 2)).toBe(125_000_000n);
    expect(baseFeeNumeratorAt(c, 99)).toBe(15_625_000n);
  });
  it("is monotone non-increasing over the window", () => {
    const c = sched(1, 990_000_000n, 20, 1n, 1200n);
    for (let k = 1; k < 10; k++) expect(baseFeeNumeratorAt(c, k) <= baseFeeNumeratorAt(c, k - 1)).toBe(true);
  });
});

describe("describeConfig", () => {
  it("names a flat fee as having no anti-sniper schedule", () => {
    expect(describeConfig(configFixture("3yFxSqnZ"))).toContain("Flat 2.0% fee from the first slot. No anti-sniper schedule.");
  });
  it("describes an exponential schedule and the fee still paid in slot 9", () => {
    const lines = describeConfig({ ...sched(1, 500_000_000n, 10, 2n, 5000n), enableFirstSwapWithMinFee: true });
    expect(lines[0]).toBe("Fee starts at 50% and falls by 50% of itself every 2 slots, reaching 0.05% after 20 slots (exponential scheduler).");
    expect(lines[1]).toBe("A buy in slot 9 still pays 3.1%.");
    expect(lines).toContain("The creator's bundled first buy pays the minimum fee.");
  });
  it("states graduation threshold and creator fee share", () => {
    const lines = describeConfig(configFixture("3yFxSqnZ"));
    expect(lines).toContain("Graduates at 85.07 SOL to DAMM v2.");
    expect(lines).toContain("The creator keeps 100% of trading fees.");
  });
});
