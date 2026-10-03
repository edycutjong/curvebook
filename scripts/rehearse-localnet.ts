// End-to-end rehearsal on a local validator running the real Meteora DBC program
// (scripts/localnet.sh). Exercises exactly the mainnet path:
//   3 presets (create_config + register_preset) → launch on a preset with buildLaunchTx
//   → an outside wallet buys in the next slots → decode the window → claim_creation_split.
// Writes fixtures/rehearsal-localnet.json. Nothing here is mainnet evidence; it proves the path.
import { writeFileSync, mkdirSync } from "node:fs";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction } from "@solana/web3.js";
import BN from "bn.js";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import {
  buildLaunchTx, buildWindow, claimCreationSplitIx, decodePoolConfig, decodePreset, decodeTx, feeBps, presetPda,
  type SwapEvent,
} from "@curvebook/core";
import { deployAll, send } from "./lib/deploy.js";

const RPC = process.env.LOCALNET_URL ?? "http://127.0.0.1:8899";
const conn = new Connection(RPC, "confirmed");
const dbc = new DynamicBondingCurveClient(conn, "confirmed");

async function funded(sol: number) {
  const kp = Keypair.generate();
  const sig = await conn.requestAirdrop(kp.publicKey, sol * LAMPORTS_PER_SOL);
  await conn.confirmTransaction(sig, "confirmed");
  return kp;
}

// Raw JSON-RPC: the decoder reads the wire shape, not web3.js's parsed Message objects.
const getTx = async (sig: string) => {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [sig, { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 1 }] }) });
  return ((await r.json()) as any).result;
};
const waitSlot = async (target: number) => {
  while ((await conn.getSlot("confirmed")) < target) await new Promise((r) => setTimeout(r, 150));
};

const author = await funded(20);
const treasury = await funded(1); // rent-exempt recipient
const creator = await funded(10);
const sniper = await funded(20);

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

  // An outside wallet buys 1 SOL in slot s0+1 and again near the end of the window.
  const buys: string[] = [];
  for (const target of [s0 + 1, s0 + 8]) {
    await waitSlot(target);
    const tx = await dbc.pool.swap({
      owner: sniper.publicKey, pool: built.pool, amountIn: new BN(LAMPORTS_PER_SOL), minimumAmountOut: new BN(0),
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
  };
  results.push(r);
  console.log(`\n${p.name}: pool ${r.pool}`);
  console.log(`  creator first buy fee  ${r.creatorBuy.feeBps} bps`);
  for (const b of r.outsideBuys) console.log(`  outside buy slot +${b.slotOffset}  fee ${b.feeBps} bps`);
  console.log(`  SNP10 ${(r.snp10 * 100).toFixed(2)}%   creation fee split → author ${r.creationSplit.author} · treasury ${r.creationSplit.treasury} lamports`);
}

mkdirSync("fixtures", { recursive: true });
writeFileSync("fixtures/rehearsal-localnet.json", JSON.stringify({ network: "localnet (real DBC program dumped from mainnet)", at: new Date().toISOString(), presets, results }, null, 2));
console.log("\nwrote fixtures/rehearsal-localnet.json");
