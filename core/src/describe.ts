// describeConfig: a DBC PoolConfig in the words a launchpad operator uses.
import { BaseFeeMode, baseFeeNumeratorAt, minBaseFeeNumerator, type ConfigInfo } from "./config.js";
import { WSOL_MINT, WINDOW_SLOTS } from "./constants.js";

const pct = (numerator: bigint): string => {
  const p = Number((numerator * 1_000_000n) / 1_000_000_000n) / 10_000;
  return `${p >= 10 ? p.toFixed(0) : p >= 1 ? p.toFixed(1) : p.toFixed(2)}%`;
};

// Below 0.001 SOL the 3-decimal format would print "0 SOL" (seen on a mainnet config with a 10,000-lamport threshold).
const quoteAmount = (atoms: bigint, quoteMint: string): string =>
  quoteMint !== WSOL_MINT ? `${atoms.toString()} quote atoms`
    : atoms > 0n && atoms < 1_000_000n ? `${atoms.toLocaleString("en-US")} lamports`
    : `${trim(Number(atoms) / 1e9)} SOL`;

const trim = (n: number) => (Number.isInteger(n) ? n.toString() : n.toFixed(n < 1 ? 3 : 2).replace(/0+$/, "").replace(/\.$/, ""));

export function describeConfig(cfg: ConfigInfo): string[] {
  const unit = cfg.activationType === 0 ? "slot" : "second";
  const units = (n: bigint | number) => `${n} ${unit}${BigInt(n) === 1n ? "" : "s"}`;
  const { mode, cliffFeeNumerator, firstFactor: periods, secondFactor: freq, thirdFactor: reduction } = cfg.baseFee;
  const lines: string[] = [];

  if (mode === BaseFeeMode.RateLimiter) {
    lines.push(`Fee starts at ${pct(cliffFeeNumerator)} and rises with trade size for ${units(freq)} (rate limiter).`);
  } else if (periods === 0 || reduction === 0n) {
    lines.push(`Flat ${pct(cliffFeeNumerator)} fee from the first slot. No anti-sniper schedule.`);
  } else {
    const end = minBaseFeeNumerator(cfg);
    const span = BigInt(periods) * freq;
    const shape =
      mode === BaseFeeMode.SchedulerExponential
        ? `falls by ${Number(reduction) / 100}% of itself every ${units(freq)}`
        : `drops ${pct(reduction)} every ${units(freq)}`;
    lines.push(`Fee starts at ${pct(cliffFeeNumerator)} and ${shape}, reaching ${pct(end)} after ${units(span)} (${mode === BaseFeeMode.SchedulerExponential ? "exponential" : "linear"} scheduler).`);
    if (cfg.activationType === 0) {
      const at9 = baseFeeNumeratorAt(cfg, WINDOW_SLOTS - 1);
      lines.push(`A buy in slot ${WINDOW_SLOTS - 1} still pays ${pct(at9)}.`);
    }
  }
  if (cfg.dynamicFee) lines.push("A volatility-based dynamic fee is added on top.");
  lines.push(
    cfg.enableFirstSwapWithMinFee
      ? "The creator's bundled first buy pays the minimum fee."
      : "The creator's first buy pays the same fee as everyone else.",
  );
  lines.push(`${cfg.activationType === 0 ? "Slot" : "Timestamp"} activation.`);
  const grad = cfg.migrationOption === 1 ? "DAMM v2" : "DAMM v1";
  lines.push(`Graduates at ${quoteAmount(cfg.migrationQuoteThreshold, cfg.quoteMint)} to ${grad}.`);
  if (cfg.poolCreationFee > 0n) lines.push(`Launching costs a ${quoteAmount(cfg.poolCreationFee, WSOL_MINT)} pool creation fee.`);
  if (cfg.creatorTradingFeePct > 0) lines.push(`The creator keeps ${cfg.creatorTradingFeePct}% of trading fees.`);
  return lines;
}
