"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { VersionedTransaction } from "@solana/web3.js";
import { atoms, int, sol } from "@/lib/format";

type Quote = { expectedOut: string; minimumOut: string; fee: string };
type Step = "idle" | "building" | "signing" | "landing" | "landed";

const b64ToBytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const bytesToB64 = (b: Uint8Array) => btoa(Array.from(b, (x) => String.fromCharCode(x)).join(""));

async function post(path: string, body: unknown) {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `request failed (HTTP ${r.status})`);
  return j;
}

export function LaunchForm({ slug, tokenDecimals }: { slug: string; tokenDecimals: number | null }) {
  const router = useRouter();
  const { publicKey, signTransaction } = useWallet();
  const [step, setStep] = useState<Step>("idle");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [landedSlot, setLandedSlot] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = step === "building" || step === "signing" || step === "landing";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!publicKey || !signTransaction) return setError("connect a wallet first");
    const f = new FormData(e.currentTarget);
    setError(null);
    setQuote(null);
    setLandedSlot(null);
    try {
      setStep("building");
      const built = await post("/api/launch/build", {
        preset: slug,
        wallet: publicKey.toBase58(),
        name: f.get("name"),
        symbol: f.get("symbol"),
        uri: f.get("uri"),
        buySol: Number(f.get("buySol")),
      });
      setQuote(built.quote);

      setStep("signing");
      const tx = VersionedTransaction.deserialize(b64ToBytes(built.tx));
      const signed = await signTransaction(tx);

      setStep("landing");
      const landed = await post("/api/launch/send", { tx: bytesToB64(signed.serialize()) });
      setLandedSlot(landed.landedSlot ?? null);
      setStep("landed");
      setTimeout(() => router.push(`/pool/${landed.pool ?? built.pool}`), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("idle");
    }
  }

  const done = (s: Step) => ["idle", "building", "signing", "landing", "landed"].indexOf(step) > ["idle", "building", "signing", "landing", "landed"].indexOf(s);
  const dec = tokenDecimals ?? 6;

  return (
    <div className="launch-grid">
      <form onSubmit={onSubmit} className="box" aria-describedby="launch-steps">
        <WalletMultiButton />
        <div className="field">
          <label htmlFor="name">Name</label>
          <input id="name" name="name" required maxLength={32} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="symbol">Symbol</label>
          <input id="symbol" name="symbol" required maxLength={10} autoComplete="off" style={{ textTransform: "uppercase" }} />
        </div>
        <div className="field">
          <label htmlFor="uri">Metadata URI</label>
          <input id="uri" name="uri" type="url" required maxLength={200} pattern="https://.*" placeholder="https://" inputMode="url" />
          <span className="hint">The token&rsquo;s metadata JSON (name, symbol, image) at an https URL.</span>
        </div>
        <div className="field">
          <label htmlFor="buySol">First buy (SOL)</label>
          <input id="buySol" name="buySol" type="number" required min="0.000000001" max="5" step="any" defaultValue="0.1" inputMode="decimal" />
          <span className="hint">Bundled into the launch transaction, so it lands in slot 0.</span>
        </div>
        <button className="btn primary" type="submit" disabled={busy || !publicKey}>
          {busy ? "Working…" : "Sign & land"}
        </button>
        {!publicKey && <p className="hint small muted" style={{ margin: 0 }}>Connect a wallet to enable launching.</p>}
      </form>

      <div>
        <h3>Progress</h3>
        <ol className="steps" id="launch-steps" aria-live="polite">
          <li className={done("building") ? "" : "pending"}>built {done("building") ? "✓" : step === "building" ? "…" : ""}</li>
          <li className={done("signing") ? "" : "pending"}>signed {done("signing") ? "✓" : step === "signing" ? "… check your wallet" : ""}</li>
          <li className={done("landing") ? "" : "pending"}>
            landed {landedSlot != null ? `slot ${int(landedSlot)} ✓` : step === "landing" ? "… waiting for confirmation" : ""}
          </li>
        </ol>
        {quote && (
          <dl className="facts" style={{ marginTop: 20 }}>
            <dt>Expected</dt>
            <dd>{atoms(quote.expectedOut, dec)} tokens</dd>
            <dt>Minimum</dt>
            <dd>{atoms(quote.minimumOut, dec)} tokens</dd>
            <dt>Fee</dt>
            <dd>{sol(quote.fee, 6)} SOL</dd>
          </dl>
        )}
        {step === "landed" && <p className="note">Opening the receipt…</p>}
        {error && (
          <p className="error" role="alert" style={{ marginTop: 20 }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
