import { describe, expect, it } from "vitest";

import {
  ANNUALIZATION_DAYS,
  MAX_HORIZON_DAYS,
  PRICE_BAND_METHOD,
  PriceBandParametersSchema,
  VolatilityPriceBandSchema,
} from "./index";

describe("PriceBandParametersSchema", () => {
  it.each([
    ["the shortest horizon", { horizonDays: 1, standardDeviationMultiplier: 1 }],
    ["the longest horizon", { horizonDays: 365, standardDeviationMultiplier: 2 }],
    ["a fractional multiplier", { horizonDays: 30, standardDeviationMultiplier: 1.645 }],
    ["a tiny multiplier", { horizonDays: 30, standardDeviationMultiplier: 1e-6 }],
  ])("accepts %s", (_label, value) => {
    expect(PriceBandParametersSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    ["a zero horizon", { horizonDays: 0, standardDeviationMultiplier: 1 }],
    ["a negative horizon", { horizonDays: -1, standardDeviationMultiplier: 1 }],
    ["a fractional horizon", { horizonDays: 30.5, standardDeviationMultiplier: 1 }],
    ["a horizon past the product scope", { horizonDays: 366, standardDeviationMultiplier: 1 }],
    ["a NaN horizon", { horizonDays: Number.NaN, standardDeviationMultiplier: 1 }],
    ["an infinite horizon", { horizonDays: Number.POSITIVE_INFINITY, standardDeviationMultiplier: 1 }],
    ["a zero multiplier", { horizonDays: 30, standardDeviationMultiplier: 0 }],
    ["a negative multiplier", { horizonDays: 30, standardDeviationMultiplier: -1 }],
    ["a NaN multiplier", { horizonDays: 30, standardDeviationMultiplier: Number.NaN }],
    ["an infinite multiplier", { horizonDays: 30, standardDeviationMultiplier: Number.POSITIVE_INFINITY }],
    ["an unexpected field", { horizonDays: 30, standardDeviationMultiplier: 1, confidenceLevel: 0.95 }],
  ])("rejects %s", (_label, value) => {
    expect(PriceBandParametersSchema.safeParse(value).success).toBe(false);
  });

  it("caps the horizon at the declared product scope", () => {
    expect(MAX_HORIZON_DAYS).toBe(365);
  });
});

describe("VolatilityPriceBandSchema", () => {
  const RANGE_START = "2026-07-20T00:00:00.000Z";
  const RANGE_END_EXCLUSIVE = "2026-08-20T00:00:00.000Z";
  const CURRENT_PRICE = 2500;

  /*
   * Hand-derived, independent of the calculator: price 2500, annualized
   * volatility 0.5, horizon 365, multiplier 1.
   *   horizonVol  = 0.5
   *   logDistance = 0.5
   *   lower       = 2500 · e^-0.5
   *   upper       = 2500 · e^+0.5
   */
  const LOG_DISTANCE = 0.5;
  const LOWER = CURRENT_PRICE * Math.E ** -LOG_DISTANCE;
  const UPPER = CURRENT_PRICE * Math.E ** LOG_DISTANCE;

  const band = (overrides: Record<string, unknown> = {}) => ({
    pool: { protocolVersion: "v3", chainId: 1, id: `0x${"d".repeat(40)}` },
    priceDirection: "token0PriceInToken1",
    method: PRICE_BAND_METHOD,
    annualizationDays: ANNUALIZATION_DAYS,
    horizonDays: 365,
    standardDeviationMultiplier: 1,
    currentPrice: CURRENT_PRICE,
    currentPriceFetchedAt: "2026-08-20T09:15:00.000Z",
    currentPriceSourceBlockNumber: "21500000",
    currentPriceSourceBlockTimestamp: "2026-08-20T09:14:48.000Z",
    volatilitySourceFetchedAt: "2026-08-20T09:15:00.000Z",
    volatilitySourceBlockNumber: "21500000",
    volatilitySourceBlockTimestamp: "2026-08-20T09:14:48.000Z",
    volatilityRangeStart: RANGE_START,
    volatilityRangeEndExclusive: RANGE_END_EXCLUSIVE,
    volatilityReturnCoverageRatio: 1,
    annualizedVolatility: 0.5,
    horizonVolatility: 0.5,
    logPriceDistance: LOG_DISTANCE,
    lowerPrice: LOWER,
    upperPrice: UPPER,
    downsideDistanceRatio: 1 - LOWER / CURRENT_PRICE,
    upsideDistanceRatio: UPPER / CURRENT_PRICE - 1,
    ...overrides,
  });

  const parse = (value: unknown) => VolatilityPriceBandSchema.safeParse(value);

  it("accepts a coherent hand-derived band", () => {
    expect(parse(band()).success).toBe(true);
  });

  it("accepts a collapsed zero-volatility band", () => {
    const collapsed = band({
      annualizedVolatility: 0,
      horizonVolatility: 0,
      logPriceDistance: 0,
      lowerPrice: CURRENT_PRICE,
      upperPrice: CURRENT_PRICE,
      downsideDistanceRatio: 0,
      upsideDistanceRatio: 0,
    });
    expect(parse(collapsed).success).toBe(true);
  });

  it("accepts a shorter horizon with correctly rescaled figures", () => {
    const hv = 0.5 * Math.sqrt(90 / 365);
    const lower = CURRENT_PRICE * Math.E ** -hv;
    const upper = CURRENT_PRICE * Math.E ** hv;
    const ninety = band({
      horizonDays: 90,
      horizonVolatility: hv,
      logPriceDistance: hv,
      lowerPrice: lower,
      upperPrice: upper,
      downsideDistanceRatio: 1 - lower / CURRENT_PRICE,
      upsideDistanceRatio: upper / CURRENT_PRICE - 1,
    });
    expect(parse(ninety).success).toBe(true);
  });

  describe("recomputes every derived figure", () => {
    it("rejects a wrong horizonVolatility", () => {
      const result = parse(band({ horizonVolatility: 0.9 }));

      expect(result.success).toBe(false);
      expect(result.error?.issues.some((issue) => issue.path[0] === "horizonVolatility")).toBe(true);
    });

    it("rejects a horizonVolatility that ignores the horizon", () => {
      // 0.5 is right for 365 days but wrong for 90.
      expect(parse(band({ horizonDays: 90 })).success).toBe(false);
    });

    it("rejects a wrong logPriceDistance", () => {
      const result = parse(band({ logPriceDistance: 0.75 }));

      expect(result.success).toBe(false);
      expect(result.error?.issues.some((issue) => issue.path[0] === "logPriceDistance")).toBe(true);
    });

    it("rejects a logPriceDistance that ignores the multiplier", () => {
      // With k = 2 the distance must be 1.0, not 0.5.
      expect(parse(band({ standardDeviationMultiplier: 2 })).success).toBe(false);
    });

    it.each([
      ["a lower price that is too low", { lowerPrice: LOWER * 0.5 }],
      ["a lower price that is too high", { lowerPrice: CURRENT_PRICE }],
      ["an upper price that is too high", { upperPrice: UPPER * 2 }],
      ["an upper price that is too low", { upperPrice: CURRENT_PRICE }],
      ["bounds swapped", { lowerPrice: UPPER, upperPrice: LOWER }],
    ])("rejects %s", (_label, overrides) => {
      expect(parse(band(overrides)).success).toBe(false);
    });

    it.each([
      ["a wrong downside ratio", { downsideDistanceRatio: 0.25 }],
      ["a wrong upside ratio", { upsideDistanceRatio: 0.25 }],
      ["a downside ratio mirroring the upside one", { downsideDistanceRatio: UPPER / CURRENT_PRICE - 1 }],
    ])("rejects %s", (_label, overrides) => {
      expect(parse(band(overrides)).success).toBe(false);
    });

    it("rejects bounds that are self-consistent but contradict the declared distance", () => {
      /*
       * Both bounds moved by the same factor in opposite directions: the ratios
       * still agree with the bounds, the geometric centre is still exactly the
       * current price, and the ordering holds. Only recomputing the bounds from
       * `logPriceDistance` reveals that they describe a 0.4 distance, not 0.5.
       */
      const shrunkLower = CURRENT_PRICE * Math.E ** -0.4;
      const grownUpper = CURRENT_PRICE * Math.E ** 0.4;
      const disguised = band({
        lowerPrice: shrunkLower,
        upperPrice: grownUpper,
        downsideDistanceRatio: 1 - shrunkLower / CURRENT_PRICE,
        upsideDistanceRatio: grownUpper / CURRENT_PRICE - 1,
      });

      // The decoys really are consistent, so nothing else would catch this.
      expect(shrunkLower * grownUpper).toBeCloseTo(CURRENT_PRICE * CURRENT_PRICE, 6);
      expect(shrunkLower).toBeLessThan(CURRENT_PRICE);
      expect(grownUpper).toBeGreaterThan(CURRENT_PRICE);

      const result = parse(disguised);
      expect(result.success).toBe(false);
      expect(
        result.error?.issues.some(
          (issue) => issue.path[0] === "lowerPrice" || issue.path[0] === "upperPrice",
        ),
      ).toBe(true);
    });

    it("rejects a band whose geometric centre is not the current price", () => {
      // Both bounds shifted the same way: ordering still holds, centre does not.
      expect(parse(band({ currentPrice: 3000 })).success).toBe(false);
    });
  });

  describe("domain constraints", () => {
    it.each([
      ["a zero current price", { currentPrice: 0 }],
      ["a negative current price", { currentPrice: -2500 }],
      ["a zero lower price", { lowerPrice: 0 }],
      ["an infinite upper price", { upperPrice: Number.POSITIVE_INFINITY }],
      ["a NaN volatility", { annualizedVolatility: Number.NaN }],
      ["a negative horizon volatility", { horizonVolatility: -0.5 }],
      ["a negative log distance", { logPriceDistance: -0.5 }],
      ["a negative downside ratio", { downsideDistanceRatio: -0.1 }],
      ["a coverage ratio above one", { volatilityReturnCoverageRatio: 1.5 }],
      ["a coverage ratio below zero", { volatilityReturnCoverageRatio: -0.1 }],
    ])("rejects %s", (_label, overrides) => {
      expect(parse(band(overrides)).success).toBe(false);
    });

    it.each([
      ["a v4 pool", { pool: { protocolVersion: "v4", chainId: 1, id: `0x${"c".repeat(64)}` } }],
      ["another chain", { pool: { protocolVersion: "v3", chainId: 8453, id: `0x${"d".repeat(40)}` } }],
      ["the opposite price direction", { priceDirection: "token1PriceInToken0" }],
      ["a different method label", { method: "garch-volatility-band" }],
      ["a 252-day basis", { annualizationDays: 252 }],
      ["an inverted volatility range", { volatilityRangeStart: RANGE_END_EXCLUSIVE, volatilityRangeEndExclusive: RANGE_START }],
      ["a malformed block number", { currentPriceSourceBlockNumber: "01" }],
      ["a block number as a JS number", { volatilitySourceBlockNumber: 21_500_000 }],
      ["a coarse timestamp", { currentPriceFetchedAt: "2026-08-20T09:15:00Z" }],
    ])("rejects %s", (_label, overrides) => {
      expect(parse(band(overrides)).success).toBe(false);
    });

    it.each([
      ["tickLower", { tickLower: -887_220 }],
      ["tickUpper", { tickUpper: 887_220 }],
      ["tickSpacing", { tickSpacing: 60 }],
      ["confidenceLevel", { confidenceLevel: 0.95 }],
      ["riskCategory", { riskCategory: "high" }],
      ["calculatedAt", { calculatedAt: "2026-08-20T09:15:00.000Z" }],
      ["a formatted percentage", { downsidePercent: "39.3%" }],
    ])("rejects the unexpected field %s", (_label, overrides) => {
      expect(parse(band(overrides)).success).toBe(false);
    });

    it("accepts null source block metadata", () => {
      const nulled = band({
        currentPriceSourceBlockNumber: null,
        currentPriceSourceBlockTimestamp: null,
        volatilitySourceBlockNumber: null,
        volatilitySourceBlockTimestamp: null,
      });
      expect(parse(nulled).success).toBe(true);
    });
  });
});
