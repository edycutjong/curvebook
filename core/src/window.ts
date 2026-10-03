// The measured unit: a pool's first WINDOW_SLOTS slots after it opens.
//
// SNP10 = Σ base bought by non-creator wallets in [s_open, s_open+9] ÷ PoolConfig.swap_base_amount.
// A buy whose payer could not be paired is counted as non-creator (stated on the page).
import { WINDOW_SLOTS } from "./constants.js";
import type { InitEvent, SwapEvent } from "./decode.js";

export type WindowBuy = {
  sig: string;
  slot: number;
  offset: number;
  payer: string | null;
  isCreator: boolean;
  quoteIn: bigint; // included-fee input
  fee: bigint; // included − excluded input
  baseOut: bigint;
  viaCpi: boolean;
};

export type PoolWindow = {
  pool: string;
  config: string;
  creator: string;
  openSlot: number;
  buys: WindowBuy[];
  /** share of sellable supply bought by non-creator wallets, 0..1 */
  snp10: number;
  /** per-slot non-creator share, length WINDOW_SLOTS */
  perSlot: number[];
  ncWallets: number;
  /** share of sellable supply taken by the 3 largest non-creator wallets */
  top3Share: number;
  creatorBase: bigint;
  ncBase: bigint;
  /** fees paid by non-creator buys inside the window (quote atoms) */
  ncFees: bigint;
};

/**
 * Slot the pool opens for trading.
 * Slot activation: max(creation slot, activation point).
 * Timestamp activation: the creation slot if already active at creation, otherwise
 * the slot of the first swap whose block timestamp reached the activation point
 * (null until such a swap is seen).
 */
export function openSlot(
  init: Pick<InitEvent, "slot" | "blockTime" | "activationPoint">,
  activationType: number,
  firstSwapAfterActivation?: { slot: number } | null,
): number | null {
  if (activationType === 0) {
    const ap = Number(init.activationPoint);
    return ap <= init.slot ? init.slot : ap;
  }
  if (init.blockTime != null && Number(init.activationPoint) <= init.blockTime) return init.slot;
  return firstSwapAfterActivation?.slot ?? null;
}

export function inWindow(slot: number, open: number): boolean {
  return slot >= open && slot < open + WINDOW_SLOTS;
}

/** Shares are computed in parts-per-billion with bigint, then converted, so large supplies stay exact. */
const share = (num: bigint, den: bigint): number => (den === 0n ? 0 : Number((num * 1_000_000_000n) / den) / 1e9);

export function buildWindow(args: {
  pool: string;
  config: string;
  creator: string;
  openSlot: number;
  swapBaseAmount: bigint;
  swaps: SwapEvent[];
}): PoolWindow {
  const { pool, config, creator, openSlot: open, swapBaseAmount } = args;
  const seen = new Set<string>();
  const buys: WindowBuy[] = [];
  for (const s of args.swaps) {
    if (s.pool !== pool || s.tradeDirection !== 1 || !inWindow(s.slot, open)) continue;
    // One tx can hold several buys on the same pool; key by sig + amounts to dedupe replays only.
    const key = `${s.sig}:${s.output}:${s.includedFeeInput}`;
    if (seen.has(key)) continue;
    seen.add(key);
    buys.push({
      sig: s.sig,
      slot: s.slot,
      offset: s.slot - open,
      payer: s.payer,
      isCreator: s.payer === creator,
      quoteIn: s.includedFeeInput,
      fee: s.includedFeeInput - s.excludedFeeInput,
      baseOut: s.output,
      viaCpi: s.viaCpi,
    });
  }
  buys.sort((a, b) => a.slot - b.slot);

  const perSlotBase = Array.from({ length: WINDOW_SLOTS }, () => 0n);
  const byWallet = new Map<string, bigint>();
  let ncBase = 0n;
  let creatorBase = 0n;
  let ncFees = 0n;
  for (const b of buys) {
    if (b.isCreator) {
      creatorBase += b.baseOut;
      continue;
    }
    ncBase += b.baseOut;
    ncFees += b.fee;
    perSlotBase[b.offset] += b.baseOut;
    const w = b.payer ?? `unpaired:${b.sig}`;
    byWallet.set(w, (byWallet.get(w) ?? 0n) + b.baseOut);
  }
  const top3 = [...byWallet.values()].sort((a, b) => (b > a ? 1 : b < a ? -1 : 0)).slice(0, 3).reduce((a, b) => a + b, 0n);

  return {
    pool, config, creator, openSlot: open, buys,
    snp10: share(ncBase, swapBaseAmount),
    perSlot: perSlotBase.map((v) => share(v, swapBaseAmount)),
    ncWallets: byWallet.size,
    top3Share: share(top3, swapBaseAmount),
    creatorBase, ncBase, ncFees,
  };
}
