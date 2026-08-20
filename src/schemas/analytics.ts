import { z } from "zod";

import { IsoTimestampSchema, UnsignedIntegerStringSchema } from "./primitives";
import { PoolReferenceSchema } from "./uniswap";

/*
 * Contracts for deterministic analytics computed from normalized market data.
 *
 * Everything here is a ratio, not a percentage: 0.01 means 1%. Formatting is a
 * presentation concern, and multiplying by 100 in the domain would make every
 * later consumer guess which convention a number follows.
 *
 * No risk labels, no thresholds, no recommendation language. This layer reports
 * what the arithmetic produced and how much of the window it was able to use;
 * deciding whether that is good enough belongs to a later policy layer.
 */

const MS_PER_DAY = 86_400_000;

/**
 * How far a stored figure may drift from its recomputed value before the schema
 * calls it inconsistent.
 *
 * Cross-field checks like `annualized == daily * sqrt(365)` compare two float64
 * results of the same computation performed in different orders, which agree to
 * within a few ulps rather than exactly. 1e-9 relative is far above that and far
 * below any difference that would matter, so it catches a genuinely wrong number
 * without failing on the last bit.
 */
export const ANALYTICS_CONSISTENCY_TOLERANCE = 1e-9;

/** Calendar days per year: crypto markets trade every day, including weekends. */
export const ANNUALIZATION_DAYS = 365;

/** Identifies how a volatility figure was produced, so two are never compared blindly. */
export const VOLATILITY_METHOD = "close-to-close-daily-log-return-sample-volatility";

const asInstant = (timestamp: string): number => Date.parse(timestamp);

/** Relative comparison, so the tolerance means the same thing at any magnitude. */
const isCloseEnough = (actual: number, expected: number): boolean =>
  Math.abs(actual - expected) <= ANALYTICS_CONSISTENCY_TOLERANCE * Math.max(1, Math.abs(expected));

/** A count of things: whole, non-negative, and exactly representable. */
const CountSchema = z.int().min(0);

/** True when an instant sits exactly on a UTC midnight. Pure epoch arithmetic. */
const isUtcDayAligned = (timestamp: string): boolean => asInstant(timestamp) % MS_PER_DAY === 0;

/**
 * Mean and sample standard deviation, recomputed here for verification.
 *
 * Deliberately a plain two-pass calculation rather than a call into the analytics
 * module's Welford helper. A schema that validated its input by invoking the very
 * function that produced it would confirm nothing: a bug in that helper would
 * simply be reproduced on both sides and agree with itself. Independence is the
 * whole point, so this is written out separately even though it duplicates the
 * arithmetic.
 *
 * Two-pass is safe here because the series is tiny — at most a month of daily
 * returns — so the accuracy argument that motivates Welford in the calculator does
 * not apply, and clarity is worth more.
 *
 * Returns `null` below two values: sample variance divides by `n - 1`.
 */
const recomputeSampleStatistics = (
  values: readonly number[],
): { readonly mean: number; readonly standardDeviation: number } | null => {
  if (values.length < 2) return null;

  let total = 0;
  for (const value of values) total += value;
  const mean = total / values.length;

  let sumOfSquaredDeviations = 0;
  for (const value of values) sumOfSquaredDeviations += (value - mean) ** 2;

  const sampleVariance = sumOfSquaredDeviations / (values.length - 1);
  return { mean, standardDeviation: Math.sqrt(sampleVariance) };
};

/**
 * One close-to-close daily log return.
 *
 * The two timestamps are exactly one UTC day apart. A return computed across a
 * longer gap is a multi-day move, and rescaling one into a daily figure would
 * invent volatility that was never observed — so such pairs are skipped upstream
 * rather than represented here.
 *
 * `z.number()` already rejects `NaN` and `±Infinity`, so the value is finite.
 * Negative values are ordinary: prices fall.
 */
export const DailyLogReturnSchema = z
  .strictObject({
    fromTimestamp: IsoTimestampSchema,
    toTimestamp: IsoTimestampSchema,
    /** `ln(P_to) - ln(P_from)`, as a ratio. */
    logReturn: z.number(),
  })
  .refine(
    (entry) => asInstant(entry.toTimestamp) - asInstant(entry.fromTimestamp) === MS_PER_DAY,
    {
      error: "A daily log return must span exactly one UTC day.",
      path: ["toTimestamp"],
    },
  );

export type DailyLogReturn = z.infer<typeof DailyLogReturnSchema>;

const isStrictlyAscending = (returns: readonly DailyLogReturn[]): boolean => {
  for (let index = 1; index < returns.length; index += 1) {
    const previous = returns[index - 1];
    const current = returns[index];
    if (previous === undefined || current === undefined) return false;
    if (asInstant(current.fromTimestamp) <= asInstant(previous.fromTimestamp)) return false;
  }
  return true;
};

/**
 * Historical volatility for one pool over one window.
 *
 * Carries its own provenance — which pool, which source, which block, which
 * range — because a volatility number detached from what it was measured on is
 * not interpretable. Every one of those fields is copied from the normalized
 * input; none is invented here, and missing block metadata stays null rather than
 * being backfilled with some other timestamp.
 *
 * There is deliberately no `calculatedAt`. The calculation is pure: the same
 * input always yields the same output, so stamping it with a clock would make
 * identical results compare unequal.
 */
