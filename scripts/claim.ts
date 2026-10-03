// Crank the creation-fee split for every launch on a preset (anyone may run this; it only moves
// fees from DBC to the preset's author and treasury).  POOLS=<a,b,…> CONFIG=<preset config> …
import { homedir } from "node:os";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { claimCreationSplitIx, decodePreset, presetPda } from "@curvebook/core";
import { loadKeypair, send } from "./lib/deploy.js";

const conn = new Connection(process.env.RPC_URL ?? "http://127.0.0.1:8899", "confirmed");
const payer = loadKeypair((process.env.KEYPAIR ?? "~/.config/solana/id.json").replace("~", homedir()));
const config = new PublicKey(process.env.CONFIG!);
const preset = decodePreset((await conn.getAccountInfo(presetPda(config)))!.data);
for (const pool of (process.env.POOLS ?? "").split(",").filter(Boolean)) {
  try {
    const sig = await send(conn, new Transaction().add(claimCreationSplitIx({
      config, pool: new PublicKey(pool), author: new PublicKey(preset.author), treasury: new PublicKey(preset.treasury),
    })), [payer]);
    console.log(`claim_creation_split ${pool}: ${sig}`);
  } catch (e: any) {
    console.log(`claim_creation_split ${pool}: ${e?.message?.split("\n")[0]}`);
  }
}
