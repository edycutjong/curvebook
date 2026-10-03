// Permission boundary and defect-named regressions for the worker.
import { describe, expect, it } from "vitest";
import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { land, LandError } from "../src/lander.js";
import { toJson } from "../src/json.js";

const signedTx = () => {
  const payer = Keypair.generate();
  const tx = new VersionedTransaction(new TransactionMessage({
    payerKey: payer.publicKey, recentBlockhash: "11111111111111111111111111111111",
    instructions: [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 })],
  }).compileToV0Message());
  tx.sign([payer]);
  return Buffer.from(tx.serialize()).toString("base64");
};

describe("relay boundary: /beam is not an open relay on our landing key", () => {
  it("refuses a validly signed transaction it never issued, before touching RPC or Beam", async () => {
    const rpcCalls: string[] = [];
    let beamed = false;
    const sql: any = async () => []; // no issued_tx row matches
    const rpc: any = { call: async (m: string) => { rpcCalls.push(m); return {}; } };
    const err = await land({ sql, rpc, indexer: {} as any, beam: async () => { beamed = true; return ""; }, ownWallets: new Set(), txBase64: signedTx() }).catch((e) => e);
    expect(err).toBeInstanceOf(LandError);
    expect(err.status).toBe(403);
    expect(rpcCalls).toEqual([]);
    expect(beamed).toBe(false);
  });
});

describe("regressions", () => {
  it("health_json_serializes_postgres_bigint_instead_of_crashing_the_worker", () => {
    // 2026-10-04: GET /health threw "Do not know how to serialize a BigInt" and the double
    // header write took the indexer down with it.
    expect(toJson({ pools_seen: 38n, lag: 0 })).toBe('{"pools_seen":"38","lag":0}');
  });
});
