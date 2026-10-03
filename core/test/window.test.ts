import { describe, expect, it } from "vitest";
import { buildWindow, openSlot, inWindow } from "../src/index.js";
import { buy } from "./helpers.js";

const base = { pool: "P", config: "C", creator: "CREATOR", openSlot: 100, swapBaseAmount: 1_000_000n };

describe("openSlot", () => {
  it("slot activation in the past opens at the creation slot", () => {
    expect(openSlot({ slot: 100, blockTime: 1, activationPoint: 50n }, 0)).toBe(100);
  });
  it("slot activation in the future opens at the activation point", () => {
    expect(openSlot({ slot: 100, blockTime: 1, activationPoint: 150n }, 0)).toBe(150);
  });
  it("timestamp activation already reached opens at creation", () => {
    expect(openSlot({ slot: 100, blockTime: 1000, activationPoint: 999n }, 1)).toBe(100);
  });
  it("timestamp activation in the future waits for the first swap after it", () => {
    expect(openSlot({ slot: 100, blockTime: 1000, activationPoint: 2000n }, 1)).toBeNull();
    expect(openSlot({ slot: 100, blockTime: 1000, activationPoint: 2000n }, 1, { slot: 180 })).toBe(180);
  });
});

describe("buildWindow / SNP10", () => {
  it("covers exactly 10 slots", () => {
    expect(inWindow(100, 100)).toBe(true);
    expect(inWindow(109, 100)).toBe(true);
    expect(inWindow(110, 100)).toBe(false);
    expect(inWindow(99, 100)).toBe(false);
  });

  it("excludes the creator, sells, other pools and slots outside the window", () => {
    const w = buildWindow({
      ...base,
      swaps: [
        buy({ slot: 100, payer: "CREATOR", output: 500_000n }),
        buy({ slot: 100, payer: "A", output: 100_000n }),
        buy({ slot: 101, payer: "B", output: 50_000n }),
        buy({ slot: 101, payer: "A", output: 30_000n, tradeDirection: 0 }),
        buy({ slot: 102, payer: "C", output: 70_000n, pool: "OTHER" }),
        buy({ slot: 110, payer: "D", output: 90_000n }),
      ],
    });
    expect(w.snp10).toBeCloseTo(0.15, 9);
    expect(w.perSlot[0]).toBeCloseTo(0.1, 9);
    expect(w.perSlot[1]).toBeCloseTo(0.05, 9);
    expect(w.creatorBase).toBe(500_000n);
    expect(w.ncWallets).toBe(2);
  });

  it("counts an unpaired payer as non-creator", () => {
    const w = buildWindow({ ...base, swaps: [buy({ slot: 103, payer: null, output: 10_000n })] });
    expect(w.snp10).toBeCloseTo(0.01, 9);
    expect(w.ncWallets).toBe(1);
  });

  it("top-3 share sums the three largest outside wallets", () => {
    const w = buildWindow({
      ...base,
      swaps: ["A", "B", "C", "D"].map((p, i) => buy({ slot: 100 + i, payer: p, output: BigInt((i + 1) * 10_000) })),
    });
    expect(w.top3Share).toBeCloseTo(0.09, 9);
    expect(w.snp10).toBeCloseTo(0.1, 9);
  });

  it("dedupes a replayed event but keeps two distinct buys in one tx", () => {
    const a = buy({ sig: "S", slot: 100, payer: "A", output: 1_000n });
    const b = buy({ sig: "S", slot: 100, payer: "A", output: 2_000n });
    expect(buildWindow({ ...base, swaps: [a, a, b] }).buys).toHaveLength(2);
  });

  it("sums the fees outside wallets paid inside the window", () => {
    const w = buildWindow({ ...base, swaps: [buy({ slot: 100, payer: "A", output: 1n, includedFeeInput: 1_000n, excludedFeeInput: 600n })] });
    expect(w.ncFees).toBe(400n);
  });

  it("a window with only the creator's buy has SNP10 = 0", () => {
    const w = buildWindow({ ...base, swaps: [buy({ slot: 100, payer: "CREATOR", output: 400_000n })] });
    expect(w.snp10).toBe(0);
    expect(w.perSlot.every((x) => x === 0)).toBe(true);
  });
});
