import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SlotStrip } from "@/components/SlotStrip";
import { Snp } from "@/components/FormTable";
import { configView } from "@/lib/config-view";
import { age, bps, int, pct, rankLabel, short, sol, solscanAccount } from "@/lib/format";
import { MIN_CREATORS, MIN_WINDOWS } from "@/lib/constants";
import { getConfig } from "@/lib/queries";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ address: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { address } = await params;
  return { title: `Config ${short(address)}` };
}

export default async function ConfigPage({ params }: Props) {
  const { address } = await params;
  const data = await getConfig(address);
  if (!data) notFound();
  const { config, stats, windows, counts, preset } = data;
  const view = configView(config.address, config.raw_b64, config.describe);
  const p50 = stats?.snp10P50 ?? null;

  return (
    <>
      <div className="pagehead">
        <p className="capture">
          <Link href="/">The Form</Link> / config
        </p>
        <h1>{preset ? preset.name : short(config.address, 6)}</h1>
        <p className="capture mono" style={{ overflowWrap: "anywhere" }}>
          <a href={solscanAccount(config.address)} rel="noreferrer" target="_blank">{config.address}</a>
        </p>
      </div>

      <div className="headline">
        <div>
          <div className={`bignum ${p50 == null ? "" : p50 > 0 ? "sniped" : "held"}`}>{p50 == null ? "—" : pct(p50)}</div>
          <p className="bignum-label">Median SNP10{stats?.ciLo != null && stats.launches > 1 ? ` · 90% CI ${pct(stats.ciLo)}–${pct(stats.ciHi)}` : ""}</p>
        </div>
        <div>
          {stats?.medianStrip ? (
            <SlotStrip shares={stats.medianStrip} final size="md" label="median 10-slot strip" />
          ) : (
            <p className="muted">No finished window yet.</p>
          )}
          <p className="bignum-label">
            {stats?.eligible && stats.rank != null ? `Rank ${rankLabel(stats.rank, stats.tied)}` : `Not ranked: needs ${MIN_WINDOWS} windows from ${MIN_CREATORS} creators`}
          </p>
        </div>
        <dl className="stats" style={{ marginTop: 0 }}>
          <div><dt>LNCH</dt><dd>{int(counts.windows)}</dd></div>
          <div><dt>Pools seen</dt><dd>{int(counts.pools)}</dd></div>
          <div><dt>Creators</dt><dd>{int(stats?.creators ?? 0)}</dd></div>
          <div><dt>GRAD</dt><dd>{stats?.gradRate == null ? "—" : pct(stats.gradRate)}</dd></div>
        </dl>
      </div>

      <div className="two-col">
        <section aria-labelledby="readout-h">
          <h2 id="readout-h">What this curve does</h2>
          <ul className="readout">
            {view.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>

          {view.toll && (
            <div style={{ marginTop: 28 }}>
              <h3>Toll in the first ten {view.unit}s</h3>
              <p className="note" style={{ marginTop: 4 }}>Base fee in bps by {view.unit} after activation, formula from the on-chain config.</p>
              <div className="toll scroll-x">
                <table className="ruled">
                  <thead>
                    <tr>
                      <th scope="row">{view.unit === "slot" ? "Slot" : "Sec"}</th>
                      {view.toll.map((_, i) => (
                        <th scope="col" key={i}>+{i}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row">bps</th>
                      {view.toll.map((b, i) => (
                        <td key={i}>{int(b)}</td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        <aside>
          {preset ? (
            <div className="box" aria-labelledby="royalty-h">
              <h3 id="royalty-h">{preset.vault === preset.author ? "Fee claimer" : "Royalty split"}</h3>
              {preset.vault === preset.author ? (
                <dl className="facts">
                  <dt>Partner fees</dt>
                  <dd>accrue to the author <a href={solscanAccount(preset.author)} target="_blank" rel="noreferrer">{short(preset.author)}</a></dd>
                  <dt>On-chain split</dt>
                  <dd>curvebook_router — {process.env.NEXT_PUBLIC_ROUTER_NETWORK ?? "localnet"}</dd>
                  <dt>Creation fee</dt>
                  <dd>{sol(config.pool_creation_fee)} SOL</dd>
                </dl>
              ) : (
              <dl className="facts">
                <dt>Author</dt>
                <dd>{bps(preset.author_bps)} · <a href={solscanAccount(preset.author)} target="_blank" rel="noreferrer">{short(preset.author)}</a></dd>
                <dt>Treasury</dt>
                <dd>{bps(10_000 - preset.author_bps)}</dd>
                <dt>Vault</dt>
                <dd><a href={solscanAccount(preset.vault)} target="_blank" rel="noreferrer">{short(preset.vault, 6)}</a></dd>
                <dt>Creation fee</dt>
                <dd>{sol(config.pool_creation_fee)} SOL</dd>
              </dl>
              )}
              <Link className="btn primary" href={`/launch/${preset.slug}`}>Launch on this preset</Link>
            </div>
          ) : (
            <div className="box">
              <h3>Fork-ready params</h3>
              <p className="small muted" style={{ margin: 0 }}>Decoded from the on-chain PoolConfig account. Amounts are integer atoms.</p>
              {view.json ? <pre className="json" tabIndex={0} aria-label="Decoded config JSON">{view.json}</pre> : <p>Decoding failed for this account.</p>}
            </div>
          )}
        </aside>
      </div>

      <section aria-labelledby="formline-h" style={{ marginTop: 48 }}>
        <div className="section-head">
          <h2 id="formline-h">Form line</h2>
          <p>Last {windows.length} finished launches, newest first</p>
        </div>
        {windows.length === 0 ? (
          <p className="empty">No launch on this config has a finished window since capture start.</p>
        ) : (
          <ol className="formline">
            {windows.map((w) => (
              <li key={w.pool}>
                <Link href={`/pool/${w.pool}`} title={`Receipt for ${w.pool}`}>{short(w.pool)}</Link>
                <span className="muted">{age(w.created_at)}</span>
                <SlotStrip shares={w.per_slot} final size="md" label={`strip for pool ${short(w.pool)}`} />
                <span>
                  <Snp value={w.snp10} />
                  {w.graduated_at && <span title="graduated"> · GRAD ✓</span>}
                  {!w.complete && <span className="muted" title="some slots could not be confirmed"> · partial</span>}{" "}
                  <a href={solscanAccount(w.pool)} target="_blank" rel="noreferrer" aria-label={`Pool ${short(w.pool)} on Solscan`}>↗</a>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