export const HistoricalVolatilitySchema = z
  .strictObject({
    pool: PoolReferenceSchema,

    /** When the underlying data was fetched — not when this was calculated. */
    sourceFetchedAt: IsoTimestampSchema,
    /**
     * The same canonical exact-integer contract the normalized history uses, so
     * provenance cannot be weakened on the way through a calculation.
     */
    sourceBlockNumber: UnsignedIntegerStringSchema.nullable(),
    sourceBlockTimestamp: IsoTimestampSchema.nullable(),
    rangeStart: IsoTimestampSchema,
    rangeEndExclusive: IsoTimestampSchema,
    priceDirection: z.literal("token0PriceInToken1"),
    source: z.literal("uniswap-v3-subgraph"),

    /** Stated so a figure is never compared against one computed differently. */
    method: z.literal(VOLATILITY_METHOD),
    annualizationDays: z.literal(ANNUALIZATION_DAYS),

    /** Day buckets the window covers. */
    expectedObservationCount: CountSchema,
    /** Prices actually present. */
    observationCount: CountSchema,
    /** Returns a complete window would yield: one fewer than the observations. */
    expectedReturnCount: CountSchema,
    /** Returns actually computable from exactly-one-day pairs. */
    usableReturnCount: CountSchema,
    missingReturnCount: CountSchema,
    /** `usable / expected`, in [0, 1]. Lets a later layer judge sufficiency. */
    returnCoverageRatio: z.number().min(0).max(1),

    dailyLogReturns: z.array(DailyLogReturnSchema),
    meanDailyLogReturn: z.number(),
    /** Sample standard deviation of the daily log returns, as a ratio. */
    dailyVolatility: z.number().min(0),
    /** `dailyVolatility * sqrt(365)`, as a ratio. */
    annualizedVolatility: z.number().min(0),
  })
  .refine((analytics) => analytics.dailyLogReturns.length === analytics.usableReturnCount, {
    error: "dailyLogReturns.length must equal usableReturnCount.",
    path: ["dailyLogReturns"],
  })
  .refine(
    (analytics) =>
      analytics.expectedReturnCount === Math.max(analytics.expectedObservationCount - 1, 0),
    {
      error: "expectedReturnCount must be one fewer than expectedObservationCount.",
      path: ["expectedReturnCount"],
    },
  )
  .refine(
    (analytics) =>
      analytics.missingReturnCount === analytics.expectedReturnCount - analytics.usableReturnCount,
    {
      error: "missingReturnCount must equal expectedReturnCount minus usableReturnCount.",
      path: ["missingReturnCount"],
    },
  )
  .refine((analytics) => analytics.usableReturnCount <= analytics.expectedReturnCount, {
    error: "usableReturnCount cannot exceed expectedReturnCount.",
    path: ["usableReturnCount"],
  })
  .refine((analytics) => analytics.observationCount <= analytics.expectedObservationCount, {
    error: "observationCount cannot exceed expectedObservationCount.",
    path: ["observationCount"],
  })
  .refine(
    (analytics) =>
      analytics.expectedReturnCount === 0
        ? analytics.returnCoverageRatio === 0
        : isCloseEnough(
            analytics.returnCoverageRatio,
            analytics.usableReturnCount / analytics.expectedReturnCount,
          ),
    {
      error: "returnCoverageRatio must equal usableReturnCount / expectedReturnCount.",
      path: ["returnCoverageRatio"],
    },
  )
  .refine(
    (analytics) =>
      isCloseEnough(
        analytics.annualizedVolatility,
        analytics.dailyVolatility * Math.sqrt(ANNUALIZATION_DAYS),
      ),
    {
      error: "annualizedVolatility must equal dailyVolatility * sqrt(365).",
      path: ["annualizedVolatility"],
    },
  )
  .refine((analytics) => isStrictlyAscending(analytics.dailyLogReturns), {
    error: "dailyLogReturns must be strictly ascending by fromTimestamp.",
    path: ["dailyLogReturns"],
  })
  .refine((analytics) => asInstant(analytics.rangeStart) < asInstant(analytics.rangeEndExclusive), {
    error: "rangeStart must be earlier than rangeEndExclusive.",
    path: ["rangeStart"],
  })
  .refine(
    (analytics) => analytics.pool.chainId === 1 && analytics.pool.protocolVersion === "v3",
    {
      // The `source` literal says these figures came from the Uniswap v3 mainnet
      // subgraph, so a pool reference from anywhere else means the provenance was
      // assembled from mismatched inputs rather than copied from one history.
      error: "A Uniswap v3 subgraph analytic can only describe an Ethereum mainnet v3 pool.",
      path: ["pool"],
    },
  )
  /*
   * Sample variance needs two observations. Below that there is no dispersion to
   * measure, so a volatility figure would be an assertion rather than a
   * measurement — whatever the counts claim.
   */
  .refine((analytics) => analytics.dailyLogReturns.length >= 2, {
    error: "At least two daily returns are required to measure volatility.",
    path: ["dailyLogReturns"],
  })
  .refine((analytics) => analytics.usableReturnCount >= 2, {
    error: "usableReturnCount must be at least two.",
    path: ["usableReturnCount"],
  })
  /*
   * The statistics are recomputed and compared, not taken on trust. Counts and
   * ordering can all be correct while the mean and volatility describe a different
   * series entirely — which is exactly the shape of a figure that is wrong but
   * looks well-formed.
   */
  .refine(
    (analytics) => {
      const recomputed = recomputeSampleStatistics(
        analytics.dailyLogReturns.map((entry) => entry.logReturn),
      );
      return recomputed !== null && isCloseEnough(analytics.meanDailyLogReturn, recomputed.mean);
    },
    {
      error: "meanDailyLogReturn must equal the mean of dailyLogReturns.",
      path: ["meanDailyLogReturn"],
    },
  )
  .refine(
    (analytics) => {
      const recomputed = recomputeSampleStatistics(
        analytics.dailyLogReturns.map((entry) => entry.logReturn),
      );
      return (
        recomputed !== null &&
        isCloseEnough(analytics.dailyVolatility, recomputed.standardDeviation)
      );
    },
    {
      // Divisor `n - 1`, matching the declared method. A population standard
      // deviation would be smaller and is rejected here.
      error: "dailyVolatility must equal the sample standard deviation of dailyLogReturns.",
      path: ["dailyVolatility"],
    },
  )
  /*
   * Provenance has to describe the same window the returns came from. A correct
   * range beside returns from an unrelated month would otherwise validate, and the
   * result would attribute one period's volatility to another.
   */
  .refine((analytics) => isUtcDayAligned(analytics.rangeStart), {
    error: "rangeStart must fall exactly on a UTC day boundary.",
    path: ["rangeStart"],
  })
  .refine((analytics) => isUtcDayAligned(analytics.rangeEndExclusive), {
    error: "rangeEndExclusive must fall exactly on a UTC day boundary.",
    path: ["rangeEndExclusive"],
  })
  .refine(
    (analytics) =>
      analytics.dailyLogReturns.every(
        (entry) => isUtcDayAligned(entry.fromTimestamp) && isUtcDayAligned(entry.toTimestamp),
      ),
    {
      error: "Every daily return must fall exactly on UTC day boundaries.",
      path: ["dailyLogReturns"],
    },
  )
  .refine(
    (analytics) =>
      analytics.dailyLogReturns.every(
        (entry) =>
          asInstant(entry.fromTimestamp) >= asInstant(analytics.rangeStart) &&
          asInstant(entry.toTimestamp) < asInstant(analytics.rangeEndExclusive),
      ),
    {
      error: "Every daily return must lie within [rangeStart, rangeEndExclusive).",
      path: ["dailyLogReturns"],
    },
  )
  .refine(
    (analytics) =>
      analytics.expectedObservationCount ===
      (asInstant(analytics.rangeEndExclusive) - asInstant(analytics.rangeStart)) / MS_PER_DAY,
    {
      error: "expectedObservationCount must equal the number of UTC days the range spans.",
      path: ["expectedObservationCount"],
    },
  )
  .refine((analytics) => analytics.observationCount >= analytics.usableReturnCount + 1, {
    // Each return consumes a pair of adjacent observations, so n returns need at
    // least n + 1 prices to have come from.
    error: "observationCount must be at least usableReturnCount + 1.",
    path: ["observationCount"],
  });

