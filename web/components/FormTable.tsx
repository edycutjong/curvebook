import Link from "next/link";
import { SlotStrip } from "./SlotStrip";
import { duration, pct, rankLabel, short } from "@/lib/format";
import type { FormRow } from "@/lib/form";

export function Snp({ value, final = true }: { value: number | null; final?: boolean }) {
  if (value == null) return <span className="snp">—</span>;
  return <span className={`snp ${value > 0 ? "sniped" : final ? "held" : ""}`}>{pct(value)}</span>;
}

/** One ruled table for every Form block; `ranked` decides whether the RANK column means anything. */
export function FormTable({ rows, caption, ranked }: { rows: FormRow[]; caption: string; ranked: boolean }) {
  return (
    <table className="ruled formtable">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Rank</th>
          <th scope="col">Config</th>
          <th scope="col" className="num">LNCH</th>
          <th scope="col">SNP10 strip</th>
          <th scope="col" className="num">SNP10 · CI</th>
          <th scope="col" className="num hide-md">Creators</th>
          <th scope="col" className="num">GRAD</th>
          <th scope="col" className="num hide-md">T-GRAD</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.config}>
            <td className="c-rank">{ranked ? rankLabel(r.rank, r.tied) : "—"}</td>
            <td className="c-name">
              <Link href={`/config/${r.config}`} title={r.config}>
                {r.preset ? r.preset.name : short(r.config)}
              </Link>
              {r.preset && <span className="star" title="Curvebook preset: fees route through the curvebook_router split">★ CURVEBOOK</span>}
              {r.preset && <span className="sub">{short(r.config)}</span>}
            </td>
            <td className="num">{r.launches}</td>
            <td className="c-strip">
              {r.medianStrip ? (
                <SlotStrip shares={r.medianStrip} final size="sm" label={`median strip for ${short(r.config)}`} />
              ) : (
                <span className="muted">no window yet</span>
              )}
            </td>
            <td className="num c-snp">
              <Snp value={r.snp10P50} />
              {r.ciLo != null && r.ciHi != null && r.launches > 1 && r.ciHi > r.ciLo && (
                <span className="sub">{pct(r.ciLo)}–{pct(r.ciHi)}</span>
              )}
            </td>
            <td className="num hide-md">
              {r.creators}
              {r.launches > 0 && <span className="sub">top {pct(r.topCreatorShare)}</span>}
            </td>
            <td className="num">
              {r.gradRate == null ? "—" : pct(r.gradRate)}
              {r.gradAged > 0 && <span className="sub">of {r.gradAged}</span>}
            </td>
            <td className="num hide-md">{duration(r.tGradP50)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
