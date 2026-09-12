import {
  type AnalyticsResult,
  MAX_TICK_DISAGREEMENT,
  type PoolMarketSnapshot,
  PoolMarketSnapshotSchema,
  V3_TICK_RANGE_METHOD,
  type V3Pool,
  V3PoolSchema,
  type V3TickRange,
  V3TickRangeSchema,
  type VolatilityPriceBand,
  VolatilityPriceBandSchema,
} from "../../schemas";
import {
  alignTickDown,
  alignTickUp,
  priceAtTick,
  tickAtOrAbovePrice,
  tickAtOrBelowPrice,
} from "../uniswap/v3TickMath";

export type V3TickRangeResult = AnalyticsResult<V3TickRange>;

const INVALID_INPUT =
  "The pool, price band and snapshot supplied for this range are not valid, or they do not all describe the same pool and the same observation.";
const CURRENT_PRICE_UNREPRESENTABLE =
  "This pool's current price lies outside the range Uniswap can express as a tick, so no position range can be built from it.";
const TICK_DISAGREEMENT =
  "The source's own tick for this pool does not match the tick its price implies for these token decimals, so no range is published.";
const TOO_NARROW =
  "The price band is narrower than one tick spacing on this pool, so it does not describe two distinct position boundaries.";
const CALCULATION_ERROR =
  "The tick range calculation produced a result this application cannot verify.";

/* Fixed warning text in a fixed order, so identical inputs warn identically. */
const LOWER_TRUNCATED_WARNING =
  "The lower edge stops at the lowest tick this pool accepts, so the range does not reach as far down as the band.";
const UPPER_TRUNCATED_WARNING =
  "The upper edge stops at the highest tick this pool accepts, so the range does not reach as far up as the band.";
const UNVERIFIED_TICK_WARNING =
  "The price source did not report the pool's own tick, so the converted tick could not be checked against it.";
const OUT_OF_RANGE_WARNING =
  "The pool's current tick lies outside this range, so a position built from it would hold a single token and earn nothing until price returns.";

const unavailable = (
  reason: "invalid-input" | "insufficient-data" | "calculation-error",
  message: string,
): V3TickRangeResult => ({ status: "unavailable", reason, message });

export type V3TickRangeInput = {
  readonly pool: V3Pool;
  readonly band: VolatilityPriceBand;
  /**
   * The snapshot the band's current price came from.
   *
   * Required, not optional, because it is the only place the pool's own reported
   * tick is available — and that tick is the one independent check on whether
   * the decimals used here really belong to this pool.
   */
  readonly snapshot: PoolMarketSnapshot;
};

/**
 * Aligns a continuous price band onto a pool's tick grid.
 *
 * Pure and clock-free: identical input always yields a deeply equal result.
 *
 * Each edge is moved outward, never inward — the lower bound rounds down and the
 * upper bound rounds up — so the resulting range always covers at least the band
 * it came from. Rounding inward would quietly hand back a narrower position than
 * the band described while still looking like the band's range.
 *
 * The result is a pair of ticks, not a position: it says nothing about how much
 * of either token to deposit, and nothing about whether the range is a good one.
 *
 * All three inputs are re-parsed through their own schemas even though they
 * arrive typed, because this is a public boundary where a cast or a JSON payload
 * can deliver a shape the arithmetic's invariants do not hold for.
 */
