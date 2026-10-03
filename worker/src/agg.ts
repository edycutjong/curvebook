// AGG: per-config statistics, recomputed from finalized complete windows.
// scripts/recompute.ts runs the same core functions over a snapshot.
import { configStats, rankConfigs, type WindowRow } from "@curvebook/core";
import type { Sql } from "./db.js";

export async function loadWindowRows(sql: Sql): Promise<WindowRow[]> {
  const rows = await sql`
    select w.pool, w.config, w.creator, w.snp10, w.per_slot,
      extract(epoch from p.created_at)::float8 as created_at,
      extract(epoch from p.graduated_at)::float8 as graduated_at
    from pool_windows w join pools p on p.address = w.pool
    where w.complete`;
  return rows.map((r) => ({
    pool: r.pool, config: r.config, creator: r.creator, snp10: r.snp10, perSlot: r.per_slot,
    createdAt: r.created_at, graduatedAt: r.graduated_at,
  }));
}

export async function aggregate(sql: Sql, now = Date.now() / 1000) {
  const rows = await loadWindowRows(sql);
  const byConfig = new Map<string, WindowRow[]>();
  for (const r of rows) byConfig.set(r.config, [...(byConfig.get(r.config) ?? []), r]);
  const stats = [...byConfig].map(([c, rs]) => configStats(c, rs, now));
  const ranked = new Map(rankConfigs(stats).map((r) => [r.config, r]));
  await sql.begin(async (tx) => {
    for (const s of stats) {
      const r = ranked.get(s.config);
      await tx`
        insert into config_stats (config, launches, creators, top_creator_share, snp10_p50, snp10_p90, ci_lo, ci_hi, median_strip,
          grad_rate, grad_aged, t_grad_p50, eligible, rank, tied, updated_at)
        values (${s.config}, ${s.launches}, ${s.creators}, ${s.topCreatorShare}, ${s.snp10P50}, ${s.snp10P90}, ${s.ci90[0]}, ${s.ci90[1]},
          ${s.medianStrip}, ${s.gradRate}, ${s.gradAged}, ${s.tGradP50}, ${s.eligible}, ${r?.rank ?? null}, ${r?.tied ?? false}, now())
        on conflict (config) do update set launches = excluded.launches, creators = excluded.creators,
          top_creator_share = excluded.top_creator_share, snp10_p50 = excluded.snp10_p50, snp10_p90 = excluded.snp10_p90,
          ci_lo = excluded.ci_lo, ci_hi = excluded.ci_hi, median_strip = excluded.median_strip, grad_rate = excluded.grad_rate,
          grad_aged = excluded.grad_aged, t_grad_p50 = excluded.t_grad_p50, eligible = excluded.eligible, rank = excluded.rank,
          tied = excluded.tied, updated_at = now()`;
    }
  });
  return { configs: stats.length, ranked: ranked.size, windows: rows.length };
}
