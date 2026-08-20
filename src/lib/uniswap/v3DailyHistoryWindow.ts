/**
 * How many completed daily observations the history covers.
 *
 * 31 closes yield 30 daily returns, which is what a 30-day volatility figure
 * needs. Asking for 30 closes would quietly produce 29 returns.
 */
export const DAILY_HISTORY_DAYS = 31;

const MS_PER_DAY = 86_400_000;

export type DailyHistoryWindow = {
  /** Inclusive start, canonical UTC. */
  readonly rangeStart: string;
  /** Exclusive end: the start of the current, still-incomplete UTC day. */
  readonly rangeEndExclusive: string;
  /** The same bounds as Unix seconds, which is how the subgraph filters dates. */
  readonly rangeStartUnixSeconds: number;
  readonly rangeEndExclusiveUnixSeconds: number;
  /**
   * Every UTC day-start the window covers, ascending. A response may legitimately
   * carry fewer points than this, but never a point outside it.
   */
  readonly expectedTimestamps: readonly string[];
};

/**
 * Derives the daily window from an injected clock.
 *
 * The current UTC day is excluded because it is still accumulating: its close has
 * not happened, so including it would put a partial day's price beside 30 settled
 * ones and let a mid-day move look like a completed daily return.
 *
 * Flooring epoch milliseconds to a whole number of days lands exactly on UTC
 * midnight — Unix time is UTC-anchored and has no leap seconds — so no timezone
 * is consulted and no date library is needed.
 */
export const resolveDailyHistoryWindow = (now: Date): DailyHistoryWindow => {
  const currentUtcDayStartMs = Math.floor(now.getTime() / MS_PER_DAY) * MS_PER_DAY;
  const rangeStartMs = currentUtcDayStartMs - DAILY_HISTORY_DAYS * MS_PER_DAY;

  const expectedTimestamps = Array.from({ length: DAILY_HISTORY_DAYS }, (_unused, index) =>
    new Date(rangeStartMs + index * MS_PER_DAY).toISOString(),
  );

  return {
    rangeStart: new Date(rangeStartMs).toISOString(),
    rangeEndExclusive: new Date(currentUtcDayStartMs).toISOString(),
    rangeStartUnixSeconds: rangeStartMs / 1000,
    rangeEndExclusiveUnixSeconds: currentUtcDayStartMs / 1000,
    expectedTimestamps,
  };
};
