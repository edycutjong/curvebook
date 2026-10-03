// pnpm proof, step 2 (offline, no network): recompute every window's SNP10 from its buys and the
// config's swap_base_amount, then the Form from those windows, using the same core functions as
// the live aggregator. Exits 1 on any mismatch. Arithmetic check only — never a demo path.
import { configStats, rankConfigs, type WindowRow } from "@curvebook/core";
import { readSnapshot } from "./lib/snapshot-io.js";

const { snap, sha256, file } = readSnapshot(process.argv[2]);
const denom = new Map(snap.configs.map((c) => [c.address, BigInt(c.swap_base_amount)]));
const buysByPool = new Map<string, typeof snap.buys>();
for (const b of snap.buys) buysByPool.set(b.pool, [...(buysByPool.get(b.pool) ?? []), b]);

let mismatches = 0;
for (const w of snap.windows) {
  const nc = (buysByPool.get(w.pool) ?? []).filter((b) => !b.is_creator).reduce((a, b) => a + BigInt(b.base_out), 0n);
  const d = denom.get(w.config)!;
  const snp10 = Number((nc * 1_000_000_000n) / d) / 1e9;
  if (Math.abs(snp10 - w.snp10) > 1e-9) {
    mismatches++;
    console.log(`  window ${w.pool}: stored ${w.snp10} ≠ recomputed ${snp10}`);
  }
}

const poolMeta = new Map(snap.pools.map((p) => [p.address, p]));
const rows: WindowRow[] = snap.windows.filter((w) => w.complete).map((w) => ({
  pool: w.pool, config: w.config, creator: w.creator, snp10: w.snp10, perSlot: w.per_slot,
  createdAt: poolMeta.get(w.pool)?.created_at ?? 0, graduatedAt: poolMeta.get(w.pool)?.graduated_at ?? null,
}));
const byConfig = new Map<string, WindowRow[]>();
for (const r of rows) byConfig.set(r.config, [...(byConfig.get(r.config) ?? []), r]);
const now = Date.parse(snap.takenAt) / 1000;
const stats = [...byConfig].map(([c, rs]) => configStats(c, rs, now));
const ranked = rankConfigs(stats);

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
console.log(`recompute ${file} (sha256 ${sha256.slice(0, 16)}…), slots ${snap.captureStartSlot}–${snap.endSlot}, offline`);
console.log(`  ${snap.windows.length} windows re-derived from ${snap.buys.length} buys: ${mismatches === 0 ? "all match" : `${mismatches} MISMATCH`}`);
console.log(`  ${stats.length} configs, ${ranked.length} eligible (≥20 complete windows, ≥5 creators)\n`);
console.log("RANK  CONFIG                                        LNCH  CRTR  SNP10 p50  [90% CI]            p90");
for (const r of ranked.slice(0, 15)) {
  console.log(`${(r.tied ? "=" : "") + r.rank}`.padEnd(6) + r.config.padEnd(46) + `${r.launches}`.padStart(4) + `${r.creators}`.padStart(6) +
    pct(r.snp10P50).padStart(11) + `  [${pct(r.ci90[0])}, ${pct(r.ci90[1])}]`.padEnd(22) + pct(r.snp10P90).padStart(7));
}
const top = [...stats].sort((a, b) => b.launches - a.launches)[0];
if (top) console.log(`\nmost-used config ${top.config}: ${top.launches} launches, SNP10 p50 ${pct(top.snp10P50)}${top.eligible ? "" : " (not yet eligible)"}`);

// The live page must show the same numbers for the same data.
let statMismatch = 0;
for (const s of snap.stats) {
  const mine = stats.find((x) => x.config === s.config);
  if (mine && s.snp10_p50 != null && mine.launches === s.launches && Math.abs(mine.snp10P50 - s.snp10_p50) > 1e-12) statMismatch++;
}
console.log(`live config_stats vs recomputed (same launch count): ${statMismatch === 0 ? "identical" : `${statMismatch} differ`}`);
process.exit(mismatches || statMismatch ? 1 : 0);
