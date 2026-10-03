// Localnet fixtures: real Meteora DBC configs/pools created through the official SDK.
import * as anchor from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import BN from "bn.js";
import {
  ActivationType,
  BaseFeeMode,
  buildCurve,
  CollectFeeMode,
  deriveDbcPoolAddress,
  DynamicBondingCurveClient,
  MigrationFeeOption,
  MigrationOption,
  TokenAuthorityOption,
  TokenDecimal,
  TokenType,
} from "@meteora-ag/dynamic-bonding-curve-sdk";

export const DBC_PROGRAM_ID = new PublicKey("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");
export const DBC_POOL_AUTHORITY = new PublicKey("FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM");
export const DBC_EVENT_AUTHORITY = PublicKey.findProgramAddressSync(
  [Buffer.from("__event_authority")],
  DBC_PROGRAM_ID,
)[0];

// Raw offsets the program trusts (programs/curvebook_router/src/dbc.rs).
export const OFF = {
  configQuoteMint: 8,
  configFeeClaimer: 40,
  configCollectFeeMode: 232,
  configPoolCreationFee: 368,
  poolConfig: 72,
  poolProtocolQuoteFee: 256,
  poolPartnerQuoteFee: 272,
  poolCreatorQuoteFee: 360,
  poolCreationFeeBits: 369,
};

export const POOL_CREATION_FEE_SOL = 0.05;

export function presetPda(programId: PublicKey, config: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("preset"), config.toBuffer()], programId)[0];
}
export function vaultPda(programId: PublicKey, config: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("vault"), config.toBuffer()], programId)[0];
}
export const wsolAta = (owner: PublicKey) => getAssociatedTokenAddressSync(NATIVE_MINT, owner, true);

export async function fund(conn: Connection, ...keys: PublicKey[]) {
  for (const k of keys) {
    const sig = await conn.requestAirdrop(k, 100 * LAMPORTS_PER_SOL);
    await conn.confirmTransaction(sig, "confirmed");
  }
}

export async function send(
  conn: Connection,
  payer: Keypair,
  ixs: TransactionInstruction[] | Transaction,
  signers: Keypair[] = [],
): Promise<string> {
  const tx = ixs instanceof Transaction ? ixs : new Transaction().add(...ixs);
  tx.instructions.unshift(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }));
  tx.feePayer = payer.publicKey;
  const uniq = new Map<string, Keypair>();
  for (const s of [payer, ...signers]) uniq.set(s.publicKey.toBase58(), s);
  return sendAndConfirmTransaction(conn, tx, [...uniq.values()], { commitment: "confirmed" });
}

export function configParams(collectFeeMode: CollectFeeMode = CollectFeeMode.QuoteToken) {
  return buildCurve({
    token: {
      tokenType: TokenType.SPLToken,
      tokenBaseDecimal: TokenDecimal.SIX,
      tokenQuoteDecimal: 9,
      tokenAuthorityOption: TokenAuthorityOption.Immutable,
      totalTokenSupply: 1_000_000_000,
      leftover: 0,
    },
    fee: {
      // Exponential anti-sniper scheduler: 25% decaying to 1% over 100 slots.
      baseFeeParams: {
        baseFeeMode: BaseFeeMode.FeeSchedulerExponential,
        feeSchedulerParam: { startingFeeBps: 2500, endingFeeBps: 100, numberOfPeriod: 10, totalDuration: 100 },
      },
      dynamicFeeEnabled: false,
      collectFeeMode,
      creatorTradingFeePercentage: 0,
      poolCreationFee: POOL_CREATION_FEE_SOL,
      enableFirstSwapWithMinFee: false,
    },
    migration: {
      migrationOption: MigrationOption.MET_DAMM_V2,
      migrationFeeOption: MigrationFeeOption.FixedBps100,
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
    },
    liquidityDistribution: {
      partnerPermanentLockedLiquidityPercentage: 50,
      partnerLiquidityPercentage: 0,
      creatorPermanentLockedLiquidityPercentage: 50,
      creatorLiquidityPercentage: 0,
    },
    lockedVesting: {
      totalLockedVestingAmount: 0,
      numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0,
      totalVestingDuration: 0,
      cliffDurationFromMigrationTime: 0,
    },
    activationType: ActivationType.Slot,
    percentageSupplyOnMigration: 20,
    migrationQuoteThreshold: 85,
  });
}

