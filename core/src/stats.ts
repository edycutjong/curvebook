// Per-config statistics for the Form. Pure and deterministic: the live aggregator
// and scripts/recompute.ts call the same functions, so their numbers must agree.
import { MIN_CREATORS, MIN_WINDOWS } from "./constants.js";

export type WindowRow = {
  pool: string;
  config: string;
  creator: string;
  snp10: number;
  perSlot: number[];
  createdAt: number; // unix seconds
  graduatedAt: number | null; // unix seconds
};

export type ConfigStats = {
  config: string;
  launches: number;
  creators: number;
  topCreatorShare: number; // share of launches by the most active creator
  snp10P50: number;
  snp10P90: number;
  ci90: [number, number]; // bootstrap 90% CI of the median
  medianStrip: number[];
  gradRate: number | null; // among pools aged ≥ 24 h
  gradAged: number;
  tGradP50: number | null; // seconds
  eligible: boolean;
};

/** Linear-interpolated quantile (R type 7) of an unsorted array. */
export function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export const median = (xs: number[]) => quantile(xs, 0.5);

/** FNV-1a 32-bit: a stable seed from any string (snapshot hash, config address). */
export function seedFrom(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** mulberry32: small, seeded PRNG so bootstrap CIs are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Percentile bootstrap CI of the median. */
export function bootstrapMedianCI(xs: number[], seed: number, resamples = 1000, level = 0.9): [number, number] {
  if (xs.length === 0) return [NaN, NaN];
  const r = rng(seed);
  const meds: number[] = [];
  const buf = new Array<number>(xs.length);
  for (let i = 0; i < resamples; i++) {
    for (let j = 0; j < xs.length; j++) buf[j] = xs[Math.floor(r() * xs.length)];
    meds.push(median(buf));
  }
  const a = (1 - level) / 2;
  return [quantile(meds, a), quantile(meds, 1 - a)];
}

const DAY = 86_400;

export function configStats(config: string, rows: WindowRow[], now: number, seed = 0): ConfigStats {
  const snps = rows.map((r) => r.snp10);
  const byCreator = new Map<string, number>();
  for (const r of rows) byCreator.set(r.creator, (byCreator.get(r.creator) ?? 0) + 1);
  const aged = rows.filter((r) => now - r.createdAt >= DAY);
  const grads = aged.filter((r) => r.graduatedAt != null);
  const tGrad = rows.filter((r) => r.graduatedAt != null).map((r) => r.graduatedAt! - r.createdAt);
  const strip = Array.from({ length: rows[0]?.perSlot.length ?? 10 }, (_, k) => median(rows.map((r) => r.perSlot[k] ?? 0)));
  const launches = rows.length;
  const creators = byCreator.size;
  return {
    config,
    launches,
    creators,
    topCreatorShare: launches ? Math.max(...byCreator.values()) / launches : 0,
    snp10P50: median(snps),
    snp10P90: quantile(snps, 0.9),
    ci90: bootstrapMedianCI(snps, seed ^ seedFrom(config)),
    medianStrip: launches ? strip : [],
    gradRate: aged.length ? grads.length / aged.length : null,
    gradAged: aged.length,
    tGradP50: tGrad.length ? median(tGrad) : null,
    eligible: launches >= MIN_WINDOWS && creators >= MIN_CREATORS,
  };
}

/**
 * Rank eligible configs by SNP10 median, ascending (fewer outsider buys first).
 * Configs whose 90% CIs overlap the previous rank share it: a tie is declared, not hidden.
 */
export function rankConfigs(stats: ConfigStats[]): (ConfigStats & { rank: number; tied: boolean })[] {
  const elig = stats.filter((s) => s.eligible).sort((a, b) => a.snp10P50 - b.snp10P50 || b.launches - a.launches);
  const out: (ConfigStats & { rank: number; tied: boolean })[] = [];
  elig.forEach((s, i) => {
    const prev = out[i - 1];
    const tied = !!prev && s.ci90[0] <= prev.ci90[1];
    out.push({ ...s, rank: tied ? prev.rank : i + 1, tied });
    if (tied) prev.tied = true;
  });
  return out;
}
