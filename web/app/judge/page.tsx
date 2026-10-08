import Link from "next/link";
import type { Metadata } from "next";
import { getJudgeFacts } from "@/lib/queries";
import { age, int, short } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Judges",
  description: "The 30-second path through Curvebook, the live receipt behind it, and how to reproduce every figure.",
};

const CLAIM =
  "Curvebook measures how much of every Meteora DBC launch outside wallets buy in its first ten slots, and lets you launch on a curve by that record.";

// Committed facts: each one is produced by a command in the repo, not by the live index.
const TESTS = "171 core · 225 worker · 254 web (100% line/branch coverage) · 8 Rust + 19 localnet program tests · 23 e2e; property checks over 30,000 windows and 20,000 fee schedules";
const LOCALNET =
  "slot+2 outside buy on Slow Cliff paid 3,381 bps vs creator 100 bps; same buys on Control paid 100 bps; partner fees decoded = SDK total (S8); creation fee split 70/30 on-chain";

export default async function JudgePage() {
  const f = await getJudgeFacts().catch(() => null);
  const h = f?.health ?? null;
  const links = [
    { label: "Repository", href: process.env.NEXT_PUBLIC_REPO_URL },
    { label: "Live app", href: process.env.NEXT_PUBLIC_SITE_URL },
    { label: "Demo video", href: process.env.NEXT_PUBLIC_VIDEO_URL },
    { label: "Pitch deck", href: process.env.NEXT_PUBLIC_DECK_URL },
  ].filter((l): l is { label: string; href: string } => Boolean(l.href));

  return (
    <div className="prose">
      <div className="pagehead">
        <h1>For judges</h1>
        <p className="dek">One claim, a 30-second path to check it, and the commands that reproduce it.</p>
      </div>

      <p className="verdict">{CLAIM}</p>

      <section aria-labelledby="path-h">
        <div className="section-head">
          <h2 id="path-h">30-second path</h2>
          <p>Five pages, in order</p>
        </div>
        <ol className="readout">
          <li>
            <span className="mono">1.</span> <Link href="/">The Form</Link>: every DBC config, ranked by SNP10.
          </li>
          <li>
            <span className="mono">2.</span>{" "}
            {f?.receiptPool ? (
              <>
                <Link href={`/pool/${f.receiptPool}`}>A live receipt</Link>: pool <span className="mono">{short(f.receiptPool)}</span>, the
                newest finalized window with outside buys.
              </>
            ) : (
              <span className="muted">A live receipt: no finalized window with outside buys yet.</span>
            )}
          </li>
          <li>
            <span className="mono">3.</span>{" "}
            {f?.topConfig ? (
              <>
                <Link href={`/config/${f.topConfig.config}`}>The most-launched config</Link>:{" "}
                <span className="mono">{f.topConfig.name ?? short(f.topConfig.config)}</span>, {int(f.topConfig.launches)} pools indexed.
              </>
            ) : (
              <span className="muted">The most-launched config: no pool indexed yet.</span>
            )}
          </li>
          <li>
            <span className="mono">4.</span> <Link href="/integrations/verify">Verify</Link>: the raw event feed and stream health.
          </li>
          <li>
            <span className="mono">5.</span> <Link href="/about">Method</Link>: SNP10, defined once and frozen.
          </li>
        </ol>
      </section>

      <section aria-labelledby="receipt-h">
        <div className="section-head">
          <h2 id="receipt-h">Receipt</h2>
          <p>{h ? `live from the index · updated ${age(h.updated_at)}` : "index unreachable"}</p>
        </div>
        {f ? (
          <dl className="stats">
            <div><dt>Capture start</dt><dd>{h ? int(h.capture_start_slot) : "—"}</dd></div>
            <div><dt>Pools indexed</dt><dd>{int(f.pools)}</dd></div>
            <div><dt>Windows final</dt><dd>{h ? int(h.windows_final) : "—"}</dd></div>
            <div><dt>Incomplete</dt><dd>{h ? int(h.windows_incomplete) : "—"}</dd></div>
            <div><dt>Distinct configs</dt><dd>{int(f.configs)}</dd></div>
            <div><dt>Window buys</dt><dd>{int(f.buys)}</dd></div>
            <div><dt>Stream lag</dt><dd>{h?.lag_slots == null ? "—" : `${int(h.lag_slots)} slots`}</dd></div>
            <div><dt>Source</dt><dd>{h?.source ?? "—"}</dd></div>
          </dl>
        ) : (
          <p className="empty">The index is unreachable from this server, so no live figure is shown.</p>
        )}
        <dl className="facts" style={{ marginTop: 24 }}>
          <dt>Tests</dt>
          <dd>{TESTS}</dd>
          <dt>Proof</dt>
          <dd>
            <code>pnpm proof</code>: windows re-derived offline, 20/20 sampled buys re-fetched from mainnet match
          </dd>
          <dt>Localnet</dt>
          <dd>{LOCALNET}</dd>
        </dl>
      </section>

      <section aria-labelledby="repro-h">
        <div className="section-head">
          <h2 id="repro-h">Reproduce</h2>
          <p>Keyless, against live mainnet</p>
        </div>
        <p className="note">Index and serve:</p>
        <pre className="json" tabIndex={0} aria-label="Run the indexer and the app">{`pnpm install && docker compose up -d db && pnpm worker
pnpm web`}</pre>
        <p className="note">Re-derive the windows and re-fetch a sample of buys from mainnet:</p>
        <pre className="json" tabIndex={0} aria-label="Run the proof">pnpm proof</pre>
        <p className="note">CI / localnet rehearsal:</p>
        <pre className="json" tabIndex={0} aria-label="Run the localnet rehearsal">{`bash scripts/localnet.sh
pnpm rehearse`}</pre>
      </section>

      <section aria-labelledby="limits-h">
        <div className="section-head">
          <h2 id="limits-h">Honest limitations</h2>
        </div>
        <ul className="readout">
          <li>The three presets are live on mainnet with one own launch each (DEMO.md §1b); the router that splits their fees runs on devnet (DEMO.md §3b), not on mainnet yet.</li>
          <li>The index covers only launches since capture start; nothing earlier is backfilled.</li>
          <li>Creator-funded sybil wallets count as outsiders.</li>
          <li>The live worker runs keyless on public RPC today; the RPC Fast Yellowstone gRPC source is wired and switches on with GRPC_URL.</li>
        </ul>
      </section>

      {links.length > 0 && (
        <section aria-labelledby="links-h">
          <div className="section-head">
            <h2 id="links-h">Links</h2>
          </div>
          <ul className="links">
            {links.map((l) => (
              <li key={l.label}>
                <a href={l.href}>{l.label} ↗</a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
