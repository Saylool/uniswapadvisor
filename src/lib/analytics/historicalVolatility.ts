import {
  ANNUALIZATION_DAYS,
  type HistoricalVolatilityResult,
  HistoricalVolatilitySchema,
  type PoolDailyPriceHistory,
  PoolDailyPriceHistorySchema,
  VOLATILITY_METHOD,
} from "../../schemas";
import { buildDailyLogReturns, MS_PER_DAY } from "./dailyLogReturns";
import { calculateSampleStatistics } from "./sampleStatistics";

/**
 * Sample variance divides by `n - 1`, so two returns are the arithmetic minimum.
 *
 * Deliberately the mathematical floor and not a quality bar. Whether 2 returns
 * out of 30 is *enough to act on* is a policy question, and this layer reports the
 * coverage numbers a later policy layer needs rather than pre-judging them.
 */
export const MINIMUM_USABLE_RETURNS = 2;

const INVALID_INPUT =
  "The price history supplied for this calculation is not a valid normalized history.";
const INSUFFICIENT =
  "This pool does not have enough consecutive daily prices to measure volatility.";
const CALCULATION_ERROR =
  "The volatility calculation produced a result this application cannot verify.";

/**
 * Raised when the window has gaps. Stated because a volatility measured over 12
 * usable days is a different claim from one measured over 30, and the number
 * alone does not show that.
 */
const INCOMPLETE_COVERAGE_WARNING =
  "Some days in this window had no price, so volatility is measured from fewer daily returns than the window covers; the missing days were skipped rather than estimated.";

const unavailable = (
  reason: "invalid-input" | "insufficient-data" | "calculation-error",
  message: string,
): HistoricalVolatilityResult => ({ status: "unavailable", reason, message });

/**
 * Measures close-to-close historical volatility from a normalized daily history.
 *
 * Pure and clock-free: the same input always produces a deeply equal result.
 *
 * The parameter is already typed as the domain type, but it is re-validated
 * through `PoolDailyPriceHistorySchema` anyway. A type is a compile-time claim,
 * and this function is a public boundary — plain JavaScript, a JSON payload, or a
 * cast can all deliver something that does not satisfy the invariants the maths
 * depends on (ordering, day alignment, positive prices). Re-parsing costs one pass
 * and closes that hole.
 */
export const calculateHistoricalVolatility = (
  history: PoolDailyPriceHistory,
): HistoricalVolatilityResult => {
  const parsed = PoolDailyPriceHistorySchema.safeParse(history);
  if (!parsed.success) return unavailable("invalid-input", INVALID_INPUT);

  const validHistory = parsed.data;

  /*
   * Counts come from the declared range, not from a hardcoded 31. Both bounds are
   * day-aligned by schema, so this division is exact.
   */
  const windowMs =
    Date.parse(validHistory.rangeEndExclusive) - Date.parse(validHistory.rangeStart);
  const expectedObservationCount = windowMs / MS_PER_DAY;
  if (!Number.isSafeInteger(expectedObservationCount) || expectedObservationCount < 0) {
    return unavailable("invalid-input", INVALID_INPUT);
  }

  const expectedReturnCount = Math.max(expectedObservationCount - 1, 0);
  const dailyLogReturns = buildDailyLogReturns(validHistory.points);
  const usableReturnCount = dailyLogReturns.length;

  // Fail closed rather than publish contradictory bookkeeping.
  if (usableReturnCount > expectedReturnCount) {
    return unavailable("calculation-error", CALCULATION_ERROR);
  }

  if (usableReturnCount < MINIMUM_USABLE_RETURNS) {
    return unavailable("insufficient-data", INSUFFICIENT);
  }

  const statistics = calculateSampleStatistics(dailyLogReturns.map((entry) => entry.logReturn));
  if (statistics.standardDeviation === null) {
    return unavailable("insufficient-data", INSUFFICIENT);
  }

  const dailyVolatility = statistics.standardDeviation;
  const annualizedVolatility = dailyVolatility * Math.sqrt(ANNUALIZATION_DAYS);

  if (!Number.isFinite(statistics.mean) || !Number.isFinite(annualizedVolatility)) {
    return unavailable("calculation-error", CALCULATION_ERROR);
  }

  const candidate = {
    pool: validHistory.pool,
    // Renamed on the way in: within analytics this is provenance about the source
    // data, not a property of the calculation.
    sourceFetchedAt: validHistory.fetchedAt,
    sourceBlockNumber: validHistory.sourceBlockNumber,
    sourceBlockTimestamp: validHistory.sourceBlockTimestamp,
    rangeStart: validHistory.rangeStart,
    rangeEndExclusive: validHistory.rangeEndExclusive,
    priceDirection: validHistory.priceDirection,
    source: validHistory.source,

    method: VOLATILITY_METHOD,
    annualizationDays: ANNUALIZATION_DAYS,

    expectedObservationCount,
    observationCount: validHistory.points.length,
    expectedReturnCount,
    usableReturnCount,
    missingReturnCount: expectedReturnCount - usableReturnCount,
    returnCoverageRatio:
      expectedReturnCount === 0 ? 0 : usableReturnCount / expectedReturnCount,

    dailyLogReturns,
    meanDailyLogReturn: statistics.mean,
    dailyVolatility,
    annualizedVolatility,
  };

  // The schema is the final authority: it re-derives the count relationships and
  // the annualization identity, so a bookkeeping slip cannot be published.
  const analytics = HistoricalVolatilitySchema.safeParse(candidate);
  if (!analytics.success) return unavailable("calculation-error", CALCULATION_ERROR);

  if (usableReturnCount < expectedReturnCount) {
    return {
      status: "partial",
      data: analytics.data,
      warnings: [INCOMPLETE_COVERAGE_WARNING],
    };
  }

  return { status: "success", data: analytics.data };
};
