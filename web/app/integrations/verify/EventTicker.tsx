"use client";
import { useEffect, useState } from "react";
import { int, short, solscanTx } from "@/lib/format";
import type { EventRow } from "@/lib/queries";

export function EventTicker({ initial }: { initial: EventRow[] }) {
  const [rows, setRows] = useState(initial);
  const [stale, setStale] = useState(false);
  useEffect(() => {
    let alive = true;
    const id = setInterval(async () => {
      try {
        const r = await fetch("/api/verify/events?limit=50", { cache: "no-store" });
        if (!r.ok) throw new Error();
        const j = await r.json();
        if (alive) {
          setRows(j.events);
          setStale(false);
        }
      } catch {
        if (alive) setStale(true);
      }
    }, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  if (rows.length === 0) return <p className="empty">No decoded events yet.</p>;
  return (
    <>
      {stale && <p className="note">Refresh failed; showing the last events received.</p>}
      <div className="scroll-x">
        <table className="ruled">
          <caption className="sr-only">Last 50 decoded DBC events, refreshed every 3 seconds</caption>
          <thead>
            <tr>
              <th scope="col">Kind</th>
              <th scope="col" className="num">Slot</th>
              <th scope="col">Pool</th>
              <th scope="col">Signature</th>
              <th scope="col" className="hide-md">Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td className="txt">{e.kind}</td>
                <td className="num">{int(e.slot)}</td>
                <td>{e.pool ? <a href={`/pool/${e.pool}`}>{short(e.pool)}</a> : "—"}</td>
                <td><a href={solscanTx(e.sig)} target="_blank" rel="noreferrer" aria-label={`Transaction ${short(e.sig)} on Solscan`}>{short(e.sig, 6)}</a></td>
                <td className="txt hide-md">{e.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