/** create_config instructions with an arbitrary fee claimer. */
export async function createConfigIxs(
  dbc: DynamicBondingCurveClient,
  config: PublicKey,
  feeClaimer: PublicKey,
  payer: PublicKey,
  collectFeeMode: CollectFeeMode = CollectFeeMode.QuoteToken,
): Promise<TransactionInstruction[]> {
  const tx = await dbc.partner.createConfig({
    config,
    feeClaimer,
    leftoverReceiver: payer,
    quoteMint: NATIVE_MINT,
    payer,
    ...configParams(collectFeeMode),
  });
  return tx.instructions;
}

export type Launch = { pool: PublicKey; baseMint: PublicKey; baseVault: PublicKey; quoteVault: PublicKey };

/** Launch a token on `config` with a first buy, the way a creator would. */
export async function launch(
  conn: Connection,
  dbc: DynamicBondingCurveClient,
  config: PublicKey,
  creator: Keypair,
  firstBuyLamports = 0.5 * LAMPORTS_PER_SOL,
): Promise<Launch> {
  const baseMint = Keypair.generate();
  const tx = await dbc.creator.createPoolWithFirstBuy({
    createPoolParam: {
      name: "Curvebook Test",
      symbol: "CBT",
      uri: "https://example.invalid/cbt.json",
      payer: creator.publicKey,
      poolCreator: creator.publicKey,
      config,
      baseMint: baseMint.publicKey,
    },
    firstBuyParam: {
      buyer: creator.publicKey,
      buyAmount: new BN(firstBuyLamports),
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    },
  });
  await send(conn, creator, tx, [baseMint]);
  const pool = deriveDbcPoolAddress(NATIVE_MINT, baseMint.publicKey, config);
  const info = await conn.getAccountInfo(pool);
  if (!info) throw new Error("pool not found at derived address");
  return {
    pool,
    baseMint: baseMint.publicKey,
    baseVault: new PublicKey(info.data.subarray(168, 200)),
    quoteVault: new PublicKey(info.data.subarray(200, 232)),
  };
}

export async function buy(
  conn: Connection,
  dbc: DynamicBondingCurveClient,
  pool: PublicKey,
  trader: Keypair,
  lamports: number,
) {
  const tx = await dbc.pool.swap({
    owner: trader.publicKey,
    pool,
    amountIn: new BN(lamports),
    minimumAmountOut: new BN(0),
    swapBaseForQuote: false,
    referralTokenAccount: null,
  });
  await send(conn, trader, tx);
}

export async function readU64(conn: Connection, account: PublicKey, offset: number): Promise<bigint> {
  const info = await conn.getAccountInfo(account, "confirmed");
  if (!info) throw new Error(`missing account ${account.toBase58()}`);
  return info.data.readBigUInt64LE(offset);
}

export async function tokenBalance(conn: Connection, ata: PublicKey): Promise<bigint> {
  const info = await conn.getAccountInfo(ata, "confirmed");
  return info ? info.data.readBigUInt64LE(64) : 0n;
}

export const ataIx = (payer: PublicKey, owner: PublicKey, mint: PublicKey = NATIVE_MINT) =>
  createAssociatedTokenAccountIdempotentInstruction(
    payer,
    getAssociatedTokenAddressSync(mint, owner, true),
    owner,
    mint,
  );

export { NATIVE_MINT, TOKEN_PROGRAM_ID, SystemProgram, anchor };
