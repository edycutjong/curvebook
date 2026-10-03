// Minimal client for the curvebook_router program: PDAs and instruction builders.
import { BorshCoder, type Idl } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID, NATIVE_MINT, TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { deriveDbcTokenVaultAddress } from "@meteora-ag/dynamic-bonding-curve-sdk";
import BN from "bn.js";
import idlJson from "./router-idl.json" with { type: "json" };
import { DBC_PROGRAM_ID } from "./constants.js";

export const ROUTER_PROGRAM_ID = new PublicKey((idlJson as any).address);
const coder = new BorshCoder(idlJson as unknown as Idl);
const DBC = new PublicKey(DBC_PROGRAM_ID);

export const vaultPda = (config: PublicKey, programId = ROUTER_PROGRAM_ID) =>
  PublicKey.findProgramAddressSync([Buffer.from("vault"), config.toBuffer()], programId)[0];
export const presetPda = (config: PublicKey, programId = ROUTER_PROGRAM_ID) =>
  PublicKey.findProgramAddressSync([Buffer.from("preset"), config.toBuffer()], programId)[0];
export const dbcEventAuthority = () => PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], DBC)[0];

/** register_preset: the DBC config keypair co-signs so nobody can front-run the author slot. */
export function registerPresetIx(a: { author: PublicKey; config: PublicKey; authorBps: number; treasury: PublicKey; programId?: PublicKey }) {
  const programId = a.programId ?? ROUTER_PROGRAM_ID;
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: a.author, isSigner: true, isWritable: true },
      { pubkey: a.config, isSigner: true, isWritable: false },
      { pubkey: vaultPda(a.config, programId), isSigner: false, isWritable: false },
      { pubkey: presetPda(a.config, programId), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: coder.instruction.encode("register_preset", { author_bps: a.authorBps, treasury: a.treasury }),
  });
}

/** claim_creation_split: anyone cranks; the pool's creation fee goes author/treasury in one ix. */
export function claimCreationSplitIx(a: { config: PublicKey; pool: PublicKey; author: PublicKey; treasury: PublicKey; programId?: PublicKey }) {
  const programId = a.programId ?? ROUTER_PROGRAM_ID;
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: presetPda(a.config, programId), isSigner: false, isWritable: true },
      { pubkey: a.config, isSigner: false, isWritable: false },
      { pubkey: a.pool, isSigner: false, isWritable: true },
      { pubkey: vaultPda(a.config, programId), isSigner: false, isWritable: true },
      { pubkey: a.author, isSigner: false, isWritable: true },
      { pubkey: a.treasury, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: dbcEventAuthority(), isSigner: false, isWritable: false },
      { pubkey: DBC, isSigner: false, isWritable: false },
    ],
    data: coder.instruction.encode("claim_creation_split", {}),
  });
}

export const DBC_POOL_AUTHORITY = new PublicKey("FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM");

/**
 * claim_trading_split, preceded by the idempotent token-account creations it needs
 * (vault base + wSOL accounts, author and treasury wSOL accounts). Anyone may send it.
 */
export function claimTradingSplitIxs(a: {
  payer: PublicKey; config: PublicKey; pool: PublicKey; baseMint: PublicKey; author: PublicKey; treasury: PublicKey;
  maxQuote: bigint; programId?: PublicKey;
}): TransactionInstruction[] {
  const programId = a.programId ?? ROUTER_PROGRAM_ID;
  const vault = vaultPda(a.config, programId);
  const ata = (mint: PublicKey, owner: PublicKey) => getAssociatedTokenAddressSync(mint, owner, true);
  const atas: [PublicKey, PublicKey][] = [[a.baseMint, vault], [NATIVE_MINT, vault], [NATIVE_MINT, a.author], [NATIVE_MINT, a.treasury]];
  const creates = atas.map(([mint, owner]) => createAssociatedTokenAccountIdempotentInstruction(a.payer, ata(mint, owner), owner, mint));
  const claim = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: presetPda(a.config, programId), isSigner: false, isWritable: true },
      { pubkey: a.config, isSigner: false, isWritable: false },
      { pubkey: a.pool, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: false },
      { pubkey: ata(a.baseMint, vault), isSigner: false, isWritable: true },
      { pubkey: ata(NATIVE_MINT, vault), isSigner: false, isWritable: true },
      { pubkey: ata(NATIVE_MINT, a.author), isSigner: false, isWritable: true },
      { pubkey: ata(NATIVE_MINT, a.treasury), isSigner: false, isWritable: true },
      { pubkey: deriveDbcTokenVaultAddress(a.pool, a.baseMint), isSigner: false, isWritable: true },
      { pubkey: deriveDbcTokenVaultAddress(a.pool, NATIVE_MINT), isSigner: false, isWritable: true },
      { pubkey: a.baseMint, isSigner: false, isWritable: false },
      { pubkey: NATIVE_MINT, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: DBC_POOL_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: dbcEventAuthority(), isSigner: false, isWritable: false },
      { pubkey: DBC, isSigner: false, isWritable: false },
    ],
    data: coder.instruction.encode("claim_trading_split", { max_quote: new BN(a.maxQuote.toString()) }),
  });
  return [...creates, claim];
}

export type PresetAccount = {
  author: string; dbcConfig: string; authorBps: number; treasury: string; quoteMint: string;
  launchesClaimed: bigint; totalSplitQuote: bigint; totalSplitLamports: bigint;
};

export function decodePreset(data: Buffer): PresetAccount {
  const p: any = coder.accounts.decode("Preset", data);
  return {
    author: p.author.toBase58(), dbcConfig: p.dbc_config.toBase58(), authorBps: p.author_bps, treasury: p.treasury.toBase58(),
    quoteMint: p.quote_mint.toBase58(), launchesClaimed: BigInt(p.launches_claimed.toString()),
    totalSplitQuote: BigInt(p.total_split_quote.toString()), totalSplitLamports: BigInt(p.total_split_lamports.toString()),
  };
}
