import { describe, expect, it } from "vitest";
import { buyLines } from "@/lib/receipt";
import { WSOL_MINT } from "@/lib/constants";

describe("buyLines", () => {
  it("orders by slot and derives SOL in and share of curve", () => {
    const lines = buyLines(
      [
        { sig: "b", idx: 0, slot_offset: 1, payer: "CnURZN7Wmkrfj2noxZTuHbZAxyfsmoMBaunmmu9FAGC8", is_creator: false, via_cpi: true, quote_in: "41589093", base_out: "250", confirmed: true },
        { sig: "a", idx: 0, slot_offset: 0, payer: null, is_creator: true, via_cpi: false, quote_in: "1000000000", base_out: "100", confirmed: true },
      ],
      WSOL_MINT,
      "1000",
    );
    expect(lines.map((l) => l.offset)).toEqual([0, 1]);
    expect(lines[0]).toMatchObject({ wallet: "unpaired", quoteIn: "1 SOL", share: 0.1, who: "creator" });
    expect(lines[1]).toMatchObject({ wallet: "CnUR…AGC8", quoteIn: "0.0415 SOL", share: 0.25, who: "outside", viaCpi: true });
  });
});
