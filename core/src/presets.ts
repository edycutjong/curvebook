// The three Curvebook presets. Configs are immutable on DBC, so a tuned preset is a new config.
// Slow Cliff and Two-Step put an anti-sniper fee schedule on the first 20 slots; Control is the
// flat-fee shape most launchpads run, so our own launches carry a like-for-like comparison.
import {
  ActivationType, BaseFeeMode, CollectFeeMode, MigrationFeeOption, MigrationOption, TokenAuthorityOption, TokenDecimal, TokenType,
  buildCurve, buildCurveWithLiquidityWeights, buildCurveWithTwoSegments, type ConfigParameters,
} from "@meteora-ag/dynamic-bonding-curve-sdk";

export const POOL_CREATION_FEE_SOL = 0.05;

const base = (baseFeeParams: any, enableFirstSwapWithMinFee: boolean) => ({
  token: {
    tokenType: TokenType.SPLToken,
    tokenBaseDecimal: TokenDecimal.SIX,
    tokenQuoteDecimal: 9,
    tokenAuthorityOption: TokenAuthorityOption.Immutable,
    totalTokenSupply: 1_000_000_000,
    leftover: 1_000_000, // 0.1% buffer the SDK needs to absorb curve rounding; goes to the leftover receiver (treasury)
  },
  fee: {
    baseFeeParams,
    dynamicFeeEnabled: false,
    collectFeeMode: CollectFeeMode.QuoteToken, // the router claims quote-side fees only
    creatorTradingFeePercentage: 0,
    poolCreationFee: POOL_CREATION_FEE_SOL,
    enableFirstSwapWithMinFee,
  },
  migration: {
    migrationOption: MigrationOption.MET_DAMM_V2,
    migrationFeeOption: MigrationFeeOption.FixedBps100,
    migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
  },
  liquidityDistribution: {
    partnerPermanentLockedLiquidityPercentage: 50,
    partnerLiquidityPercentage: 0,
    creatorPermanentLockedLiquidityPercentage: 50,
    creatorLiquidityPercentage: 0,
  },
  lockedVesting: { totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0, totalVestingDuration: 0, cliffDurationFromMigrationTime: 0 },
  activationType: ActivationType.Slot,
});

const scheduler = (mode: BaseFeeMode, startingFeeBps: number, endingFeeBps: number, numberOfPeriod: number, totalDuration: number) => ({
  baseFeeMode: mode,
  feeSchedulerParam: { startingFeeBps, endingFeeBps, numberOfPeriod, totalDuration },
});

export type PresetDef = { slug: string; name: string; builder: string; summary: string; params: () => ConfigParameters };

export const PRESETS: PresetDef[] = [
  {
    slug: "slow-cliff",
    name: "Slow Cliff",
    builder: "buildCurveWithLiquidityWeights",
    summary: "Deeper liquidity at low prices; 50% fee in slot 0 decaying exponentially to 1% over 20 slots; the creator's bundled buy pays the minimum fee.",
    params: () =>
      buildCurveWithLiquidityWeights({
        ...base(scheduler(BaseFeeMode.FeeSchedulerExponential, 5000, 100, 20, 20), true),
        initialMarketCap: 30,
        migrationMarketCap: 400,
        // weights fall along the curve: early buys move the price less, so a slot-0 sweep buys less supply per SOL of fee
        liquidityWeights: Array.from({ length: 16 }, (_, i) => 1.15 ** (15 - i)),
      } as any),
  },
  {
    slug: "two-step",
    name: "Two-Step",
    builder: "buildCurveWithTwoSegments",
    summary: "Two curve segments; 50% fee in slot 0 falling linearly to 1% over 20 slots; the creator's bundled buy pays the minimum fee.",
    params: () =>
      buildCurveWithTwoSegments({
        ...base(scheduler(BaseFeeMode.FeeSchedulerLinear, 5000, 100, 20, 20), true),
        initialMarketCap: 30,
        migrationMarketCap: 400,
        percentageSupplyOnMigration: 20,
      } as any),
  },
  {
    slug: "control",
    name: "Control",
    builder: "buildCurve",
    summary: "The default launchpad shape: a flat 1% fee from the first slot, no schedule.",
    params: () =>
      buildCurve({
        ...base(scheduler(BaseFeeMode.FeeSchedulerLinear, 100, 100, 0, 0), false),
        percentageSupplyOnMigration: 20,
        migrationQuoteThreshold: 85,
      } as any),
  },
];
