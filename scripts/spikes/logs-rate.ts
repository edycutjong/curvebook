// Measure DBC activity on the public mainnet WebSocket (logsSubscribe), keyless.
import { Connection, PublicKey } from "@solana/web3.js";
const conn = new Connection(process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com", { wsEndpoint: process.env.WS_URL ?? "wss://api.mainnet-beta.solana.com", commitment: "confirmed" });
const secs = Number(process.env.SECS ?? 60);
const counts: Record<string, number> = {};
let txs = 0;
conn.onLogs(new PublicKey("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"), (l) => {
  if (l.err) return;
  txs++;
  for (const line of l.logs) {
    const m = line.match(/^Program log: Instruction: (\w+)/);
    if (m) counts[m[1]] = (counts[m[1]] ?? 0) + 1;
  }
}, "confirmed");
setTimeout(() => { console.log({ secs, txs, perSec: (txs / secs).toFixed(1), counts }); process.exit(0); }, secs * 1000);
