// buildLaunchTx: launch a token on a Curvebook preset (or any DBC config) with the
// creator's bundled first buy. The app's /api/launch/build calls this, and so can a
// launchpad's own frontend: royalties still flow because the config's fee_claimer is
// the router vault on-chain, not something this function controls.
import { createHash } from "node:crypto";
import {
  ComputeBudgetProgram, Keypair, PublicKey, TransactionMessage, VersionedTransaction,
  type Connection, type TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";
import { DynamicBondingCurveClient, SwapMode, deriveDbcPoolAddress } from "@meteora-ag/dynamic-bonding-curve-sdk";

export type LaunchQuote = {
  /** base atoms the first buy is expected to receive */
  expectedOut: bigint;
  /** base atoms below which the first buy reverts (slippage guard, D2) */
  minimumOut: bigint;
  /** total fee the first buy pays, in quote atoms */
  fee: bigint;
};

export type BuiltLaunch = {
  tx: VersionedTransaction; // signed by the new base mint only; the creator signs next
  baseMint: PublicKey;
  pool: PublicKey;
  quote: LaunchQuote;
  lastValidBlockHeight: number;
  messageHash: string;
};

export const launchMessageHash = (tx: VersionedTransaction) => createHash("sha256").update(tx.message.serialize()).digest("hex");

export async function buildLaunchTx(args: {
  connection: Connection;
  config: PublicKey | string;
  creator: PublicKey;
  name: string;
  symbol: string;
  uri: string;
  /** first buy, in quote atoms (lamports for SOL-quoted configs) */
  buyAmount: bigint;
  slippageBps?: number;
  /** extra instructions appended after the launch, e.g. a landing tip */
  extraIxs?: TransactionInstruction[];
  priorityMicroLamports?: number;
}): Promise<BuiltLaunch> {
  const config = new PublicKey(args.config);
  const client = new DynamicBondingCurveClient(args.connection, "confirmed");
  const poolConfig = await client.state.getPoolConfig(config);
  if (!poolConfig) throw new Error(`not a DBC config: ${config.toBase58()}`);

  // D2: quote the creator's bundled buy at launch (currentPoint 0) with the min-fee rule the
  // config grants it. ExactIn throws if the curve cannot absorb the amount: the creator sees
  // that before signing instead of a failed transaction.
  let q;
  try {
    q = client.pool.getQuoteFromInputAmount({
      config: poolConfig as any,
      swapBaseForQuote: false,
      amountIn: new BN(args.buyAmount.toString()),
      swapMode: SwapMode.ExactIn,
      slippageBps: args.slippageBps ?? 100,
      currentPoint: new BN(0),
      eligibleForFirstSwapWithMinFee: Boolean(poolConfig.enableFirstSwapWithMinFee),
    });
  } catch (e: any) {
    throw new Error(`the curve cannot absorb a first buy of this size: ${e?.message ?? e}`);
  }
  const quote: LaunchQuote = {
    expectedOut: BigInt(q.outputAmount.toString()),
    minimumOut: BigInt((q.minimumAmountOut ?? q.outputAmount).toString()),
    fee: BigInt(q.includedFeeInputAmount.sub(q.excludedFeeInputAmount).toString()),
  };

  const baseMint = Keypair.generate();
  const legacy = await client.creator.createPoolWithFirstBuy({
    createPoolParam: {
      baseMint: baseMint.publicKey, config, name: args.name, symbol: args.symbol, uri: args.uri,
      payer: args.creator, poolCreator: args.creator,
    },
    firstBuyParam: {
      buyer: args.creator,
      buyAmount: new BN(args.buyAmount.toString()),
      minimumAmountOut: new BN(quote.minimumOut.toString()),
      referralTokenAccount: null,
    },
  });

  const ixs = [
    ...(args.priorityMicroLamports ? [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: args.priorityMicroLamports })] : []),
    ...legacy.instructions,
    ...(args.extraIxs ?? []),
  ];
  const { blockhash, lastValidBlockHeight } = await args.connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({ payerKey: args.creator, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign([baseMint]);

  return {
    tx,
    baseMint: baseMint.publicKey,
    pool: deriveDbcPoolAddress(poolConfig.quoteMint, baseMint.publicKey, config),
    quote,
    lastValidBlockHeight,
    messageHash: launchMessageHash(tx),
  };
}
