import { retrying } from "@/lib/retry";
import "server-only";
import { sql, plain } from "./db";
import type { FormRow } from "./form";

export type Health = {
  source: string;
  started_at: string;
  capture_start_slot: number | null;
  last_slot: number | null;
  chain_slot: number | null;
  lag_slots: number | null;
  reconnects: number;
  last_from_slot: number | null;
  pools_seen: number;
  windows_final: number;
  windows_incomplete: number;
  skipped_transfer_hook: number;
  rpc_errors: number;
  updated_at: string;
};

export type HealthWithCounts = { health: Health | null; pools: number; windows: number; configs: number };

export const getHealth = retrying(async function getHealth(): Promise<HealthWithCounts> {
  const [[h], [c]] = await Promise.all([
    sql`select * from health where id = 1`,
    sql`select (select count(*) from pools) as pools,
               (select count(*) from pool_windows) as windows,
               (select count(*) from config_stats) as configs`,
  ]);
  const counts = plain<{ pools: number; windows: number; configs: number }>(c);
  return { health: h ? plain<Health>(h) : null, ...counts };
});

export type Preset = {
  config: string;
  name: string;
  slug: string;
  author: string;
  author_bps: number;
  vault: string;
  create_sig: string | null;
  register_sig: string | null;
  network: string;
};

export const getPresets = retrying(async function getPresets(): Promise<Preset[]> {
  const rows = await sql`select config, name, slug, author, author_bps, vault, create_sig, register_sig, network
    from presets order by name`;
  return plain<Preset[]>(rows);
});

export const getFormRows = retrying(async function getFormRows(): Promise<FormRow[]> {
  // Presets with no finished window yet still get a row (launches 0) so the presets block is complete.
  const rows = await sql`
    select coalesce(s.config, p.config) as config, coalesce(s.launches, 0) as launches, coalesce(s.creators, 0) as creators,
      coalesce(s.top_creator_share, 0) as top_creator_share, s.snp10_p50, s.ci_lo, s.ci_hi, s.median_strip,
      s.grad_rate, coalesce(s.grad_aged, 0) as grad_aged, s.t_grad_p50, coalesce(s.eligible, false) as eligible,
      s.rank, coalesce(s.tied, false) as tied, p.name as preset_name, p.slug as preset_slug
    from config_stats s full outer join presets p on p.config = s.config`;
  return rows.map((r) => ({
    config: r.config,
    launches: Number(r.launches),
    creators: Number(r.creators),
    topCreatorShare: Number(r.top_creator_share),
    snp10P50: r.snp10_p50,
    ciLo: r.ci_lo,
    ciHi: r.ci_hi,
    medianStrip: r.median_strip,
    gradRate: r.grad_rate,
    gradAged: Number(r.grad_aged),
    tGradP50: r.t_grad_p50,
    eligible: r.eligible,
    rank: r.rank,
    tied: r.tied,
    preset: r.preset_slug ? { name: r.preset_name, slug: r.preset_slug } : null,
  }));
});

export type ConfigRow = {
  address: string;
  fee_claimer: string;
  quote_mint: string;
  activation_type: number;
  swap_base_amount: string;
  migration_quote_threshold: string;
  pool_creation_fee: string;
  describe: string[];
  raw_b64: string;
  first_seen_slot: number | null;
};

export type WindowLine = {
  pool: string;
  create_sig: string;
  created_at: string | null;
  graduated_at: string | null;
  snp10: number;
  per_slot: number[];
  complete: boolean;
  buys: number;
};

export const getConfig = retrying(async function getConfig(address: string) {
  const [[cfg], rows, [counts], presetRows] = await Promise.all([
    sql`select address, fee_claimer, quote_mint, activation_type, swap_base_amount, migration_quote_threshold,
          pool_creation_fee, describe, raw_b64, first_seen_slot from configs where address = ${address}`,
    sql`select w.pool, p.create_sig, p.created_at, p.graduated_at, w.snp10, w.per_slot, w.complete, w.buys
        from pool_windows w join pools p on p.address = w.pool
        where w.config = ${address} order by p.create_slot desc limit 20`,
    sql`select (select count(*) from pools where config = ${address}) as pools,
               (select count(*) from pool_windows where config = ${address}) as windows,
               (select count(*) from pool_windows where config = ${address} and complete) as complete`,
    sql`select config, name, slug, author, author_bps, vault, create_sig, register_sig, network from presets where config = ${address}`,
  ]);
  if (!cfg) return null;
  const stats = (await getFormRows()).find((r) => r.config === address) ?? null;
  return {
    config: plain<ConfigRow>(cfg),
    stats,
    windows: plain<WindowLine[]>(rows),
    counts: plain<{ pools: number; windows: number; complete: number }>(counts),
    preset: presetRows[0] ? plain<Preset>(presetRows[0]) : null,
  };
});

export type PoolRow = {
  address: string;
  config: string;
  creator: string;
  base_mint: string;
  create_sig: string;
  create_slot: number;
  created_at: string | null;
  open_slot: number | null;
  graduated_at: string | null;
  graduated_sig: string | null;
  source: string;
};

