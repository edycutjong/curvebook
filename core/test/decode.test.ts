import { describe, expect, it } from "vitest";
import { decodeTx, decodeEventData, instructionName, EVENT_IX_TAG } from "../src/index.js";
import { fixture } from "./helpers.js";

describe("decodeTx on real mainnet transactions", () => {
  it("decodes EvtInitializePool and the bundled creator buy in the same tx", () => {
    const evs = decodeTx(fixture("init"));
    const init = evs.find((e) => e.kind === "init")!;
    const swap = evs.find((e) => e.kind === "swap")!;
    expect(init).toMatchObject({ pool: "5fSvenHfQ4C5r81EoGxEbiL5ufBYjWV3VHJyH3U9o3qi", config: "3yFxSqnZHrJZYhLpvTCHht6i1kyEDnckLj1yJixhb5US", creator: "A7FPAkrrwqycx6wZ3VCbcKHiiWMcyiNDY82YkHf9S5k6" });
    expect(swap.kind === "swap" && swap.payer).toBe(init.kind === "init" && init.creator);
    expect(swap.slot).toBe(init.slot);
  });

  it("counts EvtSwap2 only, never the legacy EvtSwap twin", () => {
    expect(decodeTx(fixture("init")).filter((e) => e.kind === "swap")).toHaveLength(1);
  });

  it("pairs a direct swap with its fee payer", () => {
    const tx = fixture("swap-direct");
    const s = decodeTx(tx).find((e) => e.kind === "swap");
    const signer = tx.transaction.message.accountKeys[0];
    expect(s).toMatchObject({ payer: signer, viaCpi: false });
  });

  it("pairs a CPI-routed buy (v1 transaction) with the payer of the inner DBC swap", () => {
    const tx = fixture("swap-cpi");
    const s = decodeTx(tx).find((e) => e.kind === "swap");
    expect(s).toMatchObject({ payer: tx.transaction.message.accountKeys[0], viaCpi: true, tradeDirection: 1 });
  });

  it("decodes EvtCurveComplete", () => {
    const c = decodeTx(fixture("complete")).find((e) => e.kind === "complete");
    expect(c).toMatchObject({ pool: "2XGCagb5yHrD7QfE9P75Wj95HWsiY2eUeVQ83X9wbEdt" });
  });

  it("returns nothing for a failed transaction", () => {
    const tx = fixture("swap-direct");
    expect(decodeTx({ ...tx, meta: { ...tx.meta!, err: { InstructionError: [0, "Custom"] } } })).toEqual([]);
  });

  it("ignores data without the event-CPI tag", () => {
    expect(decodeEventData(Buffer.alloc(32))).toBeNull();
    expect(decodeEventData(Buffer.concat([EVENT_IX_TAG, Buffer.alloc(4)]))).toBeNull();
  });

  it("names DBC instructions by discriminator", () => {
    expect(instructionName(Buffer.from([65, 75, 63, 76, 235, 91, 91, 136]))).toBe("swap2");
  });
});
