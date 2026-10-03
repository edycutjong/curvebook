// Derived rows for the launch receipt. Pure.
import { WSOL_MINT } from "./constants";
import { atoms, short } from "./format";

export type ReceiptBuy = {
  sig: string;
  idx: number;
  slot_offset: number;
  payer: string | null;
  is_creator: boolean;
  via_cpi: boolean;
  quote_in: string;
  base_out: string;
  confirmed: boolean;
};

export type BuyLine = {
  key: string;
  offset: number;
  wallet: string;
  quoteIn: string;
  share: number | null;
  who: "creator" | "outside";
  viaCpi: boolean;
  confirmed: boolean;
  sig: string;
};

export function buyLines(buys: readonly ReceiptBuy[], quoteMint: string | null, swapBaseAmount: string | null): BuyLine[] {
  const denom = Number(swapBaseAmount ?? 0);
  const isSol = quoteMint === WSOL_MINT;
  return [...buys]
    .sort((a, b) => a.slot_offset - b.slot_offset || a.sig.localeCompare(b.sig) || a.idx - b.idx)
    .map((b) => ({
      key: `${b.sig}:${b.idx}`,
      offset: b.slot_offset,
      wallet: b.payer ? short(b.payer) : "unpaired",
      quoteIn: isSol ? `${atoms(b.quote_in, 9)} SOL` : `${b.quote_in} atoms`,
      share: denom > 0 ? Number(b.base_out) / denom : null,
      who: b.is_creator ? "creator" : "outside",
      viaCpi: b.via_cpi,
      confirmed: b.confirmed,
      sig: b.sig,
    }));
}
