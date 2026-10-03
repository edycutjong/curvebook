// Load the committed mainnet snapshot into an empty database (CI e2e / Lighthouse only).
// The product never reads a snapshot: the live site reads the live index the worker writes.
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { readSnapshot } from "./lib/snapshot-io.js";

const url = process.env.DATABASE_URL ?? "postgres://curvebook:curvebook@localhost:5433/curvebook";
const sql = postgres(url, { ssl: /localhost|127\.0\.0\.1/.test(url) ? false : "require", onnotice: () => {} });
await sql.unsafe(readFileSync("db/schema.sql", "utf8"));
const { snap, file } = readSnapshot();
const ts = (s: number | null) => (s == null ? null : new Date(s * 1000));

await sql.begin(async (tx) => {
  for (const c of snap.configs as any[]) await tx`insert into configs ${tx({ ...c, base_fee: tx.json(c.base_fee) } as any)} on conflict do nothing`;
  for (const p of snap.pools as any[]) {
    await tx`insert into pools (address, config, creator, base_mint, create_sig, create_slot, created_at, activation_point, open_slot, graduated_slot, graduated_at, graduated_sig, source)
      values (${p.address}, ${p.config}, ${p.creator}, ${p.base_mint}, ${p.create_sig}, ${p.create_slot}, ${ts(p.created_at)}, ${p.activation_point},
        ${p.open_slot}, ${p.graduated_slot}, ${ts(p.graduated_at)}, ${p.graduated_sig}, 'snapshot') on conflict do nothing`;
  }
  for (const w of snap.windows as any[]) await tx`insert into pool_windows ${tx(w as any)} on conflict do nothing`;
  for (const b of snap.buys as any[]) await tx`insert into window_buys ${tx({ ...b, confirmed: true } as any)} on conflict do nothing`;
  await tx`insert into health (id, source, started_at, capture_start_slot, last_slot, chain_slot, lag_slots, pools_seen, windows_final)
    values (1, 'snapshot', now(), ${snap.captureStartSlot}, ${snap.endSlot}, ${snap.endSlot}, 0, ${snap.pools.length}, ${snap.windows.length})
    on conflict (id) do nothing`;
});
const { aggregate } = await import("../worker/src/agg.js");
const r = await aggregate(sql as any, Date.parse(snap.takenAt) / 1000);
console.log(`loaded ${file}: ${snap.pools.length} pools, ${snap.windows.length} windows, ${snap.buys.length} buys; ${r.configs} configs aggregated`);
await sql.end();