export const calculateV3TickRange = (input: V3TickRangeInput): V3TickRangeResult => {
  const pool = V3PoolSchema.safeParse(input.pool);
  if (!pool.success) return unavailable("invalid-input", INVALID_INPUT);

  const band = VolatilityPriceBandSchema.safeParse(input.band);
  if (!band.success) return unavailable("invalid-input", INVALID_INPUT);

  const snapshot = PoolMarketSnapshotSchema.safeParse(input.snapshot);
  if (!snapshot.success) return unavailable("invalid-input", INVALID_INPUT);

  /*
   * All three must describe the same pool. Aligning one pool's band with
   * another's decimals and tick spacing yields a perfectly well-formed range for
   * a position nobody asked for.
   */
  if (
    pool.data.protocolVersion !== band.data.pool.protocolVersion ||
    pool.data.chainId !== band.data.pool.chainId ||
    pool.data.id !== band.data.pool.id ||
    pool.data.protocolVersion !== snapshot.data.pool.protocolVersion ||
    pool.data.chainId !== snapshot.data.pool.chainId ||
    pool.data.id !== snapshot.data.pool.id
  ) {
    return unavailable("invalid-input", INVALID_INPUT);
  }

  /*
   * The snapshot must be the exact observation the band was centred on, or its
   * tick would be checked against a price from a different moment. Compared by
   * value rather than by trust: the band copies these fields verbatim, so any
   * difference means the caller paired two unrelated reads.
   */
  if (
    snapshot.data.token0PriceInToken1 !== band.data.currentPrice ||
    snapshot.data.fetchedAt !== band.data.currentPriceFetchedAt ||
    snapshot.data.sourceBlockNumber !== band.data.currentPriceSourceBlockNumber ||
    snapshot.data.sourceBlockTimestamp !== band.data.currentPriceSourceBlockTimestamp
  ) {
    return unavailable("invalid-input", INVALID_INPUT);
  }

  const decimals = {
    token0Decimals: pool.data.token0.decimals,
    token1Decimals: pool.data.token1.decimals,
  } as const;

  const current = tickAtOrBelowPrice({ price: band.data.currentPrice, ...decimals });
  const lowerIdeal = tickAtOrBelowPrice({ price: band.data.lowerPrice, ...decimals });
  const upperIdeal = tickAtOrAbovePrice({ price: band.data.upperPrice, ...decimals });

  // Unreachable for input that has passed the schemas above — every price is
  // finite and positive and every decimals value is a uint8. Present to
  // discharge the nullable return type, not because a failure is expected.
  if (current === null || lowerIdeal === null || upperIdeal === null) {
    return unavailable("calculation-error", CALCULATION_ERROR);
  }

  /*
   * A clamped *current* price is not a truncated edge, it is a contradiction: an
   * on-chain pool always has a representable spot price, so a price outside
   * TickMath's range means the price and the decimals do not belong together.
   */
  if (current.clampedTo !== null) {
    return unavailable("invalid-input", CURRENT_PRICE_UNREPRESENTABLE);
  }

  /*
   * The one check that does not rely on this application's own arithmetic. The
   * source publishes both the pool's tick and its price; converting the price
   * must land on that tick. If it does not, the decimals in hand are not this
   * pool's, and every figure below would be wrong by orders of magnitude while
   * still looking like an ordinary tick.
   */
  const chainReportedTick = snapshot.data.tick;
  if (
    chainReportedTick !== null &&
    Math.abs(chainReportedTick - current.tick) > MAX_TICK_DISAGREEMENT
  ) {
    return unavailable("invalid-input", TICK_DISAGREEMENT);
  }

  const tickSpacing = pool.data.tickSpacing;
  const lowerTick = alignTickDown({ tick: lowerIdeal.tick, tickSpacing });
  const upperTick = alignTickUp({ tick: upperIdeal.tick, tickSpacing });

  // Unreachable for the same reason as above: the spacing came from `V3Pool`.
  if (lowerTick === null || upperTick === null) {
    return unavailable("calculation-error", CALCULATION_ERROR);
  }

  /*
   * Both edges landing on one tick is a real state — a band narrower than the
   * pool's spacing, which a zero-volatility window produces — and it is reported
   * rather than widened. Widening would invent a range the band never described;
   * whether to accept a wider one is a policy decision, made somewhere that can
   * say so.
   */
  if (lowerTick >= upperTick) return unavailable("insufficient-data", TOO_NARROW);

  const lowerPrice = priceAtTick({ tick: lowerTick, ...decimals });
  const upperPrice = priceAtTick({ tick: upperTick, ...decimals });

  if (lowerPrice === null || upperPrice === null) {
    return unavailable("calculation-error", CALCULATION_ERROR);
  }

  /*
   * An edge is truncated exactly when it could not go where it was asked to.
   * Decided on integers rather than by comparing prices: alignment only ever
   * moves the lower edge down, so a lower tick that came back *above* the ideal
   * one can only have been pulled up by the usable-range clamp.
   */
  const lowerBoundTruncated = lowerIdeal.clampedTo !== null || lowerTick > lowerIdeal.tick;
  const upperBoundTruncated = upperIdeal.clampedTo !== null || upperTick < upperIdeal.tick;

  const containsCurrentPrice = lowerTick <= current.tick && current.tick < upperTick;

  const candidate = {
    pool: pool.data,
    band: band.data,
    method: V3_TICK_RANGE_METHOD,

    lowerTick,
    upperTick,
    lowerPrice,
    upperPrice,

    currentTick: current.tick,
    chainReportedTick,

    lowerBoundTruncated,
    upperBoundTruncated,
    containsCurrentPrice,
  };

  // The schema is the final authority: it re-derives every price from its tick
  // by a different route, and pins each boundary to exactly one tick.
  const range = V3TickRangeSchema.safeParse(candidate);
  if (!range.success) return unavailable("calculation-error", CALCULATION_ERROR);

  const warnings: string[] = [];
  if (lowerBoundTruncated) warnings.push(LOWER_TRUNCATED_WARNING);
  if (upperBoundTruncated) warnings.push(UPPER_TRUNCATED_WARNING);
  if (chainReportedTick === null) warnings.push(UNVERIFIED_TICK_WARNING);
  if (!containsCurrentPrice) warnings.push(OUT_OF_RANGE_WARNING);

  if (warnings.length > 0) return { status: "partial", data: range.data, warnings };

  return { status: "success", data: range.data };
};
