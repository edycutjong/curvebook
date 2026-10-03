// Integration tests against the real Meteora DBC program (dumped from mainnet) on localnet.
// Test names carry the invariant they prove (I1..I6, see programs/curvebook_router).
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, createSyncNativeInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { CollectFeeMode, DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import BN from "bn.js";
import { expect } from "chai";
import type { CurvebookRouter } from "../target/types/curvebook_router";
import {
  ataIx,
  buy,
  createConfigIxs,
  DBC_EVENT_AUTHORITY,
  DBC_POOL_AUTHORITY,
  DBC_PROGRAM_ID,
  fund,
  launch,
  Launch,
  NATIVE_MINT,
  OFF,
  POOL_CREATION_FEE_SOL,
  presetPda,
  readU64,
  send,
  TOKEN_PROGRAM_ID,
  tokenBalance,
  vaultPda,
  wsolAta,
} from "./helpers";

const AUTHOR_BPS = 7000;

describe("curvebook_router", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.CurvebookRouter as Program<CurvebookRouter>;
  const conn = provider.connection;
  const dbc = new DynamicBondingCurveClient(conn, "confirmed");
  const events = new anchor.EventParser(program.programId, program.coder);

  const author = Keypair.generate();
  const treasury = Keypair.generate();
  const creator = Keypair.generate();
  const trader = Keypair.generate();
  const crank = Keypair.generate();
  const stranger = Keypair.generate();

  // The primary preset, used across the claim tests.
  const config = Keypair.generate();
  const preset = presetPda(program.programId, config.publicKey);
  const vault = vaultPda(program.programId, config.publicKey);
  let launchA: Launch;

  // A second registered preset, to source pools from "another config" (I4).
  const otherConfig = Keypair.generate();
  let otherLaunch: Launch;

  async function registerIx(cfg: Keypair, bps: number, who: Keypair = author) {
    return program.methods
      .registerPreset(bps, treasury.publicKey)
      .accountsPartial({
        author: who.publicKey,
        dbcConfig: cfg.publicKey,
        vault: vaultPda(program.programId, cfg.publicKey),
        preset: presetPda(program.programId, cfg.publicKey),
      })
      .instruction();
  }

  /** create_config(fee_claimer = vault) + register_preset in one tx, as the dApp does. */
  async function createPreset(cfg: Keypair, bps = AUTHOR_BPS) {
    const ixs = await createConfigIxs(dbc, cfg.publicKey, vaultPda(program.programId, cfg.publicKey), author.publicKey);
    await send(conn, author, [...ixs, await registerIx(cfg, bps)], [cfg]);
  }

  function tradingAccounts(cfg: PublicKey, l: Launch, overrides: Record<string, PublicKey> = {}) {
    const v = vaultPda(program.programId, cfg);
    return {
      preset: presetPda(program.programId, cfg),
      dbcConfig: cfg,
      pool: l.pool,
      vault: v,
      vaultBaseAccount: getAssociatedTokenAddressSync(l.baseMint, v, true),
      vaultQuoteAccount: wsolAta(v),
      authorQuoteAccount: wsolAta(author.publicKey),
      treasuryQuoteAccount: wsolAta(treasury.publicKey),
      baseVault: l.baseVault,
      quoteVault: l.quoteVault,
      baseMint: l.baseMint,
      quoteMint: NATIVE_MINT,
      tokenBaseProgram: TOKEN_PROGRAM_ID,
      tokenQuoteProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      dbcPoolAuthority: DBC_POOL_AUTHORITY,
      dbcEventAuthority: DBC_EVENT_AUTHORITY,
      dbcProgram: DBC_PROGRAM_ID,
      ...overrides,
    };
  }

  async function prepareTradingAtas(cfg: PublicKey, l: Launch) {
    const v = vaultPda(program.programId, cfg);
    await send(conn, crank, [
      ataIx(crank.publicKey, v, l.baseMint),
      ataIx(crank.publicKey, v),
      ataIx(crank.publicKey, author.publicKey),
      ataIx(crank.publicKey, treasury.publicKey),
    ]);
  }

  async function claimTrading(cfg: PublicKey, l: Launch, maxQuote: BN, overrides: Record<string, PublicKey> = {}) {
    const ix = await program.methods
      .claimTradingSplit(maxQuote)
      .accountsPartial(tradingAccounts(cfg, l, overrides))
      .instruction();
    return send(conn, crank, [ix]);
  }

  async function claimCreation(cfg: PublicKey, pool: PublicKey, overrides: Record<string, PublicKey> = {}) {
    const ix = await program.methods
      .claimCreationSplit()
      .accountsPartial({
        preset: presetPda(program.programId, cfg),
        dbcConfig: cfg,
        pool,
        vault: vaultPda(program.programId, cfg),
        author: author.publicKey,
        treasury: treasury.publicKey,
        systemProgram: SystemProgram.programId,
        dbcEventAuthority: DBC_EVENT_AUTHORITY,
        dbcProgram: DBC_PROGRAM_ID,
        ...overrides,
      })
      .instruction();
    return send(conn, crank, [ix]);
  }

  async function splitEvent(sig: string) {
    const tx = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    const evs = [...events.parseLogs(tx!.meta!.logMessages!)].filter((e) => e.name === "royaltySplit");
    expect(evs).to.have.length(1);
    const d = evs[0].data as any;
    return {
      kind: d.kind as number,
      claimed: BigInt(d.claimed.toString()),
      author: BigInt(d.authorAmount.toString()),
      treasury: BigInt(d.treasuryAmount.toString()),
      pool: d.pool as PublicKey,
    };
  }

  async function expectFail(p: Promise<unknown>, needle: string) {
    try {
      await p;
    } catch (e: any) {
      const text = [String(e?.message ?? e), ...(e?.logs ?? e?.transactionLogs ?? [])].join("\n");
      expect(text).to.contain(needle);
      return;
    }
    expect.fail(`expected failure containing "${needle}"`);
  }

  const splitOf = (claimed: bigint, bps: number) => {
    const a = (claimed * BigInt(bps)) / 10_000n;
    return [a, claimed - a];
  };

  before(async () => {
    await fund(conn, author.publicKey, treasury.publicKey, creator.publicKey, trader.publicKey, crank.publicKey, stranger.publicKey);
    await createPreset(config);
    await createPreset(otherConfig);
    launchA = await launch(conn, dbc, config.publicKey, creator);
    otherLaunch = await launch(conn, dbc, otherConfig.publicKey, creator);
    await prepareTradingAtas(config.publicKey, launchA);
    await prepareTradingAtas(otherConfig.publicKey, otherLaunch);
  });

  // ---- layout ------------------------------------------------------------------------------

  it("dbc layout: raw offsets agree with the DBC SDK decoder on a real config and pool", async () => {
    const raw = (await conn.getAccountInfo(config.publicKey))!.data;
    const decoded = (await dbc.state.getPoolConfig(config.publicKey))!;
    expect(new PublicKey(raw.subarray(OFF.configQuoteMint, OFF.configQuoteMint + 32)).equals(decoded.quoteMint)).to.be.true;
    expect(new PublicKey(raw.subarray(OFF.configFeeClaimer, OFF.configFeeClaimer + 32)).equals(vault)).to.be.true;
    expect(raw[OFF.configCollectFeeMode]).to.equal(decoded.collectFeeMode);
    expect(raw.readBigUInt64LE(OFF.configPoolCreationFee)).to.equal(BigInt(POOL_CREATION_FEE_SOL * LAMPORTS_PER_SOL));

    const rawPool = (await conn.getAccountInfo(launchA.pool))!.data;
    const pool = (await dbc.state.getPool(launchA.pool))!.poolState;
    expect(new PublicKey(rawPool.subarray(OFF.poolConfig, OFF.poolConfig + 32)).equals(config.publicKey)).to.be.true;
    expect(rawPool.readBigUInt64LE(OFF.poolPartnerQuoteFee).toString()).to.equal(pool.partnerQuoteFee.toString());
  });

  it("dbc layout: offsets hold on a live mainnet PoolConfig", async function () {
    const mainnet = new anchor.web3.Connection(process.env.MAINNET_RPC ?? "https://api.mainnet-beta.solana.com");
    let info;
    try {
      info = await mainnet.getAccountInfo(new PublicKey("3yFxSqnZHrJZYhLpvTCHht6i1kyEDnckLj1yJixhb5US"));
    } catch {
      this.skip(); // offline: the localnet layout test above still covers the offsets
    }
    expect(info!.owner.equals(DBC_PROGRAM_ID)).to.be.true;
    expect([...info!.data.subarray(0, 8)]).to.deep.equal([26, 108, 14, 123, 116, 230, 129, 43]);
    expect(new PublicKey(info!.data.subarray(OFF.configQuoteMint, OFF.configQuoteMint + 32)).equals(NATIVE_MINT)).to.be.true;
    expect(info!.data[OFF.configCollectFeeMode]).to.be.oneOf([0, 1]);
  });

  // ---- register_preset ---------------------------------------------------------------------

  it("register_preset stores the preset for a config whose fee claimer is its vault", async () => {
    const p = await program.account.preset.fetch(preset);
    expect(p.author.equals(author.publicKey)).to.be.true;
    expect(p.dbcConfig.equals(config.publicKey)).to.be.true;
    expect(p.treasury.equals(treasury.publicKey)).to.be.true;
    expect(p.quoteMint.equals(NATIVE_MINT)).to.be.true;
    expect(p.authorBps).to.equal(AUTHOR_BPS);
    expect(p.launchesClaimed.toNumber()).to.equal(0);
  });

  it("I3: register_preset rejects a config whose fee_claimer is not the vault PDA", async () => {
    const cfg = Keypair.generate();
    const ixs = await createConfigIxs(dbc, cfg.publicKey, author.publicKey, author.publicKey);
    await send(conn, author, ixs, [cfg]);
    await expectFail(send(conn, author, [await registerIx(cfg, AUTHOR_BPS)], [cfg]), "FeeClaimerMismatch");
  });

  it("I3: register_preset rejects a config that collects fees in the base token", async () => {
    const cfg = Keypair.generate();
    const ixs = await createConfigIxs(
      dbc, cfg.publicKey, vaultPda(program.programId, cfg.publicKey), author.publicKey, CollectFeeMode.OutputToken,
    );
    await send(conn, author, ixs, [cfg]);
    await expectFail(send(conn, author, [await registerIx(cfg, AUTHOR_BPS)], [cfg]), "UnsupportedCollectFeeMode");
  });

  it("I3: register_preset rejects an account not owned by DBC", async () => {
    const fake = Keypair.generate();
    await expectFail(send(conn, author, [await registerIx(fake, AUTHOR_BPS)], [fake]), "NotDbcAccount");
  });

  it("I3: register_preset requires the config keypair to co-sign (front-running guard)", async () => {
    const cfg = Keypair.generate();
    const ixs = await createConfigIxs(dbc, cfg.publicKey, vaultPda(program.programId, cfg.publicKey), author.publicKey);
    await send(conn, author, ixs, [cfg]);
    const ix = await registerIx(cfg, AUTHOR_BPS, stranger);
    ix.keys.forEach((k) => {
      if (k.pubkey.equals(cfg.publicKey)) k.isSigner = false;
    });
    await expectFail(send(conn, stranger, [ix]), "AccountNotSigner");
  });

  it("I5: register_preset rejects author_bps = 9001", async () => {
    const cfg = Keypair.generate();
    const ixs = await createConfigIxs(dbc, cfg.publicKey, vaultPda(program.programId, cfg.publicKey), author.publicKey);
    await expectFail(send(conn, author, [...ixs, await registerIx(cfg, 9001)], [cfg]), "InvalidAuthorBps");
  });

  // ---- set_split ---------------------------------------------------------------------------

  it("I5: set_split rejects 9001 and rejects a non-author signer", async () => {
    await expectFail(
      program.methods.setSplit(9001).accountsPartial({ author: author.publicKey, preset }).signers([author]).rpc(),
      "InvalidAuthorBps",
    );
    await expectFail(
      program.methods.setSplit(100).accountsPartial({ author: stranger.publicKey, preset }).signers([stranger]).rpc(),
      "ConstraintHasOne",
    );
    expect((await program.account.preset.fetch(preset)).authorBps).to.equal(AUTHOR_BPS);
  });

  // ---- claim_creation_split ----------------------------------------------------------------

  it("I1+I2: claim_creation_split splits exactly the lamports DBC paid and leaves the vault unchanged", async () => {
    const before = {
      vault: await conn.getBalance(vault),
      author: await conn.getBalance(author.publicKey),
      treasury: await conn.getBalance(treasury.publicKey),
    };
    const sig = await claimCreation(config.publicKey, launchA.pool);
    const ev = await splitEvent(sig);
    const after = {
      vault: await conn.getBalance(vault),
      author: await conn.getBalance(author.publicKey),
      treasury: await conn.getBalance(treasury.publicKey),
    };
    expect(ev.kind).to.equal(1);
    expect(ev.pool.equals(launchA.pool)).to.be.true;
    // DBC keeps 10% of the creation fee for the protocol; the partner share is 90%.
    expect(ev.claimed).to.equal(BigInt(POOL_CREATION_FEE_SOL * LAMPORTS_PER_SOL * 0.9));
    expect(ev.author + ev.treasury).to.equal(ev.claimed); // I2
    expect([ev.author, ev.treasury]).to.deep.equal(splitOf(ev.claimed, AUTHOR_BPS));
    expect(after.vault).to.equal(before.vault); // I1
    expect(BigInt(after.author - before.author)).to.equal(ev.author);
    expect(BigInt(after.treasury - before.treasury)).to.equal(ev.treasury);

    const p = await program.account.preset.fetch(preset);
    expect(p.launchesClaimed.toNumber()).to.equal(1);
    expect(p.totalSplitLamports.toString()).to.equal(ev.claimed.toString());
  });

  it("claim_creation_split cannot claim the same launch twice", async () => {
    // DBC's own flag rejects it; the router adds no bookkeeping that could drift.
    await expectFail(claimCreation(config.publicKey, launchA.pool), "PoolCreationFeeHasBeenClaimed");
    expect((await program.account.preset.fetch(preset)).launchesClaimed.toNumber()).to.equal(1);
  });

  it("I4: claim_creation_split rejects a pool from another config", async () => {
    await expectFail(claimCreation(config.publicKey, otherLaunch.pool), "PoolConfigMismatch");
  });

  // ---- claim_trading_split -----------------------------------------------------------------

  it("I1+I2+I6: claim_trading_split pays out the exact DBC partner fee delta", async () => {
    for (const amt of [0.3, 1.2, 0.7]) await buy(conn, dbc, launchA.pool, trader, amt * LAMPORTS_PER_SOL);

    const partnerBefore = await readU64(conn, launchA.pool, OFF.poolPartnerQuoteFee);
    const protocolBefore = await readU64(conn, launchA.pool, OFF.poolProtocolQuoteFee);
    expect(partnerBefore > 0n).to.be.true;
    const vaultBefore = await tokenBalance(conn, wsolAta(vault));
    const authorBefore = await tokenBalance(conn, wsolAta(author.publicKey));
    const treasuryBefore = await tokenBalance(conn, wsolAta(treasury.publicKey));

    const ev = await splitEvent(await claimTrading(config.publicKey, launchA, new BN("18446744073709551615")));

    expect(ev.kind).to.equal(0);
    expect(ev.claimed).to.equal(partnerBefore);
    expect(ev.author + ev.treasury).to.equal(ev.claimed); // I2
    expect([ev.author, ev.treasury]).to.deep.equal(splitOf(ev.claimed, AUTHOR_BPS));
    expect(await tokenBalance(conn, wsolAta(vault))).to.equal(vaultBefore); // I1
    expect((await tokenBalance(conn, wsolAta(author.publicKey))) - authorBefore).to.equal(ev.author);
    expect((await tokenBalance(conn, wsolAta(treasury.publicKey))) - treasuryBefore).to.equal(ev.treasury);
    // I6: DBC's partner accrual drops by exactly what the router reported.
    expect(partnerBefore - (await readU64(conn, launchA.pool, OFF.poolPartnerQuoteFee))).to.equal(ev.claimed);
    // The protocol's own accrual is untouched by a partner claim.
    expect(await readU64(conn, launchA.pool, OFF.poolProtocolQuoteFee)).to.equal(protocolBefore);
    console.log(`      partner fee claimed ${ev.claimed} lamports; protocol accrued ${protocolBefore}`);
  });

  it("I6: claim_trading_split honours max_quote and DBC's accrual drops by exactly that amount", async () => {
    await buy(conn, dbc, launchA.pool, trader, 2 * LAMPORTS_PER_SOL);
    const partnerBefore = await readU64(conn, launchA.pool, OFF.poolPartnerQuoteFee);
    const cap = partnerBefore / 3n + 1n; // odd number so the floor remainder is exercised
    const ev = await splitEvent(await claimTrading(config.publicKey, launchA, new BN(cap.toString())));
    expect(ev.claimed).to.equal(cap);
    expect(ev.author + ev.treasury).to.equal(cap);
    expect(partnerBefore - (await readU64(conn, launchA.pool, OFF.poolPartnerQuoteFee))).to.equal(cap);
  });

  it("set_split changes the ratio for the next claim only", async () => {
    await program.methods.setSplit(9000).accountsPartial({ author: author.publicKey, preset }).signers([author]).rpc();
    const remaining = await readU64(conn, launchA.pool, OFF.poolPartnerQuoteFee);
    const ev = await splitEvent(await claimTrading(config.publicKey, launchA, new BN(remaining.toString())));
    expect([ev.author, ev.treasury]).to.deep.equal(splitOf(ev.claimed, 9000));
    const p = await program.account.preset.fetch(preset);
    expect(p.authorBps).to.equal(9000);
  });

  it("claim_trading_split fails with NothingToClaim when no fee has accrued", async () => {
    expect(await readU64(conn, launchA.pool, OFF.poolPartnerQuoteFee)).to.equal(0n);
    await expectFail(claimTrading(config.publicKey, launchA, new BN(1_000_000)), "NothingToClaim");
  });

  it("I4: claim_trading_split rejects a pool from another config", async () => {
    await buy(conn, dbc, otherLaunch.pool, trader, 0.5 * LAMPORTS_PER_SOL);
    const accounts = tradingAccounts(otherConfig.publicKey, otherLaunch);
    await expectFail(
      claimTrading(config.publicKey, otherLaunch, new BN(1_000_000), {
        vaultBaseAccount: accounts.vaultBaseAccount, // owned by the other vault → also wrong
      }),
      "ConstraintTokenOwner",
    );
    // Same pool, but with this preset's own vault-owned base ATA, so only the pool check can fire.
    await send(conn, crank, [ataIx(crank.publicKey, vault, otherLaunch.baseMint)]);
    await expectFail(claimTrading(config.publicKey, otherLaunch, new BN(1_000_000)), "PoolConfigMismatch");
  });

  it("I4: claim_trading_split refuses to CPI into any program other than DBC", async () => {
    await expectFail(
      claimTrading(otherConfig.publicKey, otherLaunch, new BN(1_000_000), { dbcProgram: TOKEN_PROGRAM_ID }),
      "ConstraintAddress",
    );
  });

  it("I1: tokens donated to the vault ATA are not swept into a split", async () => {
    // Someone sends 1 SOL of wSOL straight to the other preset's vault ATA.
    const otherVault = vaultPda(program.programId, otherConfig.publicKey);
    await send(conn, stranger, [
      ataIx(stranger.publicKey, stranger.publicKey),
      SystemProgram.transfer({ fromPubkey: stranger.publicKey, toPubkey: wsolAta(otherVault), lamports: LAMPORTS_PER_SOL }),
      createSyncNativeInstruction(wsolAta(otherVault)),
    ]);
    const vaultBefore = await tokenBalance(conn, wsolAta(otherVault));
    const partnerBefore = await readU64(conn, otherLaunch.pool, OFF.poolPartnerQuoteFee);
    const ev = await splitEvent(await claimTrading(otherConfig.publicKey, otherLaunch, new BN(partnerBefore.toString())));
    expect(ev.claimed).to.equal(partnerBefore);
    expect(await tokenBalance(conn, wsolAta(otherVault))).to.equal(vaultBefore);
  });
});
