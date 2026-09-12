import { z } from "zod";

import { VolatilityPriceBandSchema } from "./priceBand";
import { PositivePriceSchema } from "./primitives";
import { TickSchema, V3PoolSchema } from "./uniswap";

/*
 * Contract for a deployable Uniswap v3 tick range.
 *
 * This is the first model in the project that describes an actual position
 * boundary rather than a continuous price. A {@link VolatilityPriceBand} says how
 * far price has moved historically; a range says which two ticks a pool would
 * accept to express that, which needs three pool facts the band does not carry:
 * token ordering, token decimals and tick spacing.
 *
 * It is still not advice and still not a transaction. Nothing here sizes a
 * position, quotes an amount of either token, or claims the range is a good one.
 *
 * The band the range was aligned from is embedded whole rather than summarised,
 * so every figure keeps its provenance and its own invariants are re-checked
 * whenever a range is parsed.
 */

/** Names the alignment model, so two ranges built differently are never compared. */
export const V3_TICK_RANGE_METHOD = "tick-spacing-aligned-volatility-price-band";

/**
 * How far this application's own tick may sit from the tick the source reported
 * before the two are treated as describing different states.
 *
 * Both numbers floor to the tick containing the same price, so they agree
 * exactly unless float rounding of the source's published decimal price lands on
 * the other side of a tick boundary — a one-tick difference at most. Anything
 * wider means the price and the tick came from different moments, or the token
 * decimals used to convert are not the pool's, and no range should be published
 * from that pair.
 */
export const MAX_TICK_DISAGREEMENT = 1;

/**
 * How far a stored price may drift from its recomputed value.
 *
 * The recomputation below deliberately uses direct exponentiation where the
 * calculator works in log space, so the two disagree by rounding alone: measured
 * across the whole tick range and the whole decimal range, by at most ~1e-11
 * relative. This tolerance sits three orders of magnitude above that and four
 * below the ~1e-4 relative gap between adjacent ticks, so it absorbs the rounding
 * while still failing on a tick that is wrong by even one step.
 */
const TICK_PRICE_TOLERANCE = 1e-8;

const isCloseEnough = (actual: number, expected: number): boolean =>
  Math.abs(actual - expected) <= TICK_PRICE_TOLERANCE * Math.max(1, Math.abs(expected));

const isAtMost = (actual: number, limit: number): boolean =>
  actual <= limit || isCloseEnough(actual, limit);

const isAtLeast = (actual: number, limit: number): boolean =>
  actual >= limit || isCloseEnough(actual, limit);

/**
 * The price a tick encodes, recomputed for verification.
 *
 * Written as `1.0001^t * 10^(d0 - d1)` — direct exponentiation — where the
 * calculator evaluates `exp(t * ln(1.0001) - (d1 - d0) * ln(10))`. The two forms
 * are algebraically the same and computationally different, which is the point:
 * a validator that re-ran the calculator's own expression would reproduce its
 * bugs and agree with itself. Neither form can overflow, because the widest
 * result reachable is about 3.4e293.
 */
const recomputePriceAtTick = (
  tick: number,
  token0Decimals: number,
  token1Decimals: number,
): number => 1.0001 ** tick * 10 ** (token0Decimals - token1Decimals);

const V3TickRangeObject = z.strictObject({
  /** The pool the range is for, carrying the decimals and spacing it was built with. */
  pool: V3PoolSchema,
  /** The continuous band this range aligns, embedded whole. */
  band: VolatilityPriceBandSchema,
  method: z.literal(V3_TICK_RANGE_METHOD),

  /** The position's boundaries. Both are multiples of the pool's tick spacing. */
  lowerTick: TickSchema,
  upperTick: TickSchema,

  /**
   * What those boundaries mean as prices, in the band's direction.
   *
   * These are what a position would actually get, and they are not the band's
   * own bounds: alignment moves each edge outward to the nearest tick the pool
   * accepts, so a real range is normally a little wider than the band asked for.
   */
  lowerPrice: PositivePriceSchema,
  upperPrice: PositivePriceSchema,

  /** The tick containing the band's current price, computed by this application. */
  currentTick: TickSchema,
  /**
   * The tick the data source itself reported for the pool, or `null` when it
   * reported none. Kept beside `currentTick` rather than replacing it, so the
   * two can be compared instead of one silently standing in for the other.
   */
  chainReportedTick: TickSchema.nullable(),

  /**
   * `true` when this edge does not reach as far as the band asked, because there
   * is no tick beyond it that a pool would accept.
   */
  lowerBoundTruncated: z.boolean(),
  upperBoundTruncated: z.boolean(),

  /** Whether the pool's current tick sits inside the range, as Uniswap defines it. */
  containsCurrentPrice: z.boolean(),
});

