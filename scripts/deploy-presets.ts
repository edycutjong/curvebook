// Deploy the three Curvebook presets to a cluster and register them with curvebook_router.
//   KEYPAIR=~/.config/solana/curvebook-deployer.json TREASURY=<pubkey> AUTHOR_BPS=7000 \
//   RPC_URL=https://api.mainnet-beta.solana.com npx tsx scripts/deploy-presets.ts
// CLAIMER=wallet  → the author's wallet is the DBC fee claimer and no router is needed (≈ 0.03 SOL for 3 configs).
// POOL_CREATION_FEE=0.001 → creation fee per launch in SOL (DBC minimum 0.001; default 0.05).
// Writes fixtures/presets.<cluster>.json and upserts the `presets` table when DATABASE_URL is set.
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import postgres from "postgres";
import { ROUTER_PROGRAM_ID } from "@curvebook/core";
import { deployAll, loadKeypair } from "./lib/deploy.js";

const rpc = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const cluster = rpc.includes("mainnet") ? "mainnet-beta" : rpc.includes("devnet") ? "devnet" : "localnet";
const payer = loadKeypair((process.env.KEYPAIR ?? "~/.config/solana/id.json").replace("~", homedir()));
const treasury = new PublicKey(process.env.TREASURY ?? payer.publicKey);
const authorBps = Number(process.env.AUTHOR_BPS ?? 7000);
const conn = new Connection(rpc, "confirmed");

const claimer = (process.env.CLAIMER ?? "router") as "router" | "wallet";
const poolCreationFee = process.env.POOL_CREATION_FEE ? Number(process.env.POOL_CREATION_FEE) : undefined;
if (claimer === "router") {
  const router = await conn.getAccountInfo(ROUTER_PROGRAM_ID);
  if (!router?.executable) throw new Error(`curvebook_router ${ROUTER_PROGRAM_ID.toBase58()} is not deployed on ${cluster}`);
}
const balance = await conn.getBalance(payer.publicKey);
console.log(`${cluster}: payer ${payer.publicKey.toBase58()} holds ${balance / LAMPORTS_PER_SOL} SOL`);
if (balance < 0.05 * LAMPORTS_PER_SOL) throw new Error("fund the payer with ≥ 0.05 SOL first (3 configs ≈ 0.03 SOL rent)");

const presets = await deployAll(conn, payer, treasury, authorBps, { claimer, poolCreationFee });
const out = { cluster, claimer, poolCreationFee: poolCreationFee ?? 0.05, router: claimer === "router" ? ROUTER_PROGRAM_ID.toBase58() : null, author: payer.publicKey.toBase58(), treasury: treasury.toBase58(), authorBps, presets };
writeFileSync(`fixtures/presets.${cluster}.json`, JSON.stringify(out, null, 2) + "\n");
for (const p of presets) console.log(`${p.name.padEnd(10)} ${p.config}  ${p.sigs.join(" ")}`);

if (process.env.DATABASE_URL) {
  const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });
  for (const p of presets) {
    await sql`insert into presets (config, name, slug, author, author_bps, vault, create_sig, register_sig, params, network)
      values (${p.config}, ${p.name}, ${p.slug}, ${out.author}, ${authorBps}, ${p.vault}, ${p.sigs[0]}, ${p.sigs.at(-1)!},
        ${sql.json({ builder: p.builder, summary: p.summary })}, ${cluster})
      on conflict (config) do nothing`;
  }
  await sql.end();
  console.log("presets table updated");
}
