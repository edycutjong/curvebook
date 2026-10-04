import { describe, expect, it } from "vitest";
import bs58 from "bs58";
import { decodeTx, decodeEventData, decodeMigrations, instructionName, EVENT_IX_TAG, DBC_PROGRAM_ID, type RawTx } from "../src/index.js";

// Real EvtSwap2 event-CPI payload (discriminator + borsh body) lifted verbatim from
// test/fixtures/swap-direct.json's inner instruction #3.3 — same bytes the existing
// decode.test.ts decodes, reused here so we exercise genuine borsh decoding instead of
// hand-rolled data.
const REAL_EVT_SWAP2_DATA =
  "44FY2SKwMbUFWgV1yoKm6d2KQarbvMKzvxGioooLLK6mEMXkkLbLpcWYDkbDNvqNwTfVSgfGdHMNTNGiaX1UvrJEozcfXyombGpESp4n8hLoxdr1Auci4K2nAiGsJrK5NmSPtD1teRPTjU5GcSRS53an7bbQ1o3dez6WsBdAcXcJoXcGAJ6Eua3yfAhLmg32vgVsbPZkcB2GER221V5yHvJMULo7C8jhYSzF97c9kqE7gjptnzQr1b3P2S8ea21CHZJW67KnkwH";

// Expected decoded field values for REAL_EVT_SWAP2_DATA, confirmed against the full
// swap-direct.json fixture via decodeTx (see decode.test.ts for the same signature).
const EXPECTED_SWAP_FIELDS = {
  pool: "85S15c2SFeKHUBNWQcXDDXCikqwXvtLizjpVpoECuPac",
  config: "2bFH5q216w51UopEZP359NGGSUUeCwmycoBzP8Jc83at",
  tradeDirection: 0,
  output: 180556146n,
};

const EVT_SWAP2_DISC = [189, 66, 51, 168, 38, 80, 117, 153];
const MIGRATION_DAMM_V2_DISC = [156, 169, 230, 103, 53, 228, 80, 64];
const MIGRATE_METEORA_DAMM_DISC = [27, 1, 48, 22, 180, 63, 118, 217];
const SWAP2_IX_DISC = [65, 75, 63, 76, 235, 91, 91, 136];

describe("decodeEventData", () => {
  it("returns null when a known event discriminator is followed by a payload too short to borsh-decode", () => {
    // Length is >= 16 and the EVENT_IX_TAG matches, so it reaches the try block; the
    // layout decode for EvtSwap2 then throws on the truncated body and is caught.
    const data = Buffer.concat([EVENT_IX_TAG, Buffer.from(EVT_SWAP2_DISC)]);
    expect(data.length).toBeGreaterThanOrEqual(16);
    expect(decodeEventData(data)).toBeNull();
  });
});

describe("instructionName", () => {
  it("returns null for a discriminator that matches no DBC instruction", () => {
    expect(instructionName(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
  });
});

describe("decodeTx: event-CPI emitted as the top-level instruction with no inner instructions", () => {
  // This single synthetic transaction, built from the real swap-direct EvtSwap2 bytes,
  // simultaneously exercises: accountKeys entries given as {pubkey} objects instead of
  // plain strings, a missing `meta.innerInstructions` (defaults to []), a missing
  // top-level `stackHeight` (defaults to 1), a missing `blockTime` (defaults to null),
  // and an event with no preceding instruction at all (findParentSwap's eventIdx === 0
  // fallthrough, so payer/viaCpi fall back to their defaults).
  const keys = [
    { pubkey: "68hEaXKm4MJCvRPYEAs3VAskmBRASXvhT76HtWAdZVvz" }, // object form
    "CVwWTyaJKU6YhSdrRfDLU13EZZcjcbHY9dLF7N4Muc3u",
    "CCNx4soFS7EV36xEW45JYF7pzHrfkvWpDuHhAQVBc8eC",
    "85S15c2SFeKHUBNWQcXDDXCikqwXvtLizjpVpoECuPac",
    "Fu1uoSb6fT1FTxkaB17KTm7hPFpwaASoGHuyW8qmquRN",
    "Df2FeWqi6FhXNntbNRShCMp4qtBE2uT8Y5kropvn6x2w",
    "ComputeBudget111111111111111111111111111111",
    "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
    "6HKVur5PE4yv8ZDCrxoHtLrFcE6RqQUgkWuDKMKfj7qg",
    "11111111111111111111111111111111",
    "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    "So11111111111111111111111111111111111111112",
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    DBC_PROGRAM_ID,
    "FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM",
    "2bFH5q216w51UopEZP359NGGSUUeCwmycoBzP8Jc83at",
    "8Ks12pbrD6PXxfty1hVQiE9sc289zgU1zHkvXhrSdriF",
  ];

  const tx: RawTx = {
    slot: 999,
    meta: { err: null },
    transaction: {
      signatures: ["synthetic-orphan-sig"],
      message: {
        accountKeys: keys as any,
        instructions: [{ programIdIndex: 13, accounts: [16], data: REAL_EVT_SWAP2_DATA }],
      },
    },
  };

  it("still decodes the real swap fields correctly", () => {
    const swap = decodeTx(tx).find((e) => e.kind === "swap");
    expect(swap).toMatchObject(EXPECTED_SWAP_FIELDS);
  });

  it("defaults payer to null and viaCpi to false when no parent instruction exists", () => {
    const swap = decodeTx(tx).find((e) => e.kind === "swap");
    expect(swap).toMatchObject({ payer: null, viaCpi: false });
  });

  it("defaults blockTime to null when the transaction omits it", () => {
    const swap = decodeTx(tx).find((e) => e.kind === "swap");
    expect(swap?.blockTime).toBeNull();
  });
});

describe("findParentSwap (exercised via decodeTx)", () => {
  const noopKeys = [
    "ComputeBudget111111111111111111111111111111", // 0: unrelated top-level program
    DBC_PROGRAM_ID, // 1
    "11111111111111111111111111111111", // 2: a non-DBC program
    "8Ks12pbrD6PXxfty1hVQiE9sc289zgU1zHkvXhrSdriF", // 3: event authority account
  ];

  function txWithPreceding(precedingIx: RawTx["transaction"]["message"]["instructions"][number], eventStackHeight: number): RawTx {
    return {
      slot: 1,
      meta: {
        err: null,
        innerInstructions: [
          {
            index: 0,
            instructions: [precedingIx, { programIdIndex: 1, accounts: [3], data: REAL_EVT_SWAP2_DATA, stackHeight: eventStackHeight }],
          },
        ],
      },
      transaction: {
        signatures: ["sig"],
        message: { accountKeys: noopKeys, instructions: [{ programIdIndex: 0, accounts: [], data: "11", stackHeight: 1 }] },
      },
    };
  }

  it("treats a stack-height gap greater than one as having no parent", () => {
    // Event is 2 levels deeper than the nearest shallower instruction (gap of 2, not 1).
    const tx = txWithPreceding({ programIdIndex: 1, accounts: [], data: "11", stackHeight: 1 }, 3);
    const swap = decodeTx(tx).find((e) => e.kind === "swap");
    expect(swap).toMatchObject({ payer: null, viaCpi: false });
  });

  it("treats a non-DBC instruction one level up as having no parent", () => {
    const tx = txWithPreceding({ programIdIndex: 2, accounts: [], data: "11", stackHeight: 1 }, 2);
    const swap = decodeTx(tx).find((e) => e.kind === "swap");
    expect(swap).toMatchObject({ payer: null, viaCpi: false });
  });

  it("treats a recognized but non-swap DBC instruction one level up as having no parent", () => {
    const tx = txWithPreceding({ programIdIndex: 1, accounts: [], data: bs58.encode(Buffer.from(MIGRATE_METEORA_DAMM_DISC)), stackHeight: 1 }, 2);
    const swap = decodeTx(tx).find((e) => e.kind === "swap");
    expect(swap).toMatchObject({ payer: null, viaCpi: false });
  });

  it("treats an unrecognized DBC instruction one level up as having no parent", () => {
    const tx = txWithPreceding({ programIdIndex: 1, accounts: [], data: bs58.encode(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])), stackHeight: 1 }, 2);
    const swap = decodeTx(tx).find((e) => e.kind === "swap");
    expect(swap).toMatchObject({ payer: null, viaCpi: false });
  });
});

