// Groups config_stats rows into the Form's blocks. Pure.

export type FormRow = {
  config: string;
  launches: number;
  creators: number;
  topCreatorShare: number;
  snp10P50: number | null;
  ciLo: number | null;
  ciHi: number | null;
  medianStrip: number[] | null;
  gradRate: number | null;
  gradAged: number;
  tGradP50: number | null;
  eligible: boolean;
  rank: number | null;
  tied: boolean;
  preset: { name: string; slug: string } | null;
};

export type FormGroups = { ranked: FormRow[]; unranked: FormRow[]; presets: FormRow[] };

/**
 * ranked: eligible rows with a rank, presets included (★), by rank then launches.
 * unranked: everything else except presets, most launches first.
 * presets: every Curvebook preset, ranked ones first.
 */
export function groupForm(rows: readonly FormRow[]): FormGroups {
  const byLaunches = (a: FormRow, b: FormRow) => b.launches - a.launches || a.config.localeCompare(b.config);
  const isRanked = (r: FormRow) => r.eligible && r.rank != null;
  const ranked = rows.filter(isRanked).sort((a, b) => a.rank! - b.rank! || byLaunches(a, b));
  const unranked = rows.filter((r) => !isRanked(r) && !r.preset).sort(byLaunches);
  const presets = rows
    .filter((r) => r.preset)
    .sort((a, b) => Number(isRanked(b)) - Number(isRanked(a)) || (a.rank ?? 0) - (b.rank ?? 0) || byLaunches(a, b));
  return { ranked, unranked, presets };
}

export type Headline = { mostUsed: FormRow; leader: FormRow; ratio: number | null };

/** The one comparison worth a sentence: the busiest ranked config against rank 1. */
export function headline(ranked: readonly FormRow[]): Headline | null {
  if (ranked.length < 2) return null;
  const leader = ranked[0];
  const mostUsed = [...ranked].sort((a, b) => b.launches - a.launches)[0];
  if (mostUsed.config === leader.config || mostUsed.snp10P50 == null || leader.snp10P50 == null) return null;
  const ratio = leader.snp10P50 > 0 ? mostUsed.snp10P50 / leader.snp10P50 : null;
  return { mostUsed, leader, ratio };
}

/** Live-dot honesty: stale if the stream lags or the worker stopped writing. */
export function isLive(lagSlots: number | null, updatedAtIso: string | null, now: number = Date.now()): boolean {
  if (!updatedAtIso) return false;
  const t = Date.parse(updatedAtIso);
  if (Number.isNaN(t) || now - t > 60_000) return false;
  return lagSlots == null || lagSlots <= 20;
}
