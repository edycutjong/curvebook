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
