// Branches vitest 4's stricter coverage found uncovered; each pins a behavior worth keeping.
import { describe, expect, it } from "vitest";
import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { land } from "../src/lander.js";
import { Indexer } from "../src/indexer.js";

describe("lander", () => {
  it("a_failed_resend_does_not_abort_landing_when_the_tx_confirms_on_a_later_poll", async () => {
    const payer = Keypair.generate();
    const tx = new VersionedTransaction(new TransactionMessage({
      payerKey: payer.publicKey, recentBlockhash: "11111111111111111111111111111111",
      instructions: [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: payer.publicKey, lamports: 1 })],
    }).compileToV0Message());
    tx.sign([payer]);
    const issued = { preset: "P", wallet: payer.publicKey.toBase58(), pool: "POOL", base_mint: "M", last_valid_block_height: 100 };
    const sql: any = Object.assign(async (strings: TemplateStringsArray) => (strings.join("").includes("delete from issued_tx") ? [issued] : []), { json: (v: unknown) => v });
    const statuses = [null, null, { slot: 77, confirmationStatus: "confirmed", err: null }];
    const rpc: any = {
      call: async (m: string) => (m === "simulateTransaction" ? { value: { err: null } } : m === "getSignatureStatuses" ? { value: [statuses.shift()] } : m === "getBlockHeight" ? 1 : null),
      getTransaction: async () => null,
    };
    let beams = 0;
    const beam = async () => { if (++beams > 1) throw new Error("QUIC stream reset"); return "sig"; };
    const r = await land({ sql, rpc, indexer: { onTx: async () => {}, watch: () => {} } as any, beam, ownWallets: new Set(), txBase64: Buffer.from(tx.serialize()).toString("base64"), timeoutMs: 10_000 });
    expect(beams).toBe(2); // the resend was attempted and failed
    expect(r.landedSlot).toBe(77);
  }, 15_000);
});

describe("indexer", () => {
  it("an_out_of_order_older_transaction_never_moves_lastSlot_backwards", async () => {
    const sql: any = Object.assign(async () => [], { json: (v: unknown) => v });
    const ix = new Indexer(sql, {} as any, "grpc", () => {});
    ix.lastSlot = 500;
    await ix.onTx({ slot: 450, blockTime: null, meta: { err: null }, transaction: { signatures: ["s"], message: { accountKeys: [], instructions: [] } } });
    expect(ix.lastSlot).toBe(500);
  });
});
