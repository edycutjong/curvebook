import { readFileSync } from "node:fs";
import bs58 from "bs58";
import { describe, expect, it } from "vitest";
import { decodeTx, type RawTx } from "@curvebook/core";
import { yellowstoneToRawTx } from "../src/sources/grpc.js";

const fx = (n: string): RawTx => JSON.parse(readFileSync(new URL(`../../core/test/fixtures/${n}.json`, import.meta.url), "utf8"));
const bytes = (s: string) => bs58.decode(s);

/** Re-encode a getTransaction fixture the way Yellowstone delivers it (raw bytes, loaded addresses split). */
function asYellowstone(tx: RawTx) {
  return {
    transaction: {
      slot: String(tx.slot),
      transaction: {
        transaction: {
          signatures: tx.transaction.signatures.map(bytes),
          message: {
            accountKeys: tx.transaction.message.accountKeys.map((k) => bytes(typeof k === "string" ? k : k.pubkey)),
            instructions: tx.transaction.message.instructions.map((i) => ({ programIdIndex: i.programIdIndex, accounts: Uint8Array.from(i.accounts), data: bytes(i.data) })),
          },
        },
        meta: {
          err: tx.meta!.err,
          loadedWritableAddresses: (tx.meta!.loadedAddresses?.writable ?? []).map(bytes),
          loadedReadonlyAddresses: (tx.meta!.loadedAddresses?.readonly ?? []).map(bytes),
          innerInstructions: (tx.meta!.innerInstructions ?? []).map((g) => ({
            index: g.index,
            instructions: g.instructions.map((i) => ({ programIdIndex: i.programIdIndex, accounts: Uint8Array.from(i.accounts), data: bytes(i.data), stackHeight: i.stackHeight })),
          })),
        },
      },
    },
  };
}

const strip = (evs: any[]) => evs.map(({ blockTime, ...e }) => e);

describe("yellowstoneToRawTx", () => {
  for (const name of ["init", "swap-direct", "swap-cpi", "complete"]) {
    it(`decodes the same events from the gRPC shape as from getTransaction (${name})`, () => {
      const tx = fx(name);
      expect(strip(decodeTx(yellowstoneToRawTx(asYellowstone(tx))!))).toEqual(strip(decodeTx(tx)));
    });
  }
  it("ignores updates without a transaction", () => {
    expect(yellowstoneToRawTx({ slot: { slot: "1" } })).toBeNull();
  });
});
