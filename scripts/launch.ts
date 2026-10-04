// Launch on a preset through the product's own path: web API build → creator signs → web API send →
// worker relay lands it → receipt. Used for the author's own mainnet launches (labelled "own").
//   WEB=http://localhost:3002 KEYPAIR=~/.config/solana/curvebook-mainnet.json PRESET=slow-cliff \
//   NAME="…" SYMBOL=… URI=https://… BUY_SOL=0.01 npx tsx scripts/launch.ts
import { homedir } from "node:os";
import { VersionedTransaction } from "@solana/web3.js";
import { loadKeypair } from "./lib/deploy.js";

const WEB = process.env.WEB ?? "http://localhost:3000";
const creator = loadKeypair((process.env.KEYPAIR ?? "~/.config/solana/id.json").replace("~", homedir()));
const post = async (path: string, body: unknown) => {
  const r = await fetch(`${WEB}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json()) as any };
};

const built = await post("/api/launch/build", {
  preset: process.env.PRESET, wallet: creator.publicKey.toBase58(),
  name: process.env.NAME, symbol: process.env.SYMBOL, uri: process.env.URI, buySol: Number(process.env.BUY_SOL ?? 0.01),
});
if (built.status !== 200) throw new Error(`build ${built.status}: ${JSON.stringify(built.json)}`);
console.log(`built   pool ${built.json.pool} · expected ${built.json.quote.expectedOut} base atoms · fee ${built.json.quote.fee}`);
const tx = VersionedTransaction.deserialize(Buffer.from(built.json.tx, "base64"));
tx.sign([creator]);
const sent = await post("/api/launch/send", { tx: Buffer.from(tx.serialize()).toString("base64") });
if (sent.status !== 200) throw new Error(`send ${sent.status}: ${JSON.stringify(sent.json)}`);
console.log(`landed  ${sent.json.sig} · slot ${sent.json.landedSlot} · via ${sent.json.via}`);
console.log(`receipt ${WEB}/pool/${built.json.pool}`);
