import { describe, expect, it } from "vitest";
import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { launchMessageHash } from "@curvebook/core";
import { explainSimError, messageHash } from "../src/lander.js";

describe("relay guard hash (D3)", () => {
  it("the worker and buildLaunchTx hash the same message identically, before and after signing", () => {
    const payer = Keypair.generate();
    const msg = new TransactionMessage({
      payerKey: payer.publicKey, recentBlockhash: "11111111111111111111111111111111",
      instructions: [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: payer.publicKey, lamports: 1 })],
    }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    const issued = launchMessageHash(tx);
    tx.sign([payer]);
    const relayed = VersionedTransaction.deserialize(tx.serialize());
    expect(messageHash(relayed.message.serialize())).toBe(issued);
  });
});

describe("explainSimError", () => {
  it("names an empty wallet", () => {
    expect(explainSimError({}, ["Transfer: insufficient lamports 1, need 2"])).toMatch(/enough SOL/);
  });
  it("names slippage on the first buy", () => {
    expect(explainSimError({}, ["Program log: AnchorError ... Error Code: ExceededSlippage. Error Number: 6000. Error Message: Exceeded slippage tolerance."])).toMatch(/minimum/);
  });
  it("passes through a DBC anchor error", () => {
    expect(explainSimError({}, ["Error Code: PoolIsCompleted. Error Number: 6010. Error Message: Pool is completed."])).toBe("DBC rejected it: PoolIsCompleted (Pool is completed.)");
  });
});
