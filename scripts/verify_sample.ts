// pnpm proof, step 3: 20 window buys chosen by the snapshot hash are re-fetched from mainnet and
// re-decoded; slot, payer (incl. the D5 parent-swap pairing) and base amount must match.
import { decodeTx, rng, seedFrom, type SwapEvent } from "@curvebook/core";
import { readSnapshot } from "./lib/snapshot-io.js";

const RPCS = (process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com,https://solana-rpc.publicnode.com").split(",");
const N = Number(process.env.SAMPLE ?? 20);
const { snap, sha256 } = readSnapshot(process.argv[2]);

async function getTx(sig: string, attempt = 0): Promise<any> {
  const url = RPCS[attempt % RPCS.length];
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [sig, { encoding: "json", maxSupportedTransactionVersion: 1, commitment: "confirmed" }] }) });
  if (r.status === 429 && attempt < 8) {
    await new Promise((s) => setTimeout(s, 800 * (attempt + 1)));
    return getTx(sig, attempt + 1);
  }
  return ((await r.json()) as any).result;
}

const r = rng(seedFrom(sha256));
const pool = [...snap.buys];
const picks: typeof snap.buys = [];
while (picks.length < Math.min(N, pool.length)) picks.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);

let ok = 0;
for (const b of picks) {
  const tx = await getTx(b.sig);
  const swaps = tx ? decodeTx(tx).filter((e): e is SwapEvent => e.kind === "swap" && e.pool === b.pool && e.tradeDirection === 1) : [];
  const s = swaps[b.idx] ?? swaps.find((x) => x.output.toString() === b.base_out);
  const match = !!s && s.slot === b.slot && s.payer === b.payer && s.output.toString() === b.base_out;
  if (match) ok++;
  console.log(`${match ? "✓" : "✗"} ${b.sig.slice(0, 20)}…  slot ${b.slot} (+${b.slot_offset})  payer ${String(b.payer).slice(0, 8)}…  ${b.is_creator ? "creator" : "outside"}`);
  await new Promise((s) => setTimeout(s, 300));
}
console.log(`\n${ok}/${picks.length} match (sample seeded by snapshot sha256 ${sha256.slice(0, 16)}…)`);
process.exit(ok === picks.length ? 0 : 1);
