import { z } from "zod";

import { ANALYTICS_CONSISTENCY_TOLERANCE, ANNUALIZATION_DAYS } from "./analytics";
import { IsoTimestampSchema, UnsignedIntegerStringSchema } from "./primitives";
import { PoolReferenceSchema } from "./uniswap";

/*
 * Contracts for a continuous volatility-based price band.
 *
 * The band is a statement about how far price has moved historically over a
 * horizon, not a forecast. It is centred geometrically on the current price and
 * symmetric in log space, which makes it deliberately asymmetric in ordinary
 * percentage terms: a move down to half price and a move up to double price are
 * the same distance in logs, and only one of them is "50%".
 *
 * Nothing here is a Uniswap position. A deployable range additionally needs the
 * pool's verified tick spacing, token ordering and token decimals, none of which
 * the normalized snapshot carries yet — so this layer stops at continuous prices
 * and states so in its method label.
 *
 * All figures are decimal ratios: 0.10 means 10%.
 */

/** The longest horizon this product currently models. */
export const MAX_HORIZON_DAYS = 365;

/**
 * Names the model, so a band is never compared against one built differently.
 *
 * "zero-drift" because the band assumes no expected return: it is centred on the
 * current price rather than on a projected one.
 */
export const PRICE_BAND_METHOD = "zero-drift-log-symmetric-historical-volatility-band";

/**
 * Reuses the analytics tolerance so both layers agree on what "consistent" means.
 * Relative with an absolute floor of 1, which matters here because `exp(log(p))`
 * does not round-trip exactly and the recomputation below must not fail on that.
 */
const TOLERANCE = ANALYTICS_CONSISTENCY_TOLERANCE;

const isCloseEnough = (actual: number, expected: number): boolean =>
  Math.abs(actual - expected) <= TOLERANCE * Math.max(1, Math.abs(expected));

/**
 * Caller-supplied band parameters.
 *
 * The multiplier is *not* a confidence level. Turning "2 standard deviations"
 * into "95% of the time" needs a distributional assumption this project has not
 * established and does not claim, so the field is named for what it is.
 */
export const PriceBandParametersSchema = z.strictObject({
  /** Calendar days the band looks ahead over. */
  horizonDays: z.int().min(1).max(MAX_HORIZON_DAYS),
  /** How many horizon standard deviations wide each side is. */
  standardDeviationMultiplier: z.number().positive(),
});

export type PriceBandParameters = z.infer<typeof PriceBandParametersSchema>;

/**
 * Recomputes the band independently of the production calculator.
 *
 * Written out here rather than imported for the same reason the volatility schema
 * has its own statistics helper: a validator that calls the function it is meant
 * to check would reproduce that function's bugs and agree with itself.
 */
const recomputeBand = (input: {
  readonly currentPrice: number;
  readonly annualizedVolatility: number;
  readonly horizonDays: number;
  readonly standardDeviationMultiplier: number;
}) => {
  const timeFractionYears = input.horizonDays / ANNUALIZATION_DAYS;
  const horizonVolatility = input.annualizedVolatility * Math.sqrt(timeFractionYears);
  const logPriceDistance = input.standardDeviationMultiplier * horizonVolatility;
  const logPrice = Math.log(input.currentPrice);

  return {
    horizonVolatility,
    logPriceDistance,
    lowerPrice: Math.exp(logPrice - logPriceDistance),
    upperPrice: Math.exp(logPrice + logPriceDistance),
  };
};

/** A finite, strictly positive price. */
const PositiveFinitePriceSchema = z.number().positive();

