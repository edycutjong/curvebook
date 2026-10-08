import { FormTable } from "@/components/FormTable";
import { Legend } from "@/components/Legend";
import { int, pct, short } from "@/lib/format";
import { groupForm, headline } from "@/lib/form";
import { MIN_CREATORS, MIN_WINDOWS } from "@/lib/constants";
import { getFormRows, getHealth } from "@/lib/queries";
import { OPEN_GRAPH } from "@/lib/site";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

// og:url only here: sub-pages inherit the layout's openGraph and must not claim the home URL.
export const metadata: Metadata = { openGraph: { ...OPEN_GRAPH, url: "/" } };

export default async function FormPage() {
  const [rows, { health, pools, windows }] = await Promise.all([getFormRows(), getHealth()]);
  const { ranked, unranked, presets } = groupForm(rows);
  const verdict = headline(ranked);
  const leading = unranked.slice(0, 25);

  return (
    <>
      <div className="pagehead">
        <h1>The Form</h1>
        <p className="dek">Meteora DBC curves, ranked by how much of the curve outside wallets take in the first ten slots.</p>
        <p className="capture">
          {health?.capture_start_slot != null ? (
            <>Indexed live from mainnet since slot <span className="mono">{int(health.capture_start_slot)}</span></>
          ) : (
            <>The indexer has not reported a capture start yet</>
          )}
          {" · "}<span className="mono">{int(pools)}</span> pools indexed · <span className="mono">{int(windows)}</span> windows final
        </p>
      </div>
      <Legend />

      {verdict && (
        <p className="verdict">
          The most-used config, <a href={`/config/${verdict.mostUsed.config}`}>{label(verdict.mostUsed)}</a> ({verdict.mostUsed.launches}{" "}
          launches), loses a median <strong className="mono">{pct(verdict.mostUsed.snp10P50)}</strong> of its curve to outside wallets in
          the first ten slots. The rank-1 config, <a href={`/config/${verdict.leader.config}`}>{label(verdict.leader)}</a>, loses{" "}
          <strong className="mono">{pct(verdict.leader.snp10P50)}</strong>
          {verdict.ratio != null && verdict.ratio > 1 ? `: ${verdict.ratio.toFixed(1)}× less.` : "."}
        </p>
      )}

      {ranked.length > 0 ? (
        <section aria-labelledby="ranked-h">
          <div className="section-head">
            <h2 id="ranked-h">Ranked</h2>
            <p>{ranked.length} configs with at least {MIN_WINDOWS} windows from {MIN_CREATORS} creators. Ties (=) share overlapping 90% intervals.</p>
          </div>
          <FormTable rows={ranked} ranked caption="Ranked DBC configs" />
        </section>
      ) : (
        <section aria-labelledby="leading-h">
          <div className="section-head">
            <h2 id="leading-h">Not yet ranked</h2>
            <p>Leading configs by launches</p>
          </div>
          <p className="note">
            No config has form yet. Ranking starts once a config has {MIN_WINDOWS} finished windows from at least {MIN_CREATORS} distinct
            creators. Until then these are the busiest configs seen since capture start, unranked.
          </p>
          {leading.length > 0 ? (
            <FormTable rows={leading} ranked={false} caption="Configs not yet ranked, by launches" />
          ) : (
            <p className="empty">No launch window has finished since capture start.</p>
          )}
        </section>
      )}

      <section aria-labelledby="presets-h">
        <div className="section-head">
          <h2 id="presets-h">Curvebook presets</h2>
          <p>Anti-sniper configs published by Curvebook; launch fees pay the preset&rsquo;s author</p>
        </div>
        {presets.length > 0 ? (
          <FormTable rows={presets} ranked caption="Curvebook presets" />
        ) : (
          <p className="empty">The Curvebook presets are not deployed to mainnet yet.</p>
        )}
      </section>

      {ranked.length > 0 && unranked.length > 0 && (
        <section aria-labelledby="thin-h">
          <div className="section-head">
            <h2 id="thin-h">Insufficient form (n &lt; {MIN_WINDOWS})</h2>
            <p>Fewer than {MIN_WINDOWS} finished windows, or fewer than {MIN_CREATORS} creators. Shown, never ranked.</p>
          </div>
          <FormTable rows={unranked.slice(0, 50)} ranked={false} caption="Configs with insufficient form" />
          {unranked.length > 50 && <p className="note">{unranked.length - 50} more configs with thinner form are not listed.</p>}
        </section>
      )}
    </>
  );
}

const label = (r: { config: string; preset: { name: string } | null }) => (r.preset ? r.preset.name : short(r.config));
