import { describe, it, expect } from "vitest";
import { BorshCoder, type Idl } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, type TransactionInstruction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID, NATIVE_MINT, TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { deriveDbcTokenVaultAddress } from "@meteora-ag/dynamic-bonding-curve-sdk";
import BN from "bn.js";
import idlJson from "../src/router-idl.json" with { type: "json" };
import {
  ROUTER_PROGRAM_ID, DBC_POOL_AUTHORITY, vaultPda, presetPda, dbcEventAuthority,
  registerPresetIx, claimCreationSplitIx, claimTradingSplitIxs, decodePreset,
} from "../src/index.js";
import { DBC_PROGRAM_ID } from "../src/constants.js";

// Independent coder built straight from the IDL file — never the module-private one in router.ts —
// so these tests pin router.ts's output against the IDL itself, not against its own implementation.
const idl = idlJson as unknown as Idl;
const coder = new BorshCoder(idl);
const DBC = new PublicKey(DBC_PROGRAM_ID);

const ixByName = (name: string) => (idl as any).instructions.find((i: any) => i.name === name);
const discOf = (name: string) => Buffer.from(ixByName(name).discriminator as number[]);

/** Account flags (signer/writable) for one IDL instruction, in listed order. */
const idlFlags = (name: string) =>
  ixByName(name).accounts.map((acc: any) => ({ name: acc.name, isSigner: !!acc.signer, isWritable: !!acc.writable }));

function expectKeysMatchIdl(ixName: string, keys: TransactionInstruction["keys"]) {
  const flags = idlFlags(ixName);
  expect(keys).toHaveLength(flags.length);
  flags.forEach((f: { name: string; isSigner: boolean; isWritable: boolean }, i: number) => {
    expect([keys[i].isSigner, keys[i].isWritable], `account[${i}] (${f.name})`).toEqual([f.isSigner, f.isWritable]);
  });
}

function expectInstructionsEqual(a: TransactionInstruction, b: TransactionInstruction) {
  expect(a.programId.equals(b.programId)).toBe(true);
  expect(a.data.equals(b.data)).toBe(true);
  expect(a.keys).toHaveLength(b.keys.length);
  a.keys.forEach((k, i) => {
    expect(k.pubkey.equals(b.keys[i].pubkey)).toBe(true);
    expect(k.isSigner).toBe(b.keys[i].isSigner);
    expect(k.isWritable).toBe(b.keys[i].isWritable);
  });
}

describe("PDA helpers", () => {
  const config = PublicKey.unique();

  it("vaultPda derives from [\"vault\", config] under the default router program", () => {
    const expected = PublicKey.findProgramAddressSync([Buffer.from("vault"), config.toBuffer()], ROUTER_PROGRAM_ID)[0];
    expect(vaultPda(config).equals(expected)).toBe(true);
  });

  it("vaultPda respects a custom programId", () => {
    const custom = PublicKey.unique();
    const expected = PublicKey.findProgramAddressSync([Buffer.from("vault"), config.toBuffer()], custom)[0];
    const underDefault = vaultPda(config);
    expect(vaultPda(config, custom).equals(expected)).toBe(true);
    expect(vaultPda(config, custom).equals(underDefault)).toBe(false);
  });

  it("presetPda derives from [\"preset\", config] under the default router program", () => {
    const expected = PublicKey.findProgramAddressSync([Buffer.from("preset"), config.toBuffer()], ROUTER_PROGRAM_ID)[0];
    expect(presetPda(config).equals(expected)).toBe(true);
  });

  it("presetPda respects a custom programId", () => {
    const custom = PublicKey.unique();
    const expected = PublicKey.findProgramAddressSync([Buffer.from("preset"), config.toBuffer()], custom)[0];
    expect(presetPda(config, custom).equals(expected)).toBe(true);
  });

  it("dbcEventAuthority derives from [\"__event_authority\"] under the DBC program", () => {
    const expected = PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], DBC)[0];
    expect(dbcEventAuthority().equals(expected)).toBe(true);
  });
});