export type BuyRow = {
  sig: string;
  idx: number;
  slot: number;
  slot_offset: number;
  payer: string | null;
  is_creator: boolean;
  via_cpi: boolean;
  quote_in: string;
  fee: string;
  base_out: string;
  confirmed: boolean;
};

export type PoolWindowRow = {
  snp10: number;
  per_slot: number[];
  nc_wallets: number;
  top3_share: number;
  buys: number;
  complete: boolean;
  finalized_at: string;
};

export type LaunchRow = {
  pool: string;
  preset: string;
  wallet: string;
  base_mint: string;
  sig: string;
  landed_slot: number | null;
  via: string;
  third_party: boolean;
  created_at: string;
};

export type PoolPayload = {
  pool: PoolRow;
  swapBaseAmount: string | null;
  quoteMint: string | null;
  buys: BuyRow[];
  window: PoolWindowRow | null;
  launch: LaunchRow | null;
};

export const getPool = retrying(async function getPool(address: string): Promise<PoolPayload | null> {
  const [[pool], buys, [win], [launch]] = await Promise.all([
    sql`select p.address, p.config, p.creator, p.base_mint, p.create_sig, p.create_slot, p.created_at, p.open_slot,
          p.graduated_at, p.graduated_sig, p.source, c.swap_base_amount, c.quote_mint
        from pools p left join configs c on c.address = p.config where p.address = ${address}`,
    sql`select sig, idx, slot, slot_offset, payer, is_creator, via_cpi, quote_in, fee, base_out, confirmed
        from window_buys where pool = ${address} order by slot, sig, idx`,
    sql`select snp10, per_slot, nc_wallets, top3_share, buys, complete, finalized_at from pool_windows where pool = ${address}`,
    sql`select pool, preset, wallet, base_mint, sig, landed_slot, via, third_party, created_at from launches where pool = ${address}`,
  ]);
  if (!pool) return null;
  const { swap_base_amount, quote_mint, ...rest } = plain<PoolRow & { swap_base_amount: string | null; quote_mint: string | null }>(pool);
  return {
    pool: rest,
    swapBaseAmount: swap_base_amount,
    quoteMint: quote_mint,
    buys: plain<BuyRow[]>(buys),
    window: win ? plain<PoolWindowRow>(win) : null,
    launch: launch ? plain<LaunchRow>(launch) : null,
  };
});

export type EventRow = {
  id: number;
  kind: string;
  slot: number;
  sig: string;
  pool: string | null;
  config: string | null;
  payer: string | null;
  source: string;
  seen_at: string;
};

export const getEvents = retrying(async function getEvents(limit: number = 50): Promise<EventRow[]> {
  const n = Math.min(200, Math.max(1, Math.trunc(limit) || 50));
  const rows = await sql`select id, kind, slot, sig, pool, config, payer, source, seen_at from events order by id desc limit ${n}`;
  return plain<EventRow[]>(rows);
});

export const getLaunches = retrying(async function getLaunches(limit: number = 50): Promise<(LaunchRow & { preset_name: string | null })[]> {
  const rows = await sql`select l.pool, l.preset, l.wallet, l.base_mint, l.sig, l.landed_slot, l.via, l.third_party, l.created_at,
      p.name as preset_name
    from launches l left join presets p on p.config = l.preset order by l.created_at desc limit ${limit}`;
  return plain(rows);
});

export const getPresetBySlug = retrying(async function getPresetBySlug(slug: string) {
  const [row] = await sql`select p.config, p.name, p.slug, p.author, p.author_bps, p.vault, p.create_sig, p.register_sig, p.network,
      c.pool_creation_fee, c.quote_mint, c.raw_b64
    from presets p left join configs c on c.address = p.config where p.slug = ${slug}`;
  return row ? plain<Preset & { pool_creation_fee: string | null; quote_mint: string | null; raw_b64: string | null }>(row) : null;
});

export type JudgeFacts = {
  health: Health | null;
  pools: number;
  configs: number;
  buys: number;
  receiptPool: string | null;
  topConfig: { config: string; launches: number; name: string | null } | null;
};

/** Everything /judge prints, in one round trip per figure. No figure is computed outside the DB. */
export const getJudgeFacts = retrying(async function getJudgeFacts(): Promise<JudgeFacts> {
  const [[h], [c], [receipt], [top]] = await Promise.all([
    sql`select * from health where id = 1`,
    sql`select (select count(*) from pools) as pools,
               (select count(distinct config) from pools) as configs,
               (select count(*) from window_buys) as buys`,
    sql`select w.pool from pool_windows w join pools p on p.address = w.pool
        where w.snp10 > 0 order by p.create_slot desc limit 1`,
    sql`select p.config, count(*) as launches, max(pr.name) as name from pools p
        left join presets pr on pr.config = p.config
        group by p.config order by count(*) desc, p.config limit 1`,
  ]);
  const counts = plain<{ pools: number; configs: number; buys: number }>(c);
  return {
    health: h ? plain<Health>(h) : null,
    ...counts,
    receiptPool: receipt ? (receipt.pool as string) : null,
    topConfig: top ? plain<{ config: string; launches: number; name: string | null }>(top) : null,
  };
});
