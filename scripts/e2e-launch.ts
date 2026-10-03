// Full-stack launch test on localnet: web API build → creator signs → web API send → worker relay
// lands it → an outside wallet buys → the receipt API finalizes the window. Same code path as
// mainnet, minus the browser wallet (a keypair signs instead).
//   WEB=http://localhost:3000 LOCALNET_URL=http://127.0.0.1:8899 PRESET=slow-cliff npx tsx scripts/e2e-launch.ts
import { Connection, Keypair, LAMPORTS_PER_SOL, VersionedTransaction } from "@solana/web3.js";
import BN from "bn.js";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { send } from "./lib/deploy.js";

const WEB = process.env.WEB ?? "http://localhost:3000";
const conn = new Connection(process.env.LOCALNET_URL ?? "http://127.0.0.1:8899", "confirmed");
const preset = process.env.PRESET ?? "slow-cliff";
const step = (s: string) => console.log(`· ${s}`);
const fail = (s: string): never => { console.error(`✗ ${s}`); process.exit(1); };

async function funded(sol: number) {
  const kp = Keypair.generate();
  await conn.confirmTransaction(await conn.requestAirdrop(kp.publicKey, sol * LAMPORTS_PER_SOL), "confirmed");
  return kp;
}
const post = async (path: string, body: unknown) => {
  const r = await fetch(`${WEB}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json()) as any };
};

const creator = await funded(5);
const sniper = await funded(5);

const built = await post("/api/launch/build", { preset, wallet: creator.publicKey.toBase58(), name: "E2E Launch", symbol: "E2E", uri: "https://curvebook.test/e2e.json", buySol: 0.2 });
if (built.status !== 200) fail(`build ${built.status}: ${JSON.stringify(built.json)}`);
step(`built: pool ${built.json.pool}, expected ${built.json.quote.expectedOut} base atoms`);

// Relay guard: a transaction the server did not issue must be refused.
const forged = VersionedTransaction.deserialize(Buffer.from(built.json.tx, "base64"));
forged.message.recentBlockhash = Keypair.generate().publicKey.toBase58();
const refused = await post("/api/launch/send", { tx: Buffer.from(forged.serialize()).toString("base64") });
if (refused.status !== 403) fail(`relay guard let a forged tx through (${refused.status})`);
step("relay guard refused a transaction it did not issue (403)");

const tx = VersionedTransaction.deserialize(Buffer.from(built.json.tx, "base64"));
tx.sign([creator]);
const sent = await post("/api/launch/send", { tx: Buffer.from(tx.serialize()).toString("base64") });
if (sent.status !== 200) fail(`send ${sent.status}: ${JSON.stringify(sent.json)}`);
step(`landed: ${sent.json.sig} in slot ${sent.json.landedSlot} via ${sent.json.via}`);

const replay = await post("/api/launch/send", { tx: Buffer.from(tx.serialize()).toString("base64") });
if (replay.status !== 403) fail(`the same launch was accepted twice (${replay.status})`);
step("a second send of the same launch is refused (single-use)");

const dbc = new DynamicBondingCurveClient(conn, "confirmed");
const buyTx = await dbc.pool.swap({ owner: sniper.publicKey, pool: new (await import("@solana/web3.js")).PublicKey(built.json.pool), amountIn: new BN(LAMPORTS_PER_SOL / 2), minimumAmountOut: new BN(0), swapBaseForQuote: false, referralTokenAccount: null });
step(`outside buy: ${await send(conn, buyTx, [sniper])}`);

const deadline = Date.now() + 90_000;
while (Date.now() < deadline) {
  const r = await fetch(`${WEB}/api/pool/${built.json.pool}`);
  const j: any = await r.json();
  if (j.window) {
    step(`receipt final: SNP10 ${(j.window.snp10 * 100).toFixed(2)}%, ${j.window.buys} buys, complete=${j.window.complete}`);
    const outside = (j.buys ?? []).filter((b: any) => !b.is_creator);
    if (!outside.some((b: any) => b.payer === sniper.publicKey.toBase58())) fail("the outside buy is missing from the receipt");
    if (!(j.buys ?? []).some((b: any) => b.is_creator && b.payer === creator.publicKey.toBase58())) fail("the creator's first buy is missing");
    console.log("✓ e2e launch passed");
    process.exit(0);
  }
  await new Promise((s) => setTimeout(s, 1500));
}
fail("window did not finalize within 90 s");
