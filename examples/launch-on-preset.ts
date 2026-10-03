// Launch a token on a Curvebook preset from your own launchpad backend.
// The preset's DBC config names the curvebook_router vault as fee_claimer, so the preset author's
// royalty flows on-chain no matter whose frontend sent the launch.
//   CONFIG=<preset config> KEYPAIR=<creator.json> RPC_URL=… npx tsx examples/launch-on-preset.ts
import { readFileSync } from "node:fs";
import { Connection, Keypair } from "@solana/web3.js";
import { buildLaunchTx } from "@curvebook/core";

const connection = new Connection(process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com", "confirmed");
const creator = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.KEYPAIR!, "utf8"))));

const launch = await buildLaunchTx({
  connection,
  config: process.env.CONFIG!,
  creator: creator.publicKey,
  name: "My Token",
  symbol: "MINE",
  uri: "https://example.com/metadata.json",
  buyAmount: 100_000_000n, // 0.1 SOL bundled first buy, slippage-guarded from the SDK quote
});
launch.tx.sign([creator]); // the base mint already signed inside buildLaunchTx
const sig = await connection.sendRawTransaction(launch.tx.serialize());
console.log(`pool ${launch.pool.toBase58()} · expected ${launch.quote.expectedOut} base atoms · ${sig}`);
