import type { Metadata } from "next";
import { MIN_CREATORS, MIN_WINDOWS, WINDOW_SLOTS } from "@/lib/constants";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Method" };

export default function AboutPage() {
  const repo = process.env.NEXT_PUBLIC_REPO_URL;
  return (
    <div className="prose">
      <div className="pagehead">
        <h1>Method</h1>
        <p className="dek">One number per launch, defined once and frozen, so any reader can recompute it from mainnet.</p>
      </div>

      <h2>The window</h2>
      <p>
        Each pool is measured over {WINDOW_SLOTS} slots, <code>s_open</code> through <code>s_open + {WINDOW_SLOTS - 1}</code>.
      </p>
      <ul>
        <li>Slot activation: <code>s_open = max(creation slot, activation point)</code>.</li>
        <li>Timestamp activation: <code>s_open</code> is the slot of the first swap at or after the activation time.</li>
      </ul>

      <h2>SNP10</h2>
      <p>
        <code>SNP10 = Σ base tokens bought by non-creator payers in the window ÷ swap_base_amount</code>, where{" "}
        <code>swap_base_amount</code> is the sellable supply on the curve, read from the pool&rsquo;s <code>PoolConfig</code>.
      </p>
      <ul>
        <li>
          The payer of a buy is the <code>payer</code> account of the DBC swap instruction that emitted the event. <code>EvtSwap2</code>{" "}
          carries no payer field, so the emitting instruction is located by its stack height.
        </li>
        <li>A buy whose payer cannot be paired with an instruction is counted as non-creator.</li>
        <li>Windows are finalized from confirmed signatures only; a window with unconfirmable signatures is marked partial.</li>
      </ul>

      <h2>Ranking</h2>
      <ul>
        <li>A config is ranked by its median SNP10 once it has at least {MIN_WINDOWS} complete windows from at least {MIN_CREATORS} distinct creators.</li>
        <li>Each median carries a 90% bootstrap confidence interval with a fixed seed, so reruns agree.</li>
        <li>Configs whose intervals overlap share a rank, shown as <code>=3</code>.</li>
      </ul>

      <h2>Limits</h2>
      <p>
        A creator who funds fresh wallets and buys through them looks like an outsider. SNP10 counts those wallets as non-creator, so it
        measures supply taken by anyone other than the creator&rsquo;s own signing wallet, not proven third-party snipers.
      </p>
      <p>Nothing is shown from before the indexer&rsquo;s capture start slot; history accumulates from that slot forward.</p>

      {repo && (
        <p>
          Source and the recompute script: <a href={repo}>{repo.replace(/^https?:\/\//, "")}</a>.
        </p>
      )}
    </div>
  );
}
