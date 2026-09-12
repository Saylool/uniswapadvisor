import {
  type AnalyticsFailureReason,
  type DataFailureReason,
  type DataResult,
  type HistoricalVolatility,
  type PoolDailyPriceHistory,
  type PoolMarketSnapshot,
  type PriceBandParameters,
  type V3Pool,
  type V3TickRange,
  type VolatilityPriceBand,
} from "../../schemas";
import { calculateHistoricalVolatility } from "../analytics/historicalVolatility";
import { calculateV3TickRange } from "../analytics/v3TickRange";
import { calculateVolatilityPriceBand } from "../analytics/volatilityPriceBand";

/*
 * The pure composition: three fetched inputs in, one range analysis out.
 *
 * This module performs no I/O and reads no clock. It takes the `DataResult`s a
 * caller already fetched, so the whole pipeline is testable without a network,
 * without credentials and without a server. The server-only wrapper beside it
 * supplies the fetches and nothing else.
 *
 * Pool identity is not re-checked here. Each calculator already refuses inputs
 * that describe different pools — volatility inherits the history's pool, the
 * band compares that against the snapshot's, and the range compares both against
 * the pool's — so a duplicate check here would add a second place to get it
 * wrong without adding a guarantee.
 */

/** Which stage of the pipeline produced a failure. */
export type PoolRangeAnalysisStep =
  | "pool"
  | "snapshot"
  | "history"
  | "volatility"
  | "band"
  | "range";

/**
 * Everything the pipeline produced, each stage kept rather than summarised.
 *
 * A consumer that only wants the two ticks reads `range.lowerTick`; one that
 * needs to explain where they came from has the snapshot, the volatility and the
 * band that produced them, with all of their provenance intact.
 */
export type PoolRangeAnalysis = {
  readonly pool: V3Pool;
  readonly snapshot: PoolMarketSnapshot;
  readonly history: PoolDailyPriceHistory;
  readonly volatility: HistoricalVolatility;
  readonly band: VolatilityPriceBand;
  readonly range: V3TickRange;
  readonly parameters: PriceBandParameters;
};

export type PoolRangeAnalysisResult =
  | { readonly status: "success"; readonly data: PoolRangeAnalysis }
  | {
      readonly status: "partial";
      readonly data: PoolRangeAnalysis;
      /** Caveats gathered from every stage, in pipeline order. */
      readonly warnings: readonly string[];
    }
  | {
      readonly status: "unavailable";
      /** Where it stopped, so a reader is not left guessing which figure is missing. */
      readonly step: PoolRangeAnalysisStep;
      readonly reason: DataFailureReason | AnalyticsFailureReason;
      /** Already sanitized by the stage that produced it; safe to show a user. */
      readonly message: string;
    };

export type PoolRangeAnalysisInput = {
  readonly pool: DataResult<V3Pool>;
  readonly snapshot: DataResult<PoolMarketSnapshot>;
  readonly history: DataResult<PoolDailyPriceHistory>;
  readonly parameters: PriceBandParameters;
};

/**
 * A starting point for display, not a recommendation.
 *
 * A 30-day horizon matches the history window the daily reader fetches, and a
 * multiplier of 1 is the plainest thing to explain: one horizon standard
 * deviation. Neither number encodes a view about what range anyone should hold.
 */
export const DEFAULT_PRICE_BAND_PARAMETERS: PriceBandParameters = {
  horizonDays: 30,
  standardDeviationMultiplier: 1,
};

/**
 * Unwraps a fetched result, collecting the caveats a partial one carries.
 *
 * A `partial` fetch is used, not refused: a snapshot that is missing rolling
 * volume still carries the price and tick this pipeline needs, and every figure
 * it *is* missing is either irrelevant here or fails a later stage on its own.
 * Its warnings are carried forward verbatim — they are fixed, already-sanitized
 * text by contract, so nothing from the wire is copied into them here.
 */
const unwrap = <T,>(
  result: DataResult<T>,
  warnings: string[],
):
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: DataFailureReason; readonly message: string } => {
  if (result.status === "unavailable") {
    return { ok: false, reason: result.reason, message: result.message };
  }
  if (result.status === "partial") warnings.push(...result.warnings);
  return { ok: true, value: result.data };
};

/**
 * Runs the deterministic half of the advisor: volatility, then a price band,
 * then the tick range that band aligns onto.
 *
 * Pure and clock-free. Identical input always produces a deeply equal result.
 *
 * Stops at the first stage that cannot produce a figure and says which one, so a
 * pool with two days of history and a pool behind an unreachable subgraph are
 * never reported the same way.
 */
export const analysePoolRange = (input: PoolRangeAnalysisInput): PoolRangeAnalysisResult => {
  const warnings: string[] = [];

  const pool = unwrap(input.pool, warnings);
  if (!pool.ok) {
    return { status: "unavailable", step: "pool", reason: pool.reason, message: pool.message };
  }

  const snapshot = unwrap(input.snapshot, warnings);
  if (!snapshot.ok) {
    return {
      status: "unavailable",
      step: "snapshot",
      reason: snapshot.reason,
      message: snapshot.message,
    };
  }

  const history = unwrap(input.history, warnings);
  if (!history.ok) {
    return {
      status: "unavailable",
      step: "history",
      reason: history.reason,
      message: history.message,
    };
  }

  const volatility = calculateHistoricalVolatility(history.value);
  if (volatility.status === "unavailable") {
    return {
      status: "unavailable",
      step: "volatility",
      reason: volatility.reason,
      message: volatility.message,
    };
  }
  if (volatility.status === "partial") warnings.push(...volatility.warnings);

  const band = calculateVolatilityPriceBand({
    snapshot: snapshot.value,
    volatility: volatility.data,
    horizonDays: input.parameters.horizonDays,
    standardDeviationMultiplier: input.parameters.standardDeviationMultiplier,
  });
  if (band.status === "unavailable") {
    return { status: "unavailable", step: "band", reason: band.reason, message: band.message };
  }
  if (band.status === "partial") warnings.push(...band.warnings);

  const range = calculateV3TickRange({
    pool: pool.value,
    band: band.data,
    snapshot: snapshot.value,
  });
  if (range.status === "unavailable") {
    return { status: "unavailable", step: "range", reason: range.reason, message: range.message };
  }
  if (range.status === "partial") warnings.push(...range.warnings);

  const data: PoolRangeAnalysis = {
    pool: pool.value,
    snapshot: snapshot.value,
    history: history.value,
    volatility: volatility.data,
    band: band.data,
    range: range.data,
    parameters: input.parameters,
  };

  if (warnings.length > 0) return { status: "partial", data, warnings };

  return { status: "success", data };
};