export type HistoricalVolatility = z.infer<typeof HistoricalVolatilitySchema>;

/** Why a pure calculation could not produce a figure. */
export const AnalyticsFailureReasonSchema = z.enum([
  /** The input did not satisfy its own domain schema. */
  "invalid-input",
  /** The input was valid but carried too few observations to measure. */
  "insufficient-data",
  /** The arithmetic produced something non-finite. Should be unreachable. */
  "calculation-error",
]);

export type AnalyticsFailureReason = z.infer<typeof AnalyticsFailureReasonSchema>;

/**
 * The contract every pure analytics calculation returns.
 *
 * Deliberately not `DataResult<T>`: that type describes a *fetch*, and its
 * `missingFields` names fields a source failed to supply. A calculation has no
 * source and no missing fields — what it can lack is coverage, which is already
 * reported numerically inside the data. Reusing `DataResult` here would force a
 * meaningless `missingFields` onto every result.
 *
 * A plain TypeScript type rather than a Zod schema, for the same reason
 * `DataResult` is: these values are built in-process and never parsed from an
 * external boundary. Zod remains the authority for the `data` they wrap.
 */
export type AnalyticsResult<T> =
  | { readonly status: "success"; readonly data: T }
  | {
      readonly status: "partial";
      readonly data: T;
      /** Fixed, sanitized caveats in a deterministic order. */
      readonly warnings: readonly string[];
    }
  | {
      readonly status: "unavailable";
      readonly reason: AnalyticsFailureReason;
      /** A short, already-sanitized explanation safe to show a user. */
      readonly message: string;
    };

export type HistoricalVolatilityResult = AnalyticsResult<HistoricalVolatility>;
