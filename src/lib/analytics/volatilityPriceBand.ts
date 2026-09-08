import {
  type AnalyticsResult,
  ANNUALIZATION_DAYS,
  type HistoricalVolatility,
  HistoricalVolatilitySchema,
  type PoolMarketSnapshot,
  PoolMarketSnapshotSchema,
  PRICE_BAND_METHOD,
  type PriceBandParameters,
  PriceBandParametersSchema,
  VOLATILITY_METHOD,
  type VolatilityPriceBand,
  VolatilityPriceBandSchema,
} from "../../schemas";

export type VolatilityPriceBandResult = AnalyticsResult<VolatilityPriceBand>;

const INVALID_INPUT =
  "The market data supplied for this price band is not valid, or the snapshot and volatility describe different pools.";
const NO_CURRENT_PRICE =
  "The current price for this pool is unavailable, so a price band cannot be centred.";
const CALCULATION_ERROR =
  "The price band calculation produced a result this application cannot verify.";

/*
 * Fixed warning text in a fixed order, so identical inputs warn identically and
 * nothing from the wire — pool address, timestamp, provider message — leaks into
 * something a user may eventually read.
 */
const INCOMPLETE_COVERAGE_WARNING =
  "Some days in the volatility window had no price, so this band is based on fewer daily returns than the window covers.";
const CURRENT_PRICE_FRESHNESS_WARNING =
  "The current price source did not report a block time, so how current it is could not be independently verified.";
const VOLATILITY_FRESHNESS_WARNING =
  "The volatility source did not report a block time, so how current it is could not be independently verified.";

const unavailable = (
  reason: "invalid-input" | "insufficient-data" | "calculation-error",
  message: string,
): VolatilityPriceBandResult => ({ status: "unavailable", reason, message });

export type VolatilityPriceBandInput = {
  readonly snapshot: PoolMarketSnapshot;
  readonly volatility: HistoricalVolatility;
} & PriceBandParameters;

/**
 * Builds a continuous, log-symmetric price band around the current pool price.
 *
 * Pure and clock-free: identical input always yields a deeply equal result.
 *
 * The model assumes zero drift — the band is centred on today's price, not on a
 * projected one — and is symmetric in log space, which makes it asymmetric in
 * percentage terms. It describes how far price has moved historically over a
 * horizon. It is not a forecast, and the multiplier is not a confidence level:
 * calling `2` a "95% band" would require a distributional assumption nothing here
 * establishes.
 *
 * The output is *not* a deployable Uniswap range. Converting these prices to
 * ticks needs the pool's verified tick spacing, token ordering and token
 * decimals, which the normalized snapshot does not yet carry.
 *
 * Both inputs are re-parsed through their own schemas even though they arrive
 * typed: this is a public boundary, and a cast or a JSON payload can deliver
 * something the arithmetic's invariants do not hold for.
 */
