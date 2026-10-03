// Shared by deploy-presets.ts (mainnet) and rehearse-localnet.ts.
import { readFileSync } from "node:fs";
import { ComputeBudgetProgram, Keypair, PublicKey, Transaction, sendAndConfirmTransaction, type Connection } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { PRESETS, registerPresetIx, vaultPda, type PresetDef } from "@curvebook/core";

export const loadKeypair = (path: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));

export async function send(conn: Connection, tx: Transaction, signers: Keypair[]) {
  return sendAndConfirmTransaction(conn, tx, signers, { commitment: "confirmed" });
}

export type DeployedPreset = { slug: string; name: string; builder: string; summary: string; config: string; vault: string; sigs: string[] };

/**
 * create_config (fee_claimer = router vault PDA), then register_preset. One transaction when it fits;
 * a 16-segment curve does not, so register follows in a second one. Both are signed by the config
 * keypair, which only we hold, so nobody can take the author slot in between.
 */
export async function deployPreset(conn: Connection, payer: Keypair, def: PresetDef, treasury: PublicKey, authorBps: number): Promise<DeployedPreset> {
  const dbc = new DynamicBondingCurveClient(conn, "confirmed");
  const config = Keypair.generate();
  const vault = vaultPda(config.publicKey);
  const create = await dbc.partner.createConfig({
    config: config.publicKey,
    feeClaimer: vault,
    leftoverReceiver: treasury,
    quoteMint: NATIVE_MINT,
    payer: payer.publicKey,
    ...def.params(),
  });
  const register = registerPresetIx({ author: payer.publicKey, config: config.publicKey, authorBps, treasury });
  const one = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...create.instructions, register);
  one.feePayer = payer.publicKey;
  one.recentBlockhash = PublicKey.default.toBase58();
  let sigs: string[];
  if (one.serializeMessage().length + 1 + 64 * 2 <= 1232) {
    sigs = [await send(conn, one, [payer, config])];
  } else {
    sigs = [
      await send(conn, new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...create.instructions), [payer, config]),
      await send(conn, new Transaction().add(register), [payer, config]),
    ];
  }
  return { slug: def.slug, name: def.name, builder: def.builder, summary: def.summary, config: config.publicKey.toBase58(), vault: vault.toBase58(), sigs };
}

export const deployAll = async (conn: Connection, payer: Keypair, treasury: PublicKey, authorBps: number) => {
  const out: DeployedPreset[] = [];
  for (const def of PRESETS) out.push(await deployPreset(conn, payer, def, treasury, authorBps));
  return out;
};
