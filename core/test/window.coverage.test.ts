import { describe, expect, it } from "vitest";
import { buildWindow, openSlot, inWindow } from "../src/index.js";
import { buy } from "./helpers.js";

const base = { pool: "P", config: "C", creator: "CREATOR", openSlot: 100, swapBaseAmount: 1_000_000n };

describe("window.ts coverage: missing branches", () => {
  // Line 64: share function with den === 0n
  it("buildWindow handles zero swapBaseAmount by returning 0 share", () => {
    const w = buildWindow({
      ...base,
      swapBaseAmount: 0n,
      swaps: [buy({ slot: 100, payer: "A", output: 500_000n })],
    });
    expect(w.snp10).toBe(0);
    expect(w.perSlot[0]).toBe(0);
    expect(w.top3Share).toBe(0);
  });

  // Test ncFees calculation
  it("ncFees sums fees paid by non-creator buys", () => {
    const w = buildWindow({
      ...base,
      swaps: [
        buy({ slot: 100, payer: "A", output: 100n, includedFeeInput: 1000n, excludedFeeInput: 700n }),
        buy({ slot: 101, payer: "B", output: 200n, includedFeeInput: 2000n, excludedFeeInput: 1500n }),
        buy({ slot: 102, payer: "CREATOR", output: 100n, includedFeeInput: 1000n, excludedFeeInput: 800n }),
      ],
    });
    // A: 1000 - 700 = 300, B: 2000 - 1500 = 500, CREATOR doesn't count
    expect(w.ncFees).toBe(800n);
  });

  // Test sorting by slot
  it("buildWindow sorts buys by slot", () => {
    const w = buildWindow({
      ...base,
      swaps: [
        buy({ sig: "s3", slot: 105, payer: "C", output: 30_000n }),
        buy({ sig: "s1", slot: 100, payer: "A", output: 10_000n }),
        buy({ sig: "s2", slot: 102, payer: "B", output: 20_000n }),
      ],
    });
    expect(w.buys[0].sig).toBe("s1");
    expect(w.buys[1].sig).toBe("s2");
    expect(w.buys[2].sig).toBe("s3");
  });

  // Test perSlotBase array filling with correct offsets
  it("buildWindow assigns buys to correct perSlot positions by offset", () => {
    const w = buildWindow({
      ...base,
      openSlot: 100,
      swaps: [
        buy({ slot: 100, payer: "A", output: 10_000n }),
        buy({ slot: 105, payer: "B", output: 20_000n }),
        buy({ slot: 109, payer: "C", output: 30_000n }),
      ],
    });
    expect(w.perSlot[0]).toBeCloseTo(0.01, 9);
    expect(w.perSlot[5]).toBeCloseTo(0.02, 9);
    expect(w.perSlot[9]).toBeCloseTo(0.03, 9);
  });

  // Test byWallet tracking for top3Share
  it("buildWindow tracks wallet sizes correctly for top3Share", () => {
    const w = buildWindow({
      ...base,
      swaps: [
        buy({ slot: 100, payer: "A", output: 400_000n }),
        buy({ slot: 101, payer: "B", output: 300_000n }),
        buy({ slot: 102, payer: "C", output: 200_000n }),
        buy({ slot: 103, payer: "D", output: 100_000n }),
      ],
    });
    // Top 3: 400k, 300k, 200k = 900k total, SNP10 = 1.0
    expect(w.top3Share).toBe(0.9);
  });

  // Test perSlotBase accumulation
  it("buildWindow accumulates multiple buys in same slot to perSlot", () => {
    const w = buildWindow({
      ...base,
      swaps: [
        buy({ sig: "s1", slot: 100, payer: "A", output: 50_000n }),
        buy({ sig: "s2", slot: 100, payer: "B", output: 75_000n }),
      ],
    });
    expect(w.perSlot[0]).toBeCloseTo(0.125, 9);
  });

  // Test filtering by pool (line 78-81)
  it("buildWindow filters by matching pool only", () => {
    const w = buildWindow({
      ...base,
      swaps: [
        buy({ slot: 100, payer: "A", output: 100_000n }),
        buy({ slot: 101, payer: "B", output: 50_000n, pool: "OTHER" }),
      ],
    });
    expect(w.buys).toHaveLength(1);
    expect(w.snp10).toBeCloseTo(0.1, 9);
  });

  // Test filtering by trade direction (line 78-81)
  it("buildWindow filters by trade direction 1 (buy) only", () => {
    const w = buildWindow({
      ...base,
      swaps: [
        buy({ slot: 100, payer: "A", output: 100_000n, tradeDirection: 1 }),
        buy({ slot: 101, payer: "B", output: 50_000n, tradeDirection: 0 }),
      ],
    });
    expect(w.buys).toHaveLength(1);
    expect(w.snp10).toBeCloseTo(0.1, 9);
  });

  // Test filtering by window (line 78-81)
  it("buildWindow filters by time window", () => {
    const w = buildWindow({
      ...base,
      openSlot: 100,
      swaps: [
        buy({ slot: 100, payer: "A", output: 100_000n }),
        buy({ slot: 109, payer: "B", output: 50_000n }),
        buy({ slot: 110, payer: "C", output: 75_000n }),
      ],
    });
    expect(w.buys).toHaveLength(2);
  });

  // Test replay deduplication (line 80-82)
  it("buildWindow dedupes replayed transactions by sig+output+fee", () => {
    const buy1 = buy({ sig: "S1", slot: 100, payer: "A", output: 100_000n, includedFeeInput: 1000n });
    const w = buildWindow({
      ...base,
      swaps: [buy1, buy1], // Same transaction twice
    });
    expect(w.buys).toHaveLength(1);
  });

  // Test creatorBase accumulation
  it("buildWindow separates creator base from ncBase", () => {
    const w = buildWindow({
      ...base,
      swaps: [
        buy({ slot: 100, payer: "CREATOR", output: 250_000n }),
        buy({ slot: 100, payer: "A", output: 100_000n }),
      ],
    });
    expect(w.creatorBase).toBe(250_000n);
    expect(w.ncBase).toBe(100_000n);
  });

  // Test ncWallets count with unpaired wallets
  it("buildWindow counts unpaired payers as separate wallets", () => {
    const w = buildWindow({
      ...base,
      swaps: [
        buy({ sig: "s1", slot: 100, payer: null, output: 10_000n }),
        buy({ sig: "s2", slot: 101, payer: null, output: 10_000n }),
        buy({ sig: "s3", slot: 102, payer: "A", output: 10_000n }),
      ],
    });
    expect(w.ncWallets).toBe(3);
  });

  // Test openSlot slot activation: ap <= init.slot
  it("openSlot with slot activation in the past uses creation slot", () => {
    expect(openSlot({ slot: 100, blockTime: 1000, activationPoint: 50n }, 0)).toBe(100);
  });

  // Test openSlot slot activation: ap > init.slot
  it("openSlot with slot activation in the future uses activation point", () => {
    expect(openSlot({ slot: 100, blockTime: 1000, activationPoint: 150n }, 0)).toBe(150);
  });

  // Test openSlot timestamp branch: blockTime >= activationPoint
  it("openSlot with timestamp activation and blockTime >= activationPoint", () => {
    expect(openSlot({ slot: 50, blockTime: 2000, activationPoint: 1999n }, 1)).toBe(50);
  });

  // Test openSlot timestamp activation waiting for swap
  it("openSlot with timestamp activation returns null until swap reaches threshold", () => {
    expect(openSlot({ slot: 50, blockTime: 1000, activationPoint: 2000n }, 1)).toBeNull();
    expect(openSlot({ slot: 50, blockTime: 1000, activationPoint: 2000n }, 1, { slot: 100 })).toBe(100);
  });

  // Test inWindow boundary conditions
  it("inWindow includes exact boundaries", () => {
    expect(inWindow(100, 100)).toBe(true);
    expect(inWindow(109, 100)).toBe(true);
  });

  it("inWindow excludes outside window", () => {
    expect(inWindow(99, 100)).toBe(false);
    expect(inWindow(110, 100)).toBe(false);
  });

  // Test byWallet map using payer or unpaired key
  it("buildWindow uses unpaired key format for null payers in wallet map", () => {
    const w = buildWindow({
      ...base,
      swaps: [buy({ sig: "unique-sig", slot: 100, payer: null, output: 100_000n })],
    });
    expect(w.ncWallets).toBe(1);
    // The unpaired buy should be counted
    expect(w.buys[0].payer).toBeNull();
  });
});
