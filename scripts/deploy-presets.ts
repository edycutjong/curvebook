// Deploy the three Curvebook presets to a cluster and register them with curvebook_router.
//   KEYPAIR=~/.config/solana/curvebook-deployer.json TREASURY=<pubkey> AUTHOR_BPS=7000 \
//   RPC_URL=https://api.mainnet-beta.solana.com npx tsx scripts/deploy-presets.ts
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

const router = await conn.getAccountInfo(ROUTER_PROGRAM_ID);
if (!router?.executable) throw new Error(`curvebook_router ${ROUTER_PROGRAM_ID.toBase58()} is not deployed on ${cluster}`);
const balance = await conn.getBalance(payer.publicKey);
console.log(`${cluster}: payer ${payer.publicKey.toBase58()} holds ${balance / LAMPORTS_PER_SOL} SOL`);
if (balance < 0.1 * LAMPORTS_PER_SOL) throw new Error("fund the payer with ≥ 0.1 SOL first (3 configs + 3 presets ≈ 0.05 SOL rent)");

const presets = await deployAll(conn, payer, treasury, authorBps);
const out = { cluster, router: ROUTER_PROGRAM_ID.toBase58(), author: payer.publicKey.toBase58(), treasury: treasury.toBase58(), authorBps, presets };
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