describe("decodeMigrations", () => {
  const migKeys = [DBC_PROGRAM_ID, "VPOOL_X", "META_X", "CONFIG_X", "11111111111111111111111111111111"];

  function migTx(instructions: RawTx["transaction"]["message"]["instructions"]): RawTx {
    return {
      slot: 42,
      blockTime: 123,
      meta: { err: null },
      transaction: { signatures: ["sig-mig"], message: { accountKeys: migKeys, instructions } },
    };
  }

  it("returns [] for a failed transaction", () => {
    const tx = migTx([{ programIdIndex: 0, accounts: [1, 2, 3], data: bs58.encode(Buffer.from(MIGRATION_DAMM_V2_DISC)), stackHeight: 1 }]);
    tx.meta = { ...tx.meta!, err: { InstructionError: [0, "Custom"] } };
    expect(decodeMigrations(tx)).toEqual([]);
  });

  it("extracts virtual_pool and config from a migration_damm_v2 instruction", () => {
    const tx = migTx([{ programIdIndex: 0, accounts: [1, 2, 3], data: bs58.encode(Buffer.from(MIGRATION_DAMM_V2_DISC)), stackHeight: 1 }]);
    expect(decodeMigrations(tx)).toMatchObject([{ kind: "migration", sig: "sig-mig", slot: 42, blockTime: 123, pool: "VPOOL_X", config: "CONFIG_X" }]);
  });

  it("also extracts virtual_pool and config from the legacy migrate_meteora_damm instruction name", () => {
    const tx = migTx([{ programIdIndex: 0, accounts: [1, 2, 3], data: bs58.encode(Buffer.from(MIGRATE_METEORA_DAMM_DISC)), stackHeight: 1 }]);
    expect(decodeMigrations(tx)).toMatchObject([{ kind: "migration", pool: "VPOOL_X", config: "CONFIG_X" }]);
  });

  it("ignores a DBC instruction that isn't a migration and instructions from other programs", () => {
    const tx = migTx([
      { programIdIndex: 0, accounts: [1, 2, 3], data: bs58.encode(Buffer.from(SWAP2_IX_DISC)), stackHeight: 1 }, // DBC, but swap2 not a migration
      { programIdIndex: 4, accounts: [], data: "11", stackHeight: 1 }, // not DBC at all
    ]);
    expect(decodeMigrations(tx)).toEqual([]);
  });

  it("defaults blockTime to null when the transaction omits it", () => {
    const tx = migTx([{ programIdIndex: 0, accounts: [1, 2, 3], data: bs58.encode(Buffer.from(MIGRATION_DAMM_V2_DISC)), stackHeight: 1 }]);
    delete (tx as any).blockTime;
    expect(decodeMigrations(tx)[0]).toMatchObject({ blockTime: null });
  });
});
