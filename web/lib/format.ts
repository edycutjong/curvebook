// Pure formatters shared by server pages and client components.

export const short = (addr: string | null | undefined, n = 4): string =>
  !addr ? "—" : addr.length <= n * 2 + 1 ? addr : `${addr.slice(0, n)}…${addr.slice(-n)}`;

/** A share in [0,1] as a percent: one decimal from 1%, two below, never "0.00%" for a nonzero share. */
export function pct(share: number | null | undefined): string {
  if (share == null || !Number.isFinite(share)) return "—";
  const p = share * 100;
  if (p === 0) return "0%";
  if (p < 0.01) return "<0.01%";
  return `${p >= 1 ? p.toFixed(1) : p.toFixed(2)}%`;
}

export const int = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? "—" : Math.round(n).toLocaleString("en-US");

/** Seconds as a racing-form time: 45s, 12m, 3h12, 2d04. */
export function duration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return "—";
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h${String(m % 60).padStart(2, "0")}`;
  return `${Math.floor(h / 24)}d${String(h % 24).padStart(2, "0")}`;
}

export function age(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "—" : `${duration(Math.max(0, (now - t) / 1000))} ago`;
}

/** Integer atoms (string, as Postgres numeric arrives) scaled by 10^decimals, trimmed. */
export function atoms(value: string | number | bigint | null | undefined, decimals: number, maxFrac = 4): string {
  if (value == null || value === "") return "—";
  let v: bigint;
  try {
    v = BigInt(typeof value === "number" ? Math.trunc(value) : String(value).split(".")[0]);
  } catch {
    return "—";
  }
  const neg = v < 0n;
  if (neg) v = -v;
  const base = 10n ** BigInt(decimals);
  const whole = (v / base).toLocaleString("en-US");
  const frac = (v % base).toString().padStart(decimals, "0").slice(0, maxFrac).replace(/0+$/, "");
  const out = frac ? `${whole}.${frac}` : whole;
  return neg ? `-${out}` : out;
}

export const sol = (lamports: string | number | bigint | null | undefined, maxFrac = 4) => atoms(lamports, 9, maxFrac);

export const rankLabel = (rank: number | null, tied: boolean): string => (rank == null ? "—" : tied ? `=${rank}` : String(rank));

export const bps = (b: number): string => `${(b / 100).toFixed(b % 100 === 0 ? 0 : 2)}%`;

export const solscanTx = (sig: string) => `https://solscan.io/tx/${sig}`;
export const solscanAccount = (addr: string) => `https://solscan.io/account/${addr}`;
export const beamReceipt = (sig: string) => `https://api.solami.dev/swqos/tx/${sig}`;