export const VolatilityPriceBandSchema = z
  .strictObject({
    pool: PoolReferenceSchema,
    /** Which direction every price here is quoted in. */
    priceDirection: z.literal("token0PriceInToken1"),
    method: z.literal(PRICE_BAND_METHOD),
    annualizationDays: z.literal(ANNUALIZATION_DAYS),

    horizonDays: z.int().min(1).max(MAX_HORIZON_DAYS),
    standardDeviationMultiplier: z.number().positive(),

    currentPrice: PositiveFinitePriceSchema,
    /** When the price was fetched — not when this band was calculated. */
    currentPriceFetchedAt: IsoTimestampSchema,
    currentPriceSourceBlockNumber: UnsignedIntegerStringSchema.nullable(),
    currentPriceSourceBlockTimestamp: IsoTimestampSchema.nullable(),

    volatilitySourceFetchedAt: IsoTimestampSchema,
    volatilitySourceBlockNumber: UnsignedIntegerStringSchema.nullable(),
    volatilitySourceBlockTimestamp: IsoTimestampSchema.nullable(),
    volatilityRangeStart: IsoTimestampSchema,
    volatilityRangeEndExclusive: IsoTimestampSchema,
    /** How much of the volatility window had usable returns behind it. */
    volatilityReturnCoverageRatio: z.number().min(0).max(1),

    annualizedVolatility: z.number().min(0),
    horizonVolatility: z.number().min(0),
    logPriceDistance: z.number().min(0),

    lowerPrice: PositiveFinitePriceSchema,
    upperPrice: PositiveFinitePriceSchema,
    downsideDistanceRatio: z.number().min(0),
    upsideDistanceRatio: z.number().min(0),
  })
  .refine((band) => band.pool.chainId === 1 && band.pool.protocolVersion === "v3", {
    error: "A price band can only describe an Ethereum mainnet v3 pool.",
    path: ["pool"],
  })
  .refine(
    (band) =>
      Date.parse(band.volatilityRangeStart) < Date.parse(band.volatilityRangeEndExclusive),
    {
      error: "volatilityRangeStart must be earlier than volatilityRangeEndExclusive.",
      path: ["volatilityRangeStart"],
    },
  )
  /*
   * Every derived figure is recomputed and compared, not trusted. A band whose
   * bounds describe a different volatility or horizon than it reports would
   * otherwise validate and look entirely well-formed.
   */
  .refine(
    (band) => isCloseEnough(band.horizonVolatility, recomputeBand(band).horizonVolatility),
    {
      error: "horizonVolatility must equal annualizedVolatility * sqrt(horizonDays / 365).",
      path: ["horizonVolatility"],
    },
  )
  .refine((band) => isCloseEnough(band.logPriceDistance, recomputeBand(band).logPriceDistance), {
    error: "logPriceDistance must equal standardDeviationMultiplier * horizonVolatility.",
    path: ["logPriceDistance"],
  })
  .refine((band) => isCloseEnough(band.lowerPrice, recomputeBand(band).lowerPrice), {
    error: "lowerPrice must equal exp(log(currentPrice) - logPriceDistance).",
    path: ["lowerPrice"],
  })
  .refine((band) => isCloseEnough(band.upperPrice, recomputeBand(band).upperPrice), {
    error: "upperPrice must equal exp(log(currentPrice) + logPriceDistance).",
    path: ["upperPrice"],
  })
  .refine(
    (band) => isCloseEnough(band.downsideDistanceRatio, 1 - band.lowerPrice / band.currentPrice),
    {
      error: "downsideDistanceRatio must equal 1 - lowerPrice / currentPrice.",
      path: ["downsideDistanceRatio"],
    },
  )
  .refine(
    (band) => isCloseEnough(band.upsideDistanceRatio, band.upperPrice / band.currentPrice - 1),
    {
      error: "upsideDistanceRatio must equal upperPrice / currentPrice - 1.",
      path: ["upsideDistanceRatio"],
    },
  )
  /*
   * The band's geometric centre is the current price: lower * upper == price².
   * Skipped when the product is not representable — two 1e300-scale bounds
   * overflow long before the band itself is invalid.
   */
  .refine(
    (band) => {
      const product = band.lowerPrice * band.upperPrice;
      const squared = band.currentPrice * band.currentPrice;
      if (!Number.isFinite(product) || !Number.isFinite(squared) || squared === 0) return true;
      return isCloseEnough(product, squared);
    },
    {
      error: "lowerPrice * upperPrice must equal currentPrice squared.",
      path: ["lowerPrice"],
    },
  )
  /*
   * `exp` is monotonic and the two exponents differ only in the sign of a
   * non-negative distance, so this ordering holds exactly.
   */
  .refine((band) => band.lowerPrice <= band.upperPrice, {
    error: "lowerPrice must not exceed upperPrice.",
    path: ["lowerPrice"],
  })
  /*
   * The bounds must bracket the current price. Compared with tolerance rather
   * than exactly because `exp(log(p))` does not round-trip to `p` — for some
   * prices it lands a few ulps above — so an exact `<=` would reject a
   * mathematically correct band over a rounding artefact.
   */
  .refine(
    (band) => band.lowerPrice <= band.currentPrice || isCloseEnough(band.lowerPrice, band.currentPrice),
    {
      error: "lowerPrice must not exceed currentPrice.",
      path: ["lowerPrice"],
    },
  )
  .refine(
    (band) => band.upperPrice >= band.currentPrice || isCloseEnough(band.upperPrice, band.currentPrice),
    {
      error: "upperPrice must not be below currentPrice.",
      path: ["upperPrice"],
    },
  );

export type VolatilityPriceBand = z.infer<typeof VolatilityPriceBandSchema>;
