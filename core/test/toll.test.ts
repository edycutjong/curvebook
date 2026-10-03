// Spike S7 as a test: the Meteora SDK's own quote, at slot offsets 0–9, must agree with the
// fee-scheduler formula the Form uses — for every Curvebook preset.
import { describe, expect, it } from "vitest";
import BN from "bn.js";
import { DynamicBondingCurveClient, SwapMode } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { Connection } from "@solana/web3.js";
import { PRESETS, baseFeeNumeratorAt, FEE_DENOMINATOR, type ConfigInfo } from "../src/index.js";

const client = new DynamicBondingCurveClient(new Connection("http://127.0.0.1:1"), "confirmed");
const ONE_SOL = new BN(1_000_000_000);

const asInfo = (p: any): ConfigInfo => ({
  baseFee: {
    mode: p.poolFees.baseFee.baseFeeMode,
    cliffFeeNumerator: BigInt(p.poolFees.baseFee.cliffFeeNumerator.toString()),
    firstFactor: p.poolFees.baseFee.firstFactor,
    secondFactor: BigInt(p.poolFees.baseFee.secondFactor.toString()),
    thirdFactor: BigInt(p.poolFees.baseFee.thirdFactor.toString()),
  },
} as ConfigInfo);

const quoteFee = (config: any, k: number, creator: boolean) => {
  const q = client.pool.getQuoteFromInputAmount({
    config, swapBaseForQuote: false, amountIn: ONE_SOL, swapMode: SwapMode.ExactIn,
    currentPoint: new BN(k), eligibleForFirstSwapWithMinFee: creator,
  });
  return BigInt(q.includedFeeInputAmount.sub(q.excludedFeeInputAmount).toString());
};

describe.each(PRESETS.map((p) => [p.name, p] as const))("toll row: %s", (_, preset) => {
  const params = preset.params();
  const info = asInfo(params);

  it("SDK quote equals the formula at every slot offset 0–9 (1 SOL bot buy)", () => {
    for (let k = 0; k < 10; k++) {
      const expected = (ONE_SOL.toNumber() * Number(baseFeeNumeratorAt(info, k))) / Number(FEE_DENOMINATOR);
      expect(Number(quoteFee(params, k, false))).toBeCloseTo(expected, -1); // within 10 lamports of rounding
    }
  });

  it("fee never rises across the window", () => {
    for (let k = 1; k < 10; k++) expect(quoteFee(params, k, false) <= quoteFee(params, k - 1, false)).toBe(true);
  });

  it("the creator's bundled buy pays the floor fee when the preset grants it", () => {
    const creator = quoteFee(params, 0, true);
    const bot = quoteFee(params, 0, false);
    if ((params as any).enableFirstSwapWithMinFee) expect(creator < bot).toBe(true);
    else expect(creator).toBe(bot);
  });
});
