// Normalized view of a DBC PoolConfig account: the fields that decide what
// happens in a pool's first slots, plus what the Form shows about a config.
import { BorshCoder, type Idl } from "@coral-xyz/anchor";
import idlJson from "./dbc-idl.json" with { type: "json" };

const coder = new BorshCoder(idlJson as unknown as Idl);

export const FEE_DENOMINATOR = 1_000_000_000n;

export enum BaseFeeMode {
  SchedulerLinear = 0,
  SchedulerExponential = 1,
  RateLimiter = 2,
}

export type ConfigInfo = {
  address: string;
  quoteMint: string;
  feeClaimer: string;
  collectFeeMode: number;
  activationType: number; // 0 slot, 1 timestamp
  tokenType: number;
  tokenDecimal: number;
  swapBaseAmount: bigint; // sellable supply on the curve: the SNP10 denominator
  migrationQuoteThreshold: bigint;
  poolCreationFee: bigint;
  creatorTradingFeePct: number;
  enableFirstSwapWithMinFee: boolean;
  migrationOption: number;
  baseFee: {
    mode: number;
    cliffFeeNumerator: bigint;
    firstFactor: number; // scheduler: number of periods · rate limiter: fee increment bps
    secondFactor: bigint; // scheduler: period frequency · rate limiter: max limiter duration
    thirdFactor: bigint; // scheduler: reduction factor · rate limiter: reference amount
  };
  dynamicFee: boolean;
  curvePoints: number;
};

const big = (v: any): bigint => BigInt(v.toString());

/** Decode raw PoolConfig account data (with discriminator). Throws on a non-PoolConfig account. */
export function decodePoolConfig(address: string, data: Buffer): ConfigInfo {
  const c: any = coder.accounts.decode("PoolConfig", data);
  const bf = c.pool_fees.base_fee;
  return {
    address,
    quoteMint: c.quote_mint.toBase58(),
    feeClaimer: c.fee_claimer.toBase58(),
    collectFeeMode: c.collect_fee_mode,
    activationType: c.activation_type,
    tokenType: c.token_type,
    tokenDecimal: c.token_decimal,
    swapBaseAmount: big(c.swap_base_amount),
    migrationQuoteThreshold: big(c.migration_quote_threshold),
    poolCreationFee: big(c.pool_creation_fee),
    creatorTradingFeePct: c.creator_trading_fee_percentage,
    enableFirstSwapWithMinFee: c.enable_first_swap_with_min_fee !== 0,
    migrationOption: c.migration_option,
    baseFee: {
      mode: bf.base_fee_mode,
      cliffFeeNumerator: big(bf.cliff_fee_numerator),
      firstFactor: bf.first_factor,
      secondFactor: big(bf.second_factor),
      thirdFactor: big(bf.third_factor),
    },
    dynamicFee: c.pool_fees.dynamic_fee.initialized !== 0,
    curvePoints: c.curve.filter((p: any) => big(p.sqrt_price) > 0n).length,
  };
}

/**
 * Base fee numerator (of FEE_DENOMINATOR) at `elapsed` slots/seconds after activation,
 * following the DBC fee scheduler: linear `cliff − n·reduction`, exponential
 * `cliff·(1 − reduction/10⁴)ⁿ`, with n = min(⌊elapsed / periodFrequency⌋, numberOfPeriod).
 * The rate limiter depends on trade size, so it returns the cliff fee (its floor).
 */
export function baseFeeNumeratorAt(cfg: ConfigInfo, elapsed: number): bigint {
  const { mode, cliffFeeNumerator: cliff, firstFactor: periods, secondFactor: freq, thirdFactor: reduction } = cfg.baseFee;
  if (mode === BaseFeeMode.RateLimiter || periods === 0 || freq === 0n) return cliff;
  const passed = BigInt(Math.max(0, elapsed));
  const n = passed / freq > BigInt(periods) ? BigInt(periods) : passed / freq;
  if (mode === BaseFeeMode.SchedulerLinear) {
    const fee = cliff - n * reduction;
    return fee > 0n ? fee : 0n;
  }
  // Exponential: Q64 fixed point, bit-for-bit the SDK's getFeeNumeratorOnExponentialFeeScheduler.
  if (n === 0n) return cliff;
  const base = ONE_Q64 - (reduction << 64n) / 10_000n;
  return (cliff * powQ64(base, n)) / ONE_Q64;
}

const ONE_Q64 = 1n << 64n;
function powQ64(base: bigint, exp: bigint): bigint {
  let result = ONE_Q64;
  let b = base;
  for (let e = exp; e > 0n; e >>= 1n) {
    if (e & 1n) result = (result * b) / ONE_Q64;
    b = (b * b) / ONE_Q64;
  }
  return result;
}

/** The fee after the scheduler has run out (the floor every later trade pays). */
export function minBaseFeeNumerator(cfg: ConfigInfo): bigint {
  const { firstFactor: periods, secondFactor: freq } = cfg.baseFee;
  return baseFeeNumeratorAt(cfg, periods * Number(freq || 1n));
}

export const feeBps = (numerator: bigint): number => Number((numerator * 10_000n) / FEE_DENOMINATOR);
