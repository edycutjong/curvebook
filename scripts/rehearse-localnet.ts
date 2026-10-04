// End-to-end rehearsal on a local validator running the real Meteora DBC program
// (scripts/localnet.sh). Exercises exactly the mainnet path:
//   3 presets (create_config + register_preset) → launch on a preset with buildLaunchTx
//   → an outside wallet buys in the next slots → decode the window → claim_creation_split.
// Writes fixtures/rehearsal-localnet.json. Nothing here is mainnet evidence; it proves the path.
import { writeFileSync, mkdirSync } from "node:fs";
import { ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { NATIVE_MINT, getAssociatedTokenAddressSync } from "@solana/spl-token";
import BN from "bn.js";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import {
  buildLaunchTx, buildWindow, claimCreationSplitIx, claimTradingSplitIxs, decodePoolConfig, decodePreset, decodeTx, feeBps, presetPda,
  type SwapEvent,
} from "@curvebook/core";
import { deployAll, loadKeypair, send } from "./lib/deploy.js";

const RPC = process.env.LOCALNET_URL ?? "http://127.0.0.1:8899";
const conn = new Connection(RPC, "confirmed");
const dbc = new DynamicBondingCurveClient(conn, "confirmed");

// Localnet: airdrop. Devnet (FUNDER=<keypair path>): transfer from a funded wallet, since airdrops are rate-limited.
const funder = process.env.FUNDER ? loadKeypair(process.env.FUNDER) : null;
async function funded(sol: number) {
  const kp = Keypair.generate();
  if (funder) {
    await send(conn, new Transaction().add(SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: kp.publicKey, lamports: Math.round(sol * LAMPORTS_PER_SOL) })), [funder]);
    return kp;
  }
  const sig = await conn.requestAirdrop(kp.publicKey, sol * LAMPORTS_PER_SOL);
  await conn.confirmTransaction(sig, "confirmed");
  return kp;
}

// Raw JSON-RPC: the decoder reads the wire shape, not web3.js's parsed Message objects.
// Retries rate limits and not-yet-indexed transactions (public devnet does both).
const getTx = async (sig: string): Promise<any> => {
  for (let i = 0; i < 12; i++) {
    const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [sig, { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 1 }] }) });
    const j: any = r.status === 429 ? null : await r.json().catch(() => null);
    if (j?.result) return j.result;
    await new Promise((s) => setTimeout(s, 700 * (i + 1)));
  }
  throw new Error(`transaction not available: ${sig}`);
};
const waitSlot = async (target: number) => {
  while ((await conn.getSlot("confirmed")) < target) await new Promise((r) => setTimeout(r, 150));
};

const author = await funded(funder ? 0.35 : 20);
const treasury = await funded(funder ? 0.03 : 1); // rent-exempt recipient
const creator = await funded(funder ? 0.6 : 10);
const sniper = await funded(funder ? 1.05 : 20);
const OUTSIDE_BUY = funder ? LAMPORTS_PER_SOL / 4 : LAMPORTS_PER_SOL; // devnet SOL is scarce

console.log("deploying presets…");
const presets = await deployAll(conn, author, treasury.publicKey, 7000);
for (const p of presets) console.log(`  ${p.name.padEnd(10)} config ${p.config}  vault ${p.vault}`);