export const calculateVolatilityPriceBand = (
  input: VolatilityPriceBandInput,
): VolatilityPriceBandResult => {
  const parameters = PriceBandParametersSchema.safeParse({
    horizonDays: input.horizonDays,
    standardDeviationMultiplier: input.standardDeviationMultiplier,
  });
  if (!parameters.success) return unavailable("invalid-input", INVALID_INPUT);

  const snapshot = PoolMarketSnapshotSchema.safeParse(input.snapshot);
  if (!snapshot.success) return unavailable("invalid-input", INVALID_INPUT);

  const volatility = HistoricalVolatilitySchema.safeParse(input.volatility);
  if (!volatility.success) return unavailable("invalid-input", INVALID_INPUT);

  const { data: price } = snapshot;
  const { data: vol } = volatility;

  /*
   * Both inputs must describe the same pool. Without this, a band could centre
   * one pool's price on another pool's volatility and look entirely well-formed —
   * the single most dangerous way this calculation could be wrong.
   */
  if (
    price.pool.protocolVersion !== vol.pool.protocolVersion ||
    price.pool.chainId !== vol.pool.chainId ||
    price.pool.id !== vol.pool.id
  ) {
    return unavailable("invalid-input", INVALID_INPUT);
  }

  // Both sides must quote the same direction, or the band would be built around
  // one price and measured with the other's dispersion.
  if (vol.priceDirection !== "token0PriceInToken1") {
    return unavailable("invalid-input", INVALID_INPUT);
  }

  // Guard the provenance the band inherits: a differently-derived volatility
  // would make the horizon scaling below mean something else.
  if (vol.method !== VOLATILITY_METHOD || vol.annualizationDays !== ANNUALIZATION_DAYS) {
    return unavailable("invalid-input", INVALID_INPUT);
  }

  const currentPrice = price.token0PriceInToken1;
  if (currentPrice === null) return unavailable("insufficient-data", NO_CURRENT_PRICE);

  const timeFractionYears = parameters.data.horizonDays / ANNUALIZATION_DAYS;
  const horizonVolatility = vol.annualizedVolatility * Math.sqrt(timeFractionYears);
  const logPriceDistance = parameters.data.standardDeviationMultiplier * horizonVolatility;

  /*
   * A zero distance is a real state — a pool whose price never moved has no
   * measured dispersion — and its band is the price itself. It is computed by
   * identity rather than through `exp(log(p))`, which does not round-trip exactly
   * and for some prices lands a few ulps *above* `p`; that would invert the band
   * and turn a valid collapsed result into a failure.
   *
   * This is not a minimum width and not a clamp. Deciding whether a zero-width
   * band is deployable belongs to the later tick-alignment and policy layers.
   */
  const logPrice = Math.log(currentPrice);
  const lowerPrice = logPriceDistance === 0 ? currentPrice : Math.exp(logPrice - logPriceDistance);
  const upperPrice = logPriceDistance === 0 ? currentPrice : Math.exp(logPrice + logPriceDistance);

  /*
   * Fail closed on anything the exponential could not represent. An underflowed
   * lower bound arrives as exactly 0 and an overflowed upper bound as Infinity;
   * both are reported rather than replaced with an artificial bound, because a
   * substituted number would be indistinguishable from a real one downstream.
   */
  if (
    !Number.isFinite(horizonVolatility) ||
    !Number.isFinite(logPriceDistance) ||
    !Number.isFinite(lowerPrice) ||
    !Number.isFinite(upperPrice) ||
    lowerPrice <= 0 ||
    upperPrice <= 0
  ) {
    return unavailable("calculation-error", CALCULATION_ERROR);
  }

  const candidate = {
    pool: price.pool,
    priceDirection: vol.priceDirection,
    method: PRICE_BAND_METHOD,
    annualizationDays: ANNUALIZATION_DAYS,

    horizonDays: parameters.data.horizonDays,
    standardDeviationMultiplier: parameters.data.standardDeviationMultiplier,

    currentPrice,
    currentPriceFetchedAt: price.fetchedAt,
    currentPriceSourceBlockNumber: price.sourceBlockNumber,
    currentPriceSourceBlockTimestamp: price.sourceBlockTimestamp,

    volatilitySourceFetchedAt: vol.sourceFetchedAt,
    volatilitySourceBlockNumber: vol.sourceBlockNumber,
    volatilitySourceBlockTimestamp: vol.sourceBlockTimestamp,
    volatilityRangeStart: vol.rangeStart,
    volatilityRangeEndExclusive: vol.rangeEndExclusive,
    volatilityReturnCoverageRatio: vol.returnCoverageRatio,

    annualizedVolatility: vol.annualizedVolatility,
    horizonVolatility,
    logPriceDistance,

    lowerPrice,
    upperPrice,
    downsideDistanceRatio: 1 - lowerPrice / currentPrice,
    upsideDistanceRatio: upperPrice / currentPrice - 1,
  };

  // The schema is the final authority: it re-derives every figure independently,
  // so an arithmetic slip cannot be published.
  const band = VolatilityPriceBandSchema.safeParse(candidate);
  if (!band.success) return unavailable("calculation-error", CALCULATION_ERROR);

  const warnings: string[] = [];
  if (vol.returnCoverageRatio < 1) warnings.push(INCOMPLETE_COVERAGE_WARNING);
  if (price.sourceBlockTimestamp === null) warnings.push(CURRENT_PRICE_FRESHNESS_WARNING);
  if (vol.sourceBlockTimestamp === null) warnings.push(VOLATILITY_FRESHNESS_WARNING);

  if (warnings.length > 0) return { status: "partial", data: band.data, warnings };

  return { status: "success", data: band.data };
};