describe("registerPresetIx", () => {
  const author = PublicKey.unique();
  const config = PublicKey.unique();
  const treasury = PublicKey.unique();
  const authorBps = 1234;

  it("targets the default router program and orders/flags accounts exactly as the IDL lists them", () => {
    const ix = registerPresetIx({ author, config, authorBps, treasury });
    expect(ix.programId.equals(ROUTER_PROGRAM_ID)).toBe(true);
    expectKeysMatchIdl("register_preset", ix.keys);
    expect(ix.keys.map((k) => k.pubkey.toBase58())).toEqual([
      author.toBase58(), config.toBase58(), vaultPda(config).toBase58(), presetPda(config).toBase58(),
      SystemProgram.programId.toBase58(),
    ]);
  });

  it("encodes the 8-byte discriminator from the IDL followed by borsh-encoded args, decodable via BorshCoder", () => {
    const ix = registerPresetIx({ author, config, authorBps, treasury });
    expect(ix.data.subarray(0, 8).equals(discOf("register_preset"))).toBe(true);
    const decoded = coder.instruction.decode(ix.data)!;
    expect(decoded.name).toBe("register_preset");
    expect((decoded.data as any).author_bps).toBe(authorBps);
    expect(((decoded.data as any).treasury as PublicKey).equals(treasury)).toBe(true);
  });

  it("respects a custom programId for both the instruction and its derived PDAs", () => {
    const custom = PublicKey.unique();
    const ix = registerPresetIx({ author, config, authorBps, treasury, programId: custom });
    expect(ix.programId.equals(custom)).toBe(true);
    expect(ix.keys[2].pubkey.equals(vaultPda(config, custom))).toBe(true);
    expect(ix.keys[3].pubkey.equals(presetPda(config, custom))).toBe(true);
    expect(ix.keys[2].pubkey.equals(vaultPda(config))).toBe(false);
  });
});

describe("claimCreationSplitIx", () => {
  const config = PublicKey.unique();
  const pool = PublicKey.unique();
  const author = PublicKey.unique();
  const treasury = PublicKey.unique();

  it("targets the default router program and orders/flags accounts exactly as the IDL lists them", () => {
    const ix = claimCreationSplitIx({ config, pool, author, treasury });
    expect(ix.programId.equals(ROUTER_PROGRAM_ID)).toBe(true);
    expectKeysMatchIdl("claim_creation_split", ix.keys);
    expect(ix.keys.map((k) => k.pubkey.toBase58())).toEqual([
      presetPda(config).toBase58(), config.toBase58(), pool.toBase58(), vaultPda(config).toBase58(),
      author.toBase58(), treasury.toBase58(), SystemProgram.programId.toBase58(),
      dbcEventAuthority().toBase58(), DBC.toBase58(),
    ]);
  });

  it("encodes the 8-byte discriminator from the IDL with no args, decodable via BorshCoder", () => {
    const ix = claimCreationSplitIx({ config, pool, author, treasury });
    expect(ix.data.equals(discOf("claim_creation_split"))).toBe(true);
    const decoded = coder.instruction.decode(ix.data)!;
    expect(decoded.name).toBe("claim_creation_split");
  });

  it("respects a custom programId for both the instruction and its derived PDAs", () => {
    const custom = PublicKey.unique();
    const ix = claimCreationSplitIx({ config, pool, author, treasury, programId: custom });
    expect(ix.programId.equals(custom)).toBe(true);
    expect(ix.keys[0].pubkey.equals(presetPda(config, custom))).toBe(true);
    expect(ix.keys[3].pubkey.equals(vaultPda(config, custom))).toBe(true);
  });
});

