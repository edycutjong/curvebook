import { describe, expect, it } from "vitest";
import { buyLines, type ReceiptBuy } from "@/lib/receipt";
import { WSOL_MINT } from "@/lib/constants";

describe("buyLines - coverage gaps", () => {
  it("handles non-SOL quoteMint (atoms display)", () => {
    const buys: ReceiptBuy[] = [
      {
        sig: "abc",
        idx: 0,
        slot_offset: 0,
        payer: "11111111111111111111111111111111",
        is_creator: false,
        via_cpi: false,
        quote_in: "1000000",
        base_out: "500",
        confirmed: true,
      },
    ];
    const lines = buyLines(buys, "EPjFWaLb3odcccccccccccccccccccccccccccccccc", "10000");
    expect(lines[0].quoteIn).toBe("1000000 atoms"); // not SOL
  });

  it("handles null quoteMint", () => {
    const buys: ReceiptBuy[] = [
      {
        sig: "abc",
        idx: 0,
        slot_offset: 0,
        payer: "11111111111111111111111111111111",
        is_creator: false,
        via_cpi: false,
        quote_in: "1000000",
        base_out: "500",
        confirmed: true,
      },
    ];
    const lines = buyLines(buys, null, "10000");
    expect(lines[0].quoteIn).toBe("1000000 atoms"); // not SOL
  });

  it("handles unpaired payer (null payer)", () => {
    const buys: ReceiptBuy[] = [
      {
        sig: "abc",
        idx: 0,
        slot_offset: 0,
        payer: null,
        is_creator: false,
        via_cpi: false,
        quote_in: "1000000",
        base_out: "500",
        confirmed: true,
      },
    ];
    const lines = buyLines(buys, WSOL_MINT, "10000");
    expect(lines[0].wallet).toBe("unpaired");
  });

  it("handles null swapBaseAmount (denom = 0, share = null)", () => {
    const buys: ReceiptBuy[] = [
      {
        sig: "abc",
        idx: 0,
        slot_offset: 0,
        payer: "11111111111111111111111111111111",
        is_creator: false,
        via_cpi: false,
        quote_in: "1000000",
        base_out: "500",
        confirmed: true,
      },
    ];
    const lines = buyLines(buys, WSOL_MINT, null);
    expect(lines[0].share).toBeNull(); // denom = 0, so share = null
  });

  it("handles zero swapBaseAmount (share = null)", () => {
    const buys: ReceiptBuy[] = [
      {
        sig: "abc",
        idx: 0,
        slot_offset: 0,
        payer: "11111111111111111111111111111111",
        is_creator: false,
        via_cpi: false,
        quote_in: "1000000",
        base_out: "500",
        confirmed: true,
      },
    ];
    const lines = buyLines(buys, WSOL_MINT, "0");
    expect(lines[0].share).toBeNull(); // denom = 0, so share = null
  });

  it("sorts by slot_offset when different", () => {
    const buys: ReceiptBuy[] = [
      {
        sig: "c",
        idx: 0,
        slot_offset: 2,
        payer: null,
        is_creator: false,
        via_cpi: false,
        quote_in: "100",
        base_out: "100",
        confirmed: true,
      },
      {
        sig: "a",
        idx: 0,
        slot_offset: 0,
        payer: null,
        is_creator: false,
        via_cpi: false,
        quote_in: "100",
        base_out: "100",
        confirmed: true,
      },
      {
        sig: "b",
        idx: 0,
        slot_offset: 1,
        payer: null,
        is_creator: false,
        via_cpi: false,
        quote_in: "100",
        base_out: "100",
        confirmed: true,
      },
    ];
    const lines = buyLines(buys, WSOL_MINT, "1000");
    expect(lines.map((l) => l.offset)).toEqual([0, 1, 2]);
  });

  it("sorts by sig.localeCompare when slot_offset is same", () => {
    const buys: ReceiptBuy[] = [
      {
        sig: "zebra",
        idx: 0,
        slot_offset: 0,
        payer: null,
        is_creator: false,
        via_cpi: false,
        quote_in: "100",
        base_out: "100",
        confirmed: true,
      },
      {
        sig: "apple",
        idx: 0,
        slot_offset: 0,
        payer: null,
        is_creator: false,
        via_cpi: false,
        quote_in: "100",
        base_out: "100",
        confirmed: true,
      },
      {
        sig: "mango",
        idx: 0,
        slot_offset: 0,
        payer: null,
        is_creator: false,
        via_cpi: false,
        quote_in: "100",
        base_out: "100",
        confirmed: true,
      },
    ];
    const lines = buyLines(buys, WSOL_MINT, "1000");
    expect(lines.map((l) => l.sig)).toEqual(["apple", "mango", "zebra"]);
  });

  it("sorts by idx when slot_offset and sig are same", () => {
    const buys: ReceiptBuy[] = [
      {
        sig: "same",
        idx: 2,
        slot_offset: 0,
        payer: null,
        is_creator: false,
        via_cpi: false,
        quote_in: "100",
        base_out: "100",
        confirmed: true,
      },
      {
        sig: "same",
        idx: 0,
        slot_offset: 0,
        payer: null,
        is_creator: false,
        via_cpi: false,
        quote_in: "100",
        base_out: "100",
        confirmed: true,
      },
      {
        sig: "same",
        idx: 1,
        slot_offset: 0,
        payer: null,
        is_creator: false,
        via_cpi: false,
        quote_in: "100",
        base_out: "100",
        confirmed: true,
      },
    ];
    const lines = buyLines(buys, WSOL_MINT, "1000");
    expect(lines.map((l) => l.key)).toEqual(["same:0", "same:1", "same:2"]);
  });

  it("sets viaCpi correctly", () => {
    const buys: ReceiptBuy[] = [
      {
        sig: "a",
        idx: 0,
        slot_offset: 0,
        payer: null,
        is_creator: false,
        via_cpi: true,
        quote_in: "100",
        base_out: "100",
        confirmed: true,
      },
      {
        sig: "b",
        idx: 0,
        slot_offset: 0,
        payer: null,
        is_creator: false,
        via_cpi: false,
        quote_in: "100",
        base_out: "100",
        confirmed: true,
      },
    ];
    const lines = buyLines(buys, WSOL_MINT, "1000");
    expect(lines[0].viaCpi).toBe(true);
    expect(lines[1].viaCpi).toBe(false);
  });

  it("sets confirmed correctly", () => {
    const buys: ReceiptBuy[] = [
      {
        sig: "a",
        idx: 0,
        slot_offset: 0,
        payer: null,
        is_creator: false,
        via_cpi: false,
        quote_in: "100",
        base_out: "100",
        confirmed: true,
      },
      {
        sig: "b",
        idx: 0,
        slot_offset: 0,
        payer: null,
        is_creator: false,
        via_cpi: false,
        quote_in: "100",
        base_out: "100",
        confirmed: false,
      },
    ];
    const lines = buyLines(buys, WSOL_MINT, "1000");
    expect(lines[0].confirmed).toBe(true);
    expect(lines[1].confirmed).toBe(false);
  });

  it("computes share correctly when denom > 0", () => {
    const buys: ReceiptBuy[] = [
      {
        sig: "a",
        idx: 0,
        slot_offset: 0,
        payer: null,
        is_creator: false,
        via_cpi: false,
        quote_in: "100",
        base_out: "250",
        confirmed: true,
      },
    ];
    const lines = buyLines(buys, WSOL_MINT, "1000");
    expect(lines[0].share).toBe(0.25); // 250 / 1000
  });

  it("handles empty buys array", () => {
    const lines = buyLines([], WSOL_MINT, "1000");
    expect(lines).toEqual([]);
  });
});
