// pnpm proof, step 1: freeze what the live index has captured into fixtures/ (a receipt of a live run).
import postgres from "postgres";
import { writeSnapshot, type Snapshot } from "./lib/snapshot-io.js";

const url = process.env.DATABASE_URL ?? "postgres://curvebook:curvebook@localhost:5433/curvebook";
const sql = postgres(url, { ssl: /localhost|127\.0\.0\.1/.test(url) ? false : "require", onnotice: () => {} });

const [h] = await sql`select capture_start_slot::float8 as start from health where id = 1`;
const [{ end }] = await sql`select coalesce(max(p.open_slot), 0)::float8 as end from pools p join pool_windows w on w.pool = p.address`;
const n = (v: any) => (v == null ? null : Number(v));

const pools = await sql`select p.address, p.config, p.creator, p.create_sig, p.create_slot::float8, p.open_slot::float8,
  extract(epoch from p.created_at)::float8 as created_at, extract(epoch from p.graduated_at)::float8 as graduated_at
  from pools p join pool_windows w on w.pool = p.address where p.open_slot <= ${end} order by p.create_slot`;
const windows = await sql`select w.pool, w.config, w.creator, w.snp10, w.per_slot, w.buys, w.complete
  from pool_windows w join pools p on p.address = w.pool where p.open_slot <= ${end}`;
const buys = await sql`select b.sig, b.pool, b.idx, b.slot::float8, b.slot_offset, b.payer, b.is_creator, b.base_out::text, b.quote_in::text
  from window_buys b join pool_windows w on w.pool = b.pool join pools p on p.address = b.pool where p.open_slot <= ${end} order by b.slot, b.sig, b.idx`;
const configs = await sql`select address, swap_base_amount::text, describe from configs where address in (select distinct config from pool_windows)`;
const stats = await sql`select config, launches, snp10_p50, rank from config_stats`;

const snap: Snapshot = {
  captureStartSlot: Number(h.start),
  endSlot: Number(end),
  takenAt: new Date().toISOString(),
  configs: configs as any,
  pools: pools.map((p: any) => ({ ...p, created_at: n(p.created_at), graduated_at: n(p.graduated_at) })),
  windows: windows as any,
  buys: buys as any,
  stats: stats as any,
};
const meta = writeSnapshot(snap);
console.log(`snapshot ${meta.file}  sha256 ${meta.sha256.slice(0, 16)}…  slots ${meta.captureStartSlot}–${meta.endSlot}`);
console.log(`  ${meta.counts.pools} pools · ${meta.counts.windows} windows · ${meta.counts.buys} window buys · ${meta.counts.configs} configs`);
await sql.end();
