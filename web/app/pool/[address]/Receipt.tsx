"use client";
import { useEffect, useState } from "react";
import { SlotStrip } from "@/components/SlotStrip";
import { beamReceipt, int, pct, short, solscanAccount, solscanTx } from "@/lib/format";
import { buyLines } from "@/lib/receipt";
import { perSlotFromBuys } from "@/lib/strip";
import type { PoolPayload } from "@/lib/queries";

const POLL_MS = 1500;

export function Receipt({ initial }: { initial: PoolPayload }) {
  const [data, setData] = useState(initial);
  const [pollError, setPollError] = useState<string | null>(null);
  const final = data.window != null;

  useEffect(() => {
    if (final) return;
    let alive = true;
    const id = setInterval(async () => {
      try {
        const r = await fetch(`/api/pool/${initial.pool.address}`, { cache: "no-store" });
        const j = await r.json();
        if (!alive) return;
        if (!r.ok) return setPollError(j.error ?? `HTTP ${r.status}`);
        setPollError(null);
        setData(j);
      } catch {
        if (alive) setPollError("lost contact with the server; retrying");
      }
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [final, initial.pool.address]);

  const { pool, window: win, launch } = data;
  const shares = win ? win.per_slot : perSlotFromBuys(data.buys, data.swapBaseAmount);
  const lines = buyLines(data.buys, data.quoteMint, data.swapBaseAmount);
  const outside = lines.filter((l) => l.who === "outside").length;

  return (
    <>
      <div className="receipt-strip" aria-live="polite">
        <SlotStrip shares={shares} final={final} size="lg" label={final ? "final 10-slot strip" : "10-slot strip, filling live"} />
        <dl className="stats">
          <div>
            <dt>SNP10</dt>
            <dd>{win ? <span className={`snp ${win.snp10 > 0 ? "sniped" : "held"}`}>{pct(win.snp10)}</span> : <span className="muted">window open</span>}</dd>
          </div>
          <div><dt>Buys in window</dt><dd>{int(lines.length)}</dd></div>
          <div><dt>Outside buys</dt><dd>{int(outside)}</dd></div>
          {win && <div><dt>Outside wallets</dt><dd>{int(win.nc_wallets)}</dd></div>}
          <div><dt>Open slot</dt><dd>{int(pool.open_slot)}</dd></div>
        </dl>
        {!final && <p className="note">Polling every 1.5 s. Cells stay hollow until the window is confirmed final{pollError ? ` (${pollError})` : ""}.</p>}
        {win && !win.complete && <p className="note">Some signatures in this window could not be confirmed; the figure is partial.</p>}
      </div>

      <ul className="links">
        <li><a href={solscanTx(pool.create_sig)} target="_blank" rel="noreferrer">Create tx on Solscan ↗</a></li>
        <li><a href={solscanAccount(pool.address)} target="_blank" rel="noreferrer">Pool on Solscan ↗</a></li>
        <li><a href={`/config/${pool.config}`}>Config {short(pool.config)}</a></li>
        {launch?.via === "beam" && (
          <li><a href={beamReceipt(launch.sig)} target="_blank" rel="noreferrer">Beam landing receipt ↗</a></li>
        )}
      </ul>

      <section aria-labelledby="buys-h" style={{ marginTop: 40 }}>
        <div className="section-head">
          <h2 id="buys-h">Slot by slot</h2>
          <p>Every buy in slots 0–9 after the pool opened</p>
        </div>
        {lines.length === 0 ? (
          <p className="empty">{final ? "No buys landed in the window." : "No buys seen yet."}</p>
        ) : (
          <div className="scroll-x">
            <table className="ruled">
              <thead>
                <tr>
                  <th scope="col" className="num">Slot</th>
                  <th scope="col">Wallet</th>
                  <th scope="col" className="num">In</th>
                  <th scope="col" className="num">Of curve</th>
                  <th scope="col">Who</th>
                  <th scope="col" className="hide-md">Route</th>
                  <th scope="col">Tx</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.key}>
                    <td className="num">+{l.offset}</td>
                    <td className="nowrap">{l.wallet}</td>
                    <td className="num nowrap">{l.quoteIn}</td>
                    <td className="num">{pct(l.share)}</td>
                    <td className="txt">{l.who}{l.confirmed ? "" : " (unconfirmed)"}</td>
                    <td className="txt hide-md">{l.viaCpi ? "via CPI" : "direct"}</td>
                    <td><a href={solscanTx(l.sig)} target="_blank" rel="noreferrer" aria-label={`Transaction ${short(l.sig)} on Solscan`}>{short(l.sig)}</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