const results: any[] = [];
for (const p of presets.filter((x) => x.slug !== "two-step")) {
  const built = await buildLaunchTx({
    connection: conn, config: p.config, creator: creator.publicKey,
    name: `Rehearsal ${p.name}`, symbol: "RHS", uri: "https://example.invalid/rhs.json", buyAmount: 200_000_000n,
  });
  built.tx.sign([creator]);
  const createSig = await conn.sendRawTransaction(built.tx.serialize());
  await conn.confirmTransaction(createSig, "confirmed");
  const createTx = await getTx(createSig);
  const s0 = createTx.slot;

  // An outside wallet buys (1 SOL localnet, 0.25 SOL devnet) in slot s0+1 and again near the end of the window.
  const buys: string[] = [];
  for (const target of [s0 + 1, s0 + 8]) {
    await waitSlot(target);
    const tx = await dbc.pool.swap({
      owner: sniper.publicKey, pool: built.pool, amountIn: new BN(OUTSIDE_BUY), minimumAmountOut: new BN(0),
      swapBaseForQuote: false, referralTokenAccount: null,
    });
    buys.push(await send(conn, tx, [sniper]));
  }

  const cfgAcc = await conn.getAccountInfo(new PublicKey(p.config));
  const cfg = decodePoolConfig(p.config, cfgAcc!.data);
  const swaps = (await Promise.all([createSig, ...buys].map(getTx))).flatMap((t) => decodeTx(t)).filter((e): e is SwapEvent => e.kind === "swap");
  const w = buildWindow({ pool: built.pool.toBase58(), config: p.config, creator: creator.publicKey.toBase58(), openSlot: s0, swapBaseAmount: cfg.swapBaseAmount, swaps });

  // Crank the creation-fee split (anyone may).
  const before = { author: await conn.getBalance(author.publicKey), treasury: await conn.getBalance(treasury.publicKey) };
  const claimSig = await send(conn, new Transaction().add(claimCreationSplitIx({ config: new PublicKey(p.config), pool: built.pool, author: author.publicKey, treasury: treasury.publicKey })), [sniper]);
  const after = { author: await conn.getBalance(author.publicKey), treasury: await conn.getBalance(treasury.publicKey) };

  // S8: the partner's trading-fee accrual equals Σ tradingFee × (100 − creator%) / 100 over decoded swaps.
  const allSwaps = swaps.filter((s) => s.pool === built.pool.toBase58());
  const decodedPartner = allSwaps.reduce((a, s) => a + (s.tradingFee * BigInt(100 - cfg.creatorTradingFeePct)) / 100n, 0n);
  const fb0 = await dbc.state.getPoolFeeBreakdown(built.pool);
  const sdkPartner = BigInt(fb0.partner.totalQuoteFee.toString());

  // claim_trading_split via the core builder; I6: partner unclaimed fee drops by exactly what was split.
  const wsol = (o: PublicKey) => getAssociatedTokenAddressSync(NATIVE_MINT, o, true);
  const bal = async (o: PublicKey) => BigInt((await conn.getTokenAccountBalance(wsol(o)).catch(() => ({ value: { amount: "0" } }))).value.amount);
  const tb = { author: await bal(author.publicKey), treasury: await bal(treasury.publicKey) };
  const tradeSig = await send(conn, new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...claimTradingSplitIxs({
    payer: sniper.publicKey, config: new PublicKey(p.config), pool: built.pool, baseMint: built.baseMint,
    author: author.publicKey, treasury: treasury.publicKey, maxQuote: 2n ** 63n,
  })), [sniper]);
  const ta = { author: await bal(author.publicKey), treasury: await bal(treasury.publicKey) };
  const fb1 = await dbc.state.getPoolFeeBreakdown(built.pool);
  const split = ta.author - tb.author + (ta.treasury - tb.treasury);
  const unclaimedDrop = BigInt(fb0.partner.unclaimedQuoteFee.toString()) - BigInt(fb1.partner.unclaimedQuoteFee.toString());
  const preset = decodePreset((await conn.getAccountInfo(presetPda(new PublicKey(p.config))))!.data);

  const feeOf = (s: SwapEvent) => (s.includedFeeInput === 0n ? 0 : Number(((s.includedFeeInput - s.excludedFeeInput) * 10_000n) / s.includedFeeInput));
  const r = {
    preset: p.name,
    pool: built.pool.toBase58(),
    createSig,
    openSlot: s0,
    creatorBuy: { slotOffset: 0, feeBps: feeOf(swaps.find((s) => s.payer === creator.publicKey.toBase58())!) },
    outsideBuys: w.buys.filter((b) => !b.isCreator).map((b) => ({ slotOffset: b.offset, feeBps: Number((b.fee * 10_000n) / b.quoteIn), sig: b.sig })),
    snp10: w.snp10,
    perSlot: w.perSlot,
    predictedCliffBps: feeBps(cfg.baseFee.cliffFeeNumerator),
    creationSplit: { claimSig, author: after.author - before.author, treasury: after.treasury - before.treasury, presetTotalLamports: preset.totalSplitLamports.toString() },
    tradingSplit: { tradeSig, author: (ta.author - tb.author).toString(), treasury: (ta.treasury - tb.treasury).toString(), unclaimedDrop: unclaimedDrop.toString(), i6: split === unclaimedDrop },
    s8: { decodedPartner: decodedPartner.toString(), sdkPartnerTotal: sdkPartner.toString(), equal: decodedPartner === sdkPartner },
  };
  results.push(r);
  console.log(`\n${p.name}: pool ${r.pool}`);
  console.log(`  creator first buy fee  ${r.creatorBuy.feeBps} bps`);
  for (const b of r.outsideBuys) console.log(`  outside buy slot +${b.slotOffset}  fee ${b.feeBps} bps`);
  console.log(`  SNP10 ${(r.snp10 * 100).toFixed(2)}%   creation fee split → author ${r.creationSplit.author} · treasury ${r.creationSplit.treasury} lamports`);
  console.log(`  trading fee split → author ${r.tradingSplit.author} · treasury ${r.tradingSplit.treasury} wSOL atoms · I6 ${r.tradingSplit.i6 ? "holds" : "BROKEN"}`);
  console.log(`  S8 partner fee: decoded ${r.s8.decodedPartner} vs SDK ${r.s8.sdkPartnerTotal} → ${r.s8.equal ? "equal" : "DIFFERENT"}`);
}

mkdirSync("fixtures", { recursive: true });
const NET = RPC.includes("devnet") ? "devnet" : "localnet";
writeFileSync(`fixtures/rehearsal-${NET}.json`, JSON.stringify({ network: NET === "devnet" ? "devnet (Meteora DBC devnet deployment + curvebook_router)" : "localnet (real DBC program dumped from mainnet)", at: new Date().toISOString(), presets, results }, null, 2));
console.log(`\nwrote fixtures/rehearsal-${NET}.json`);