describe("claimTradingSplitIxs", () => {
  const payer = PublicKey.unique();
  const config = PublicKey.unique();
  const pool = PublicKey.unique();
  const baseMint = PublicKey.unique();
  const author = PublicKey.unique();
  const treasury = PublicKey.unique();
  const maxQuote = 123_456_789n;

  it("returns exactly 4 idempotent ATA-creation instructions, in vault-base/vault-quote/author/treasury order, then the claim", () => {
    const ixs = claimTradingSplitIxs({ payer, config, pool, baseMint, author, treasury, maxQuote });
    expect(ixs).toHaveLength(5);

    const vault = vaultPda(config);
    const expectedPairs: [PublicKey, PublicKey][] = [
      [baseMint, vault], [NATIVE_MINT, vault], [NATIVE_MINT, author], [NATIVE_MINT, treasury],
    ];
    expectedPairs.forEach(([mint, owner], i) => {
      const expected = createAssociatedTokenAccountIdempotentInstruction(
        payer, getAssociatedTokenAddressSync(mint, owner, true), owner, mint,
      );
      expectInstructionsEqual(ixs[i], expected);
      // pins these as the *idempotent* variant (data = [1]), not the plain Create (data = []).
      expect(ixs[i].data.equals(Buffer.from([1]))).toBe(true);
    });
  });

  it("is idempotent: calling twice with the same args yields byte-identical instructions", () => {
    const a = claimTradingSplitIxs({ payer, config, pool, baseMint, author, treasury, maxQuote });
    const b = claimTradingSplitIxs({ payer, config, pool, baseMint, author, treasury, maxQuote });
    a.forEach((ix, i) => expectInstructionsEqual(ix, b[i]));
  });

  it("builds the claim instruction with DBC vault addresses from deriveDbcTokenVaultAddress and IDL-exact order/flags", () => {
    const [, , , , claim] = claimTradingSplitIxs({ payer, config, pool, baseMint, author, treasury, maxQuote });
    expect(claim.programId.equals(ROUTER_PROGRAM_ID)).toBe(true);
    expectKeysMatchIdl("claim_trading_split", claim.keys);

    const vault = vaultPda(config);
    const ata = (mint: PublicKey, owner: PublicKey) => getAssociatedTokenAddressSync(mint, owner, true);
    const expectedPubkeys = [
      presetPda(config), config, pool, vault,
      ata(baseMint, vault), ata(NATIVE_MINT, vault), ata(NATIVE_MINT, author), ata(NATIVE_MINT, treasury),
      deriveDbcTokenVaultAddress(pool, baseMint), deriveDbcTokenVaultAddress(pool, NATIVE_MINT),
      baseMint, NATIVE_MINT, TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
      DBC_POOL_AUTHORITY, dbcEventAuthority(), DBC,
    ];
    expect(claim.keys.map((k) => k.pubkey.toBase58())).toEqual(expectedPubkeys.map((p) => p.toBase58()));
  });

  it("encodes the 8-byte discriminator from the IDL followed by the borsh-encoded max_quote, decodable via BorshCoder", () => {
    const [, , , , claim] = claimTradingSplitIxs({ payer, config, pool, baseMint, author, treasury, maxQuote });
    expect(claim.data.subarray(0, 8).equals(discOf("claim_trading_split"))).toBe(true);
    const decoded = coder.instruction.decode(claim.data)!;
    expect(decoded.name).toBe("claim_trading_split");
    expect(((decoded.data as any).max_quote as BN).toString()).toBe(maxQuote.toString());
  });

  it("respects a custom programId for the claim instruction and its derived PDAs, leaving ATA creations on the SPL programs", () => {
    const custom = PublicKey.unique();
    const ixs = claimTradingSplitIxs({ payer, config, pool, baseMint, author, treasury, maxQuote, programId: custom });
    const claim = ixs[4];
    expect(claim.programId.equals(custom)).toBe(true);
    expect(claim.keys[0].pubkey.equals(presetPda(config, custom))).toBe(true);
    expect(claim.keys[3].pubkey.equals(vaultPda(config, custom))).toBe(true);
    // the vault PDA changes with a custom programId, so the vault-owned ATAs change too — but the
    // ATA-creation instructions themselves still go through the (fixed) associated-token program.
    expect(ixs[0].programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true);
  });
});

describe("decodePreset", () => {
  it("round-trips an account encoded with BorshCoder(idl).accounts.encode(\"Preset\", …)", async () => {
    const fields = {
      author: PublicKey.unique(),
      dbc_config: PublicKey.unique(),
      author_bps: 4321,
      treasury: PublicKey.unique(),
      quote_mint: PublicKey.unique(),
      launches_claimed: new BN("7"),
      total_split_quote: new BN("123456789012"),
      total_split_lamports: new BN("987654321098"),
      bump: 1,
      vault_bump: 2,
    };
    const encoded: Buffer = await coder.accounts.encode("Preset", fields);
    const decoded = decodePreset(encoded);
    expect(decoded).toEqual({
      author: fields.author.toBase58(),
      dbcConfig: fields.dbc_config.toBase58(),
      authorBps: fields.author_bps,
      treasury: fields.treasury.toBase58(),
      quoteMint: fields.quote_mint.toBase58(),
      launchesClaimed: 7n,
      totalSplitQuote: 123456789012n,
      totalSplitLamports: 987654321098n,
    });
  });
});
