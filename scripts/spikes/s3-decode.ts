// Spike S3: fetch recent mainnet DBC transactions and decode their events.
// Saves one create, one direct swap and one CPI-routed swap to core/test/fixtures/.
import { writeFileSync, mkdirSync } from "node:fs";
import { decodeTx, instructionName, DBC_PROGRAM_ID } from "@curvebook/core";

const RPC = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
async function rpc(method: string, params: unknown[]) {
  for (let i = 0; i < 6; i++) {
    const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    if (r.status === 429) { await new Promise((s) => setTimeout(s, 1500 * (i + 1))); continue; }
    const j: any = await r.json();
    if (j.error) throw new Error(JSON.stringify(j.error));
    return j.result;
  }
  throw new Error("rate limited");
}

const sigs: any[] = [];
let before: string | undefined;
for (let p = 0; p < Number(process.env.PAGES ?? 6); p++) {
  const page: any[] = await rpc("getSignaturesForAddress", [DBC_PROGRAM_ID, { limit: 1000, before }]);
  sigs.push(...page);
  before = page.at(-1)?.signature;
}
const counts: Record<string, number> = {};
const saved: Record<string, string> = {};
mkdirSync("core/test/fixtures", { recursive: true });
let n = 0;
for (const s of sigs) {
  if (saved.init && saved["swap-cpi"] && saved.complete) break;
  if (++n % 200 === 0) console.log("scanned", n, counts);
  if (s.err) continue;
  const tx = await rpc("getTransaction", [s.signature, { encoding: "json", maxSupportedTransactionVersion: 1, commitment: "confirmed" }]);
  if (!tx) continue;
  const evs = decodeTx(tx);
  for (const e of evs) {
    const key = e.kind === "swap" ? `swap:${e.viaCpi ? "cpi" : "direct"}:${e.payer ? "paired" : "unpaired"}` : e.kind;
    counts[key] = (counts[key] ?? 0) + 1;
    const fx = e.kind === "swap" ? `swap-${e.viaCpi ? "cpi" : "direct"}` : e.kind;
    if (!saved[fx]) {
      saved[fx] = s.signature;
      writeFileSync(`core/test/fixtures/${fx}.json`, JSON.stringify(tx, null, 1));
      console.log(fx, s.signature, JSON.stringify(e, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
      const keys = tx.transaction.message.accountKeys;
      console.log("  signer:", keys[0], " top-level ixs:", tx.transaction.message.instructions.map((ix: any) => keys[ix.programIdIndex]?.slice(0, 6)).join(","));
    }
  }
  await new Promise((r) => setTimeout(r, 120));
}
console.log(counts);
