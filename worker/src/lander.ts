// Lands a creator-signed launch transaction (D3 relay guard + D4 no-double-launch).
import { createHash } from "node:crypto";
import { VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import type { Sql } from "./db.js";
import type { Indexer } from "./indexer.js";
import type { Rpc } from "./rpc.js";

export type Beamer = (tx: VersionedTransaction) => Promise<string>;

export const messageHash = (message: Uint8Array) => createHash("sha256").update(message).digest("hex");

export class LandError extends Error {
  constructor(public status: number, message: string, public logs?: string[]) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function land(opts: {
  sql: Sql; rpc: Rpc; indexer: Indexer; beam: Beamer | null; ownWallets: Set<string>; txBase64: string; timeoutMs?: number;
}) {
  const { sql, rpc, indexer, beam } = opts;
  const raw = Buffer.from(opts.txBase64, "base64");
  const tx = VersionedTransaction.deserialize(raw);
  const hash = messageHash(tx.message.serialize());

  // D3: only a message this deployment issued, once, before it expires. Not an open relay.
  const issued = await sql`delete from issued_tx where hash = ${hash} and expires_at > now() returning *`;
  if (!issued.length) throw new LandError(403, "unknown or expired launch transaction; rebuild it");
  const it = issued[0];

  const sim: any = await rpc.call("simulateTransaction", [opts.txBase64, { encoding: "base64", sigVerify: true, commitment: "processed" }]);
  if (sim.value.err) throw new LandError(422, explainSimError(sim.value.err, sim.value.logs ?? []), sim.value.logs ?? []);

  const sig = bs58.encode(tx.signatures[0]);
  const send = async () => {
    if (beam) await beam(tx);
    else await rpc.call("sendTransaction", [opts.txBase64, { encoding: "base64", skipPreflight: true, maxRetries: 0 }]);
  };
  await send();

  // D4: resend the same signed bytes (same signature, so it cannot create twice) until landed or the blockhash expires.
  const deadline = Date.now() + (opts.timeoutMs ?? 45_000);
  let landedSlot: number | null = null;
  for (let i = 0; Date.now() < deadline; i++) {
    await sleep(1_000);
    const st: any = await rpc.call("getSignatureStatuses", [[sig], { searchTransactionHistory: false }]);
    const s = st.value[0];
    if (s?.err) throw new LandError(422, `transaction failed on-chain: ${JSON.stringify(s.err)}`);
    if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) {
      landedSlot = s.slot;
      break;
    }
    const height: number = await rpc.call("getBlockHeight", [{ commitment: "confirmed" }]);
    if (height > Number(it.last_valid_block_height)) throw new LandError(410, "expired: the blockhash ran out before the transaction landed; nothing was created");
    if (i % 2 === 1) await send().catch(() => {});
  }
  if (landedSlot == null) throw new LandError(504, "not confirmed within the time limit; check the signature before retrying", undefined);

  let swqos: unknown = null;
  if (beam) swqos = await fetch(`https://api.solami.dev/swqos/tx/${sig}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);

  await sql`insert into launches (pool, preset, wallet, base_mint, sig, landed_slot, via, swqos, third_party)
    values (${it.pool}, ${it.preset}, ${it.wallet}, ${it.base_mint}, ${sig}, ${landedSlot}, ${beam ? "beam" : "rpc"},
      ${swqos ? sql.json(swqos as any) : null}, ${!opts.ownWallets.has(it.wallet)})
    on conflict (pool) do nothing`;

  const confirmed = await rpc.getTransaction(sig);
  if (confirmed) await indexer.onTx(confirmed);
  indexer.watch(it.pool);
  return { sig, landedSlot, pool: it.pool, via: beam ? "beam" : "rpc", swqos };
}

/** Turn a simulation failure into words a creator can act on. */
export function explainSimError(err: unknown, logs: string[]): string {
  const text = logs.join("\n");
  if (/insufficient lamports|insufficient funds/i.test(text)) return "the wallet does not hold enough SOL for the creation fee, first buy and rent";
  if (/ExceededSlippage|slippage/i.test(text)) return "the first buy would get less than the quoted minimum; lower the buy amount and rebuild";
  if (/AccountAlreadyInUse|already in use/i.test(text)) return "this mint is already used; rebuild to get a fresh one";
  if (/BlockhashNotFound/i.test(JSON.stringify(err))) return "expired: the blockhash is gone; rebuild and sign again";
  const anchor = text.match(/Error Code: (\w+)\. Error Number: \d+\. Error Message: ([^\n]+)/);
  if (anchor) return `DBC rejected it: ${anchor[1]} (${anchor[2].trim()})`;
  return `simulation failed: ${JSON.stringify(err)}`;
}

