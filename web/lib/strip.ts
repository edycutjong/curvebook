// The 10-slot strip's scaling and labelling. Pure so it is unit-tested.
import { WINDOW_SLOTS } from "./constants";

/** A slot where outside wallets took this share of the curve reads as a full red cell. */
export const FULL_CELL_SHARE = 0.05;
/** Any nonzero outside buy stays visible, however small. */
export const MIN_VISIBLE_FILL = 0.2;

export type CellState = "sniped" | "held" | "open";

export function cellFill(share: number): number {
  if (!(share > 0)) return 0;
  return Math.min(1, Math.max(MIN_VISIBLE_FILL, share / FULL_CELL_SHARE));
}

/** Red if outsiders bought; a green tick only once the window is final; hollow while live. */
export function cellState(share: number, final: boolean): CellState {
  if (share > 0) return "sniped";
  return final ? "held" : "open";
}

export function cellLabel(offset: number, share: number, final: boolean): string {
  const p = share * 100;
  const exact = p === 0 ? "0%" : p < 0.001 ? `${p.toExponential(2)}%` : `${p.toFixed(3).replace(/\.?0+$/, "")}%`;
  if (share > 0) return `slot ${offset}: ${exact} of curve bought by non-creator wallets`;
  return final ? `slot ${offset}: no non-creator buys` : `slot ${offset}: no non-creator buys seen yet`;
}

/** Pads or trims to exactly WINDOW_SLOTS cells. */
export const normalizeStrip = (shares: readonly number[] | null | undefined): number[] =>
  Array.from({ length: WINDOW_SLOTS }, (_, i) => Number(shares?.[i] ?? 0) || 0);

export type StripBuy = { slot_offset: number; is_creator: boolean; base_out: string };

/** Per-slot non-creator share of sellable supply, from raw window buys (the live receipt). */
export function perSlotFromBuys(buys: readonly StripBuy[], swapBaseAmount: string | null): number[] {
  const out = new Array<number>(WINDOW_SLOTS).fill(0);
  const denom = Number(swapBaseAmount ?? 0);
  if (!(denom > 0)) return out;
  for (const b of buys) {
    if (b.is_creator || b.slot_offset < 0 || b.slot_offset >= WINDOW_SLOTS) continue;
    out[b.slot_offset] += Number(b.base_out) / denom;
  }
  return out;
}
