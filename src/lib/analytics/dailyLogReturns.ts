import type { DailyLogReturn, HistoricalPricePoint } from "../../schemas";

/** One UTC day in milliseconds. Constant: Unix time has no leap seconds. */
export const MS_PER_DAY = 86_400_000;

/**
 * Builds close-to-close daily log returns from an ordered price series.
 *
 * Two rules govern the whole function:
 *
 * 1. A return is only produced when two adjacent observations are *exactly* one
 *    UTC day apart. If a day is missing, the pair that straddles the gap is
 *    skipped entirely — not divided down into a daily figure, not filled with the
 *    previous close, not interpolated, not zeroed. A two-day move rescaled into
 *    "a daily return" is a number nobody observed, and it would flow straight
 *    into a volatility figure as if it had been.
 *
 * 2. The return is `ln(P_t) - ln(P_t-1)`, never `ln(P_t / P_t-1)`. The ratio form
 *    overflows to Infinity or underflows to 0 for extreme-but-finite prices, and
 *    both are legal float64 values a real pool can produce. Subtracting logarithms
 *    stays finite across the entire positive finite range.
 *
 * Skipped pairs are not reported here; the caller derives coverage by comparing
 * how many returns came back against how many a complete window would yield.
 */
export const buildDailyLogReturns = (
  points: readonly HistoricalPricePoint[],
): readonly DailyLogReturn[] => {
  const returns: DailyLogReturn[] = [];

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous === undefined || current === undefined) continue;

    const spanMs = Date.parse(current.timestamp) - Date.parse(previous.timestamp);
    if (spanMs !== MS_PER_DAY) continue;

    returns.push({
      fromTimestamp: previous.timestamp,
      toTimestamp: current.timestamp,
      logReturn: Math.log(current.price) - Math.log(previous.price),
    });
  }

  return returns;
};
