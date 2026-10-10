// The signature element: ten square cells, one per slot after the pool opens.
// No hooks, so it renders on the server and inside client components alike.
import { cellFill, cellLabel, cellState, normalizeStrip } from "@/lib/strip";

const SIZES = { sm: 14, md: 22, lg: 64 } as const;

export function SlotStrip({
  shares,
  final,
  size = "sm",
  label,
}: {
  shares: readonly number[] | null | undefined;
  final: boolean;
  size?: keyof typeof SIZES;
  label?: string;
}) {
  const s = SIZES[size];
  const gap = size === "lg" ? 6 : 2;
  const stroke = size === "lg" ? 2 : 1;
  const cells = normalizeStrip(shares);
  const w = cells.length * s + (cells.length - 1) * gap;
  if (size === "sm" && final) return <CompactStrip cells={cells} s={s} gap={gap} w={w} label={label ?? "10-slot strip"} />;
  return (
    <svg
      className={`strip strip-${size}`}
      viewBox={`0 0 ${w} ${s}`}
      width={w}
      height={s}
      role="group"
      aria-label={label ?? (final ? "10-slot strip" : "10-slot strip, window still open")}
    >
      {cells.map((share, i) => {
        const x = i * (s + gap);
        const state = cellState(share, final);
        const text = cellLabel(i, share, final);
        const h = cellFill(share) * (s - stroke);
        return (
          <g key={i} role="img" aria-label={text} className={`cell cell-${state}`}>
            <title>{text}</title>
            {h > 0 && <rect x={x + stroke / 2} y={s - stroke / 2 - h} width={s - stroke} height={h} fill="var(--before)" />}
            <rect
              x={x + stroke / 2}
              y={stroke / 2}
              width={s - stroke}
              height={s - stroke}
              fill="none"
              stroke="var(--ink)"
              strokeWidth={stroke}
              strokeDasharray={state === "open" ? `${s / 6} ${s / 10}` : undefined}
              opacity={state === "open" ? 0.55 : 1}
            />
            {state === "held" && (
              <path
                d={`M${x + s * 0.24} ${s * 0.52} l${s * 0.18} ${s * 0.2} l${s * 0.34} ${-s * 0.42}`}
                fill="none"
                stroke="var(--after)"
                strokeWidth={Math.max(1.5, s * 0.11)}
                strokeLinecap="square"
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

// The Form table draws ~100 small strips. One <g>/<title>/<rect> set per cell came to ~35 elements a strip
// (4,000 of the home page's 6,400), most of Lighthouse's mobile render delay. Same pixels as the full
// strip (final cells only), drawn as three paths; the per-cell labels move into the one tooltip.
function CompactStrip({ cells, s, gap, w, label }: { cells: number[]; s: number; gap: number; w: number; label: string }) {
  const stroke = 1;
  const inner = s - stroke;
  let boxes = "";
  let fills = "";
  let ticks = "";
  cells.forEach((share, i) => {
    const x = i * (s + gap) + stroke / 2;
    boxes += `M${x} ${stroke / 2}h${inner}v${inner}h${-inner}Z`;
    const h = cellFill(share) * inner;
    if (h > 0) fills += `M${x} ${s - stroke / 2 - h}h${inner}v${h}h${-inner}Z`;
    if (cellState(share, true) === "held") {
      const x0 = i * (s + gap);
      ticks += `M${x0 + s * 0.24} ${s * 0.52}l${s * 0.18} ${s * 0.2}l${s * 0.34} ${-s * 0.42}`;
    }
  });
  const detail = cells.map((share, i) => cellLabel(i, share, true)).join("\n");
  return (
    <svg className="strip strip-sm" viewBox={`0 0 ${w} ${s}`} width={w} height={s} role="img" aria-label={label}>
      <title>{`${label}\n${detail}`}</title>
      {fills && <path d={fills} fill="var(--before)" />}
      <path d={boxes} fill="none" stroke="var(--ink)" strokeWidth={stroke} />
      {ticks && <path d={ticks} fill="none" stroke="var(--after)" strokeWidth={Math.max(1.5, s * 0.11)} strokeLinecap="square" />}
    </svg>
  );
}
