// Claim partner fees on wallet-claimer presets (mainnet presets before the router moves there):
// the pool-creation fee of each launch, and accrued partner trading fees, via the Meteora DBC SDK.
//   KEYPAIR=~/.config/solana/curvebook-mainnet.json POOLS=a,b,c RPC_URL=… npx tsx scripts/claim-wallet.ts
import { homedir } from "node:os";
import { Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { loadKeypair, send } from "./lib/deploy.js";

const conn = new Connection(process.env.RPC_URL ?? "http://127.0.0.1:8899", "confirmed");
const dbc = new DynamicBondingCurveClient(conn, "confirmed");
const me = loadKeypair((process.env.KEYPAIR ?? "~/.config/solana/id.json").replace("~", homedir()));
for (const p of (process.env.POOLS ?? "").split(",").filter(Boolean)) {
  const pool = new PublicKey(p);
  try {
    const tx = await dbc.partner.claimPartnerPoolCreationFee({ pool, feeReceiver: me.publicKey });
    console.log(`creation fee ${p.slice(0, 6)}: ${await send(conn, tx, [me])}`);
  } catch (e: any) { console.log(`creation fee ${p.slice(0, 6)}: ${e?.message?.split("\n")[0]}`); }
  const fb = await dbc.state.getPoolFeeBreakdown(pool);
  const unclaimed = BigInt(fb.partner.unclaimedQuoteFee.toString());
  if (unclaimed > 0n) {
    const tx = await dbc.partner.claimPartnerTradingFee({ feeClaimer: me.publicKey, payer: me.publicKey, pool, maxBaseAmount: new BN(0), maxQuoteAmount: new BN(unclaimed.toString()) });
    console.log(`trading fee ${p.slice(0, 6)}: ${unclaimed} lamports → ${await send(conn, tx, [me])}`);
  } else console.log(`trading fee ${p.slice(0, 6)}: nothing accrued`);
}