export const V3TickRangeSchema = V3TickRangeObject
  .refine(
    (range) =>
      range.pool.protocolVersion === range.band.pool.protocolVersion &&
      range.pool.chainId === range.band.pool.chainId &&
      range.pool.id === range.band.pool.id,
    {
      // Aligning one pool's band with another pool's spacing and decimals would
      // produce a well-formed range for a position nobody asked for.
      error: "The range's pool and the band's pool must be the same pool.",
      path: ["pool"],
    },
  )
  .refine((range) => range.lowerTick < range.upperTick, {
    error: "lowerTick must be strictly below upperTick; a zero-width range is not a position.",
    path: ["lowerTick"],
  })
  .refine(
    (range) =>
      range.lowerTick % range.pool.tickSpacing === 0 &&
      range.upperTick % range.pool.tickSpacing === 0,
    {
      error: "Both boundaries must be multiples of the pool's tick spacing.",
      path: ["lowerTick"],
    },
  )
  /*
   * Every price is recomputed from its tick rather than trusted. A range whose
   * prices describe different ticks than it reports would otherwise validate and
   * read as entirely ordinary.
   */
  .refine(
    (range) =>
      isCloseEnough(
        range.lowerPrice,
        recomputePriceAtTick(
          range.lowerTick,
          range.pool.token0.decimals,
          range.pool.token1.decimals,
        ),
      ),
    {
      error: "lowerPrice must be the price lowerTick encodes for this pool's decimals.",
      path: ["lowerPrice"],
    },
  )
  .refine(
    (range) =>
      isCloseEnough(
        range.upperPrice,
        recomputePriceAtTick(
          range.upperTick,
          range.pool.token0.decimals,
          range.pool.token1.decimals,
        ),
      ),
    {
      error: "upperPrice must be the price upperTick encodes for this pool's decimals.",
      path: ["upperPrice"],
    },
  )
  /*
   * Bracketing and tightness together pin each boundary to exactly one tick,
   * without restating how the calculator found it: the edge must cover the band,
   * and the next tick inward must not.
   *
   * A truncated edge is exempt from both. It is the end of what a pool can
   * express, so it is allowed to fall short of the band, and there is no tick
   * beyond it to be tight against.
   */
  .refine(
    (range) =>
      range.lowerBoundTruncated || isAtMost(range.lowerPrice, range.band.lowerPrice),
    {
      error: "lowerPrice must not exceed the band's lower bound unless the edge was truncated.",
      path: ["lowerTick"],
    },
  )
  .refine(
    (range) =>
      range.lowerBoundTruncated ||
      recomputePriceAtTick(
        range.lowerTick + range.pool.tickSpacing,
        range.pool.token0.decimals,
        range.pool.token1.decimals,
      ) > range.band.lowerPrice,
    {
      error: "lowerTick must be the highest usable tick at or below the band's lower bound.",
      path: ["lowerTick"],
    },
  )
  .refine(
    (range) =>
      range.upperBoundTruncated || isAtLeast(range.upperPrice, range.band.upperPrice),
    {
      error: "upperPrice must not be below the band's upper bound unless the edge was truncated.",
      path: ["upperTick"],
    },
  )
  .refine(
    (range) =>
      range.upperBoundTruncated ||
      recomputePriceAtTick(
        range.upperTick - range.pool.tickSpacing,
        range.pool.token0.decimals,
        range.pool.token1.decimals,
      ) < range.band.upperPrice,
    {
      error: "upperTick must be the lowest usable tick at or above the band's upper bound.",
      path: ["upperTick"],
    },
  )
  /*
   * A truncated edge must actually be truncated. Without this the flag could be
   * set on an ordinary range to switch off both checks above.
   */
  .refine(
    (range) =>
      !range.lowerBoundTruncated || range.lowerPrice > range.band.lowerPrice,
    {
      error: "lowerBoundTruncated may only be set when the edge falls short of the band.",
      path: ["lowerBoundTruncated"],
    },
  )
  .refine(
    (range) =>
      !range.upperBoundTruncated || range.upperPrice < range.band.upperPrice,
    {
      error: "upperBoundTruncated may only be set when the edge falls short of the band.",
      path: ["upperBoundTruncated"],
    },
  )
  /* `currentTick` is the tick containing the current price: its own price is at
   * or below, and the next tick up is above. */
  .refine(
    (range) =>
      isAtMost(
        recomputePriceAtTick(
          range.currentTick,
          range.pool.token0.decimals,
          range.pool.token1.decimals,
        ),
        range.band.currentPrice,
      ) &&
      recomputePriceAtTick(
        range.currentTick + 1,
        range.pool.token0.decimals,
        range.pool.token1.decimals,
      ) > range.band.currentPrice,
    {
      error: "currentTick must be the tick containing the band's current price.",
      path: ["currentTick"],
    },
  )
  .refine(
    (range) =>
      range.chainReportedTick === null ||
      Math.abs(range.chainReportedTick - range.currentTick) <= MAX_TICK_DISAGREEMENT,
    {
      error:
        "The source's reported tick and the tick derived from its price describe different states.",
      path: ["chainReportedTick"],
    },
  )
  /* Uniswap's own in-range test: the lower bound is inclusive, the upper is not. */
  .refine(
    (range) =>
      range.containsCurrentPrice ===
      (range.lowerTick <= range.currentTick && range.currentTick < range.upperTick),
    {
      error: "containsCurrentPrice must state whether currentTick lies within [lower, upper).",
      path: ["containsCurrentPrice"],
    },
  );

export type V3TickRange = z.infer<typeof V3TickRangeSchema>;
