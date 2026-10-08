// Property-based verification of the two functions the Form's numbers rest on.
// Case counts are fixed so the README can state them: 3 × 10,000 window cases, 20,000 fee-schedule cases.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import BN from "bn.js";
import { getBaseFeeNumeratorByPeriod } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { buildWindow, baseFeeNumeratorAt, WINDOW_SLOTS, type ConfigInfo, type SwapEvent } from "../src/index.js";
import { buy } from "./helpers.js";

const OPEN = 1_000;
const DENOM = 10n ** 15n;
const wallet = fc.constantFrom("CREATOR", "A", "B", "C", "D", "E", null);
const arbSwap = fc.record({
  slot: fc.integer({ min: OPEN - 3, max: OPEN + WINDOW_SLOTS + 3 }),
  payer: wallet,
  output: fc.bigInt({ min: 1n, max: 10n ** 13n }),
  tradeDirection: fc.constantFrom(0, 1),
  pool: fc.constantFrom("P", "P", "P", "OTHER"),
}).map((s) => buy(s));
// buildWindow (correctly) counts each signature once, so generated buys need distinct signatures:
// two random buys that happened to share one would be deduplicated and break the expected sums.
const arbSwaps = (maxLength: number) => fc.array(arbSwap, { maxLength }).map((a) => a.map((s, i) => ({ ...s, sig: `${s.sig}#${i}` })));
const run = (swaps: SwapEvent[]) => buildWindow({ pool: "P", config: "C", creator: "CREATOR", openSlot: OPEN, swapBaseAmount: DENOM, swaps });

describe("SNP10 window properties (10,000 random windows each)", () => {
  it("the creator's own buys never change SNP10", () => {
    fc.assert(fc.property(arbSwaps(40), fc.array(fc.bigInt({ min: 1n, max: 10n ** 13n }), { maxLength: 5 }), (swaps, extra) => {
      const more = [...swaps, ...extra.map((o, i) => buy({ slot: OPEN + (i % WINDOW_SLOTS), payer: "CREATOR", output: o, sig: `c${i}` }))];
      expect(run(more).snp10).toBe(run(swaps).snp10);
    }), { numRuns: 10_000 });
  });

  it("only outside buys inside [s_open, s_open+9] on this pool count, and per-slot cells sum to SNP10", () => {
    fc.assert(fc.property(arbSwaps(40), (swaps) => {
      const w = run(swaps);
      const expected = swaps
        .filter((s) => s.pool === "P" && s.tradeDirection === 1 && s.payer !== "CREATOR" && s.slot >= OPEN && s.slot < OPEN + WINDOW_SLOTS)
        .reduce((a, s) => a + s.output, 0n);
      expect(w.ncBase).toBe(expected);
      expect(w.perSlot.reduce((a, b) => a + b, 0)).toBeCloseTo(w.snp10, 6);
      expect(w.top3Share).toBeLessThanOrEqual(w.snp10 + 1e-9);
    }), { numRuns: 10_000 });
  }, 30_000);

  it("is independent of arrival order (stream vs crawl)", () => {
    fc.assert(fc.property(arbSwaps(30).chain((s) => fc.tuple(fc.constant(s), fc.shuffledSubarray(s, { minLength: s.length, maxLength: s.length }))), ([a, b]) => {
      expect(run(b).snp10).toBe(run(a).snp10);
      expect(run(b).ncWallets).toBe(run(a).ncWallets);
    }), { numRuns: 10_000 });
  });
});

describe("fee schedule (20,000 random schedules × 10 slots)", () => {
  it("equals the Meteora SDK's own scheduler and never rises across the window", () => {
    const arbCfg = fc.record({
      mode: fc.constantFrom(0, 1),
      cliff: fc.integer({ min: 2_500_000, max: 990_000_000 }),
      periods: fc.integer({ min: 0, max: 600 }),
      freq: fc.integer({ min: 1, max: 20 }),
      reduction: fc.integer({ min: 0, max: 9_999 }),
    });
    fc.assert(fc.property(arbCfg, ({ mode, cliff, periods, freq, reduction }) => {
      // Linear schedules must not go negative (DBC rejects such configs at creation).
      const red = mode === 0 ? Math.floor(((reduction / 9_999) * cliff) / Math.max(periods, 1)) : reduction;
      const cfg = { baseFee: { mode, cliffFeeNumerator: BigInt(cliff), firstFactor: periods, secondFactor: BigInt(freq), thirdFactor: BigInt(red) } } as ConfigInfo;
      let prev = BigInt(cliff);
      for (let k = 0; k < WINDOW_SLOTS; k++) {
        const mine = baseFeeNumeratorAt(cfg, k);
        const sdk = periods === 0 ? BigInt(cliff)
          : BigInt(getBaseFeeNumeratorByPeriod(new BN(cliff), periods, new BN(Math.floor(k / freq)), new BN(red), mode).toString());
        expect(mine).toBe(sdk);
        expect(mine <= prev).toBe(true);
        prev = mine;
      }
    }), { numRuns: 20_000 });
  }, 60_000); // 200,000 slot checks: give CI headroom under load
});
