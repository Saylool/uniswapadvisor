import { describe, expect, it } from "vitest";

import {
  ANNUALIZATION_DAYS,
  type HistoricalVolatility,
  type PoolMarketSnapshot,
  PRICE_BAND_METHOD,
  VOLATILITY_METHOD,
} from "../../schemas";
import { calculateVolatilityPriceBand } from "./volatilityPriceBand";

const DAY_MS = 86_400_000;
const RANGE_START = "2026-07-20T00:00:00.000Z";
const RANGE_END_EXCLUSIVE = "2026-08-20T00:00:00.000Z";
const DAY_ZERO = Date.parse(RANGE_START);
const at = (dayIndex: number) => new Date(DAY_ZERO + dayIndex * DAY_MS).toISOString();

const POOL = { protocolVersion: "v3", chainId: 1, id: `0x${"d".repeat(40)}` };
const CURRENT_PRICE = 2500;

const snapshot = (overrides: Record<string, unknown> = {}) => ({
  pool: POOL,
  fetchedAt: "2026-08-20T09:15:00.000Z",
  sourceBlockNumber: "21500000",
  sourceBlockTimestamp: "2026-08-20T09:14:48.000Z",
  token0PriceInToken1: CURRENT_PRICE,
  token1PriceInToken0: 1 / CURRENT_PRICE,
  tvlUsd: 1234.56,
  volume24hUsd: null,
  volume7dUsd: null,
  volume30dUsd: null,
  tick: -12345,
  liquidity: "123456789012345678901234567890",
  source: "uniswap-v3-subgraph",
  ...overrides,
});

const returnAt = (dayIndex: number, logReturn: number) => ({
  fromTimestamp: at(dayIndex),
  toTimestamp: at(dayIndex + 1),
  logReturn,
});

/**
 * Builds a coherent volatility fixture for a target sample standard deviation.
 *
 * Two returns at ∓ sd·√2/2 have mean 0 and sample sd exactly `sd`:
 * variance = ((r - 0)² + (-r - 0)²) / (2 - 1) = 2r², so sd = r·√2.
 */
const volatilityWithSd = (sd: number, overrides: Record<string, unknown> = {}) => {
  const half = (sd * Math.SQRT2) / 2;
  return {
    pool: POOL,
    sourceFetchedAt: "2026-08-20T09:15:00.000Z",
    sourceBlockNumber: "21500000",
    sourceBlockTimestamp: "2026-08-20T09:14:48.000Z",
    rangeStart: RANGE_START,
    rangeEndExclusive: RANGE_END_EXCLUSIVE,
    priceDirection: "token0PriceInToken1",
    source: "uniswap-v3-subgraph",
    method: VOLATILITY_METHOD,
    annualizationDays: ANNUALIZATION_DAYS,
    expectedObservationCount: 31,
    observationCount: 31,
    expectedReturnCount: 30,
    usableReturnCount: 30,
    missingReturnCount: 0,
    returnCoverageRatio: 1,
    // Padded to 30 coherent returns so coverage can be complete: the extra
    // entries repeat the same ∓half pattern, which preserves mean 0 and sd.
    dailyLogReturns: Array.from({ length: 30 }, (_unused, index) =>
      returnAt(index, index % 2 === 0 ? -half : half),
    ),
    meanDailyLogReturn: 0,
    dailyVolatility: sd / Math.sqrt(ANNUALIZATION_DAYS),
    annualizedVolatility: sd,
    ...overrides,
  };
};

/**
 * The padded 30-return series above has mean 0 and a sample sd of
 * |half| · √(30/29), so the annualized figure must be derived from that, not
 * from the two-point shortcut. Solve for the `half` that yields the wanted
 * annualized volatility.
 */
const volatilityForAnnualized = (annualized: number, overrides: Record<string, unknown> = {}) => {
  // For 30 alternating ∓h values: mean 0, sum of squares 30h², sample sd = h·√(30/29).
  // dailyVolatility = annualized / √365, so h = dailyVolatility / √(30/29).
  const dailyVolatility = annualized / Math.sqrt(ANNUALIZATION_DAYS);
  const half = dailyVolatility / Math.sqrt(30 / 29);
  return {
    ...volatilityWithSd(0),
    dailyLogReturns: Array.from({ length: 30 }, (_unused, index) =>
      returnAt(index, index % 2 === 0 ? -half : half),
    ),
    meanDailyLogReturn: 0,
    dailyVolatility,
    annualizedVolatility: annualized,
    ...overrides,
  };
};

const calculate = (input: {
  snapshot?: unknown;
  volatility?: unknown;
  horizonDays?: unknown;
  standardDeviationMultiplier?: unknown;
}) =>
  calculateVolatilityPriceBand({
    snapshot: (input.snapshot ?? snapshot()) as PoolMarketSnapshot,
    volatility: (input.volatility ?? volatilityForAnnualized(0.5)) as HistoricalVolatility,
    horizonDays: (input.horizonDays ?? 365) as number,
    standardDeviationMultiplier: (input.standardDeviationMultiplier ?? 1) as number,
  });

describe("known band arithmetic", () => {
  /*
   * Hand-derived for price 2500, annualized volatility 0.5, horizon 365, k = 1:
   *   timeFraction     = 365 / 365 = 1
   *   horizonVol       = 0.5 * sqrt(1) = 0.5
   *   logDistance      = 1 * 0.5 = 0.5
   *   lower            = 2500 * e^-0.5 = 2500 * 0.6065306597126334 = 1516.3266492815835
   *   upper            = 2500 * e^+0.5 = 2500 * 1.6487212707001282 = 4121.803176750321
   *   downside         = 1 - e^-0.5 = 0.3934693402873666
   *   upside           = e^+0.5 - 1 = 0.6487212707001282
   */
  const result = calculate({});

  it("produces the hand-checked bounds", () => {
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.data.horizonVolatility).toBeCloseTo(0.5, 12);
    expect(result.data.logPriceDistance).toBeCloseTo(0.5, 12);
    expect(result.data.lowerPrice).toBeCloseTo(2500 * Math.E ** -0.5, 9);
    expect(result.data.upperPrice).toBeCloseTo(2500 * Math.E ** 0.5, 9);
  });

  it("reports asymmetric percentage distances from a log-symmetric band", () => {
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.data.downsideDistanceRatio).toBeCloseTo(0.3934693402873666, 12);
    expect(result.data.upsideDistanceRatio).toBeCloseTo(0.6487212707001282, 12);
    // Equal in log space, unequal in percentage space — the whole point.
    expect(result.data.upsideDistanceRatio).toBeGreaterThan(result.data.downsideDistanceRatio);
  });

  it("is symmetric in log space", () => {
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    const downLog = Math.log(result.data.currentPrice) - Math.log(result.data.lowerPrice);
    const upLog = Math.log(result.data.upperPrice) - Math.log(result.data.currentPrice);
    expect(downLog).toBeCloseTo(upLog, 12);
    expect(downLog).toBeCloseTo(0.5, 12);
  });

  it("centres the band geometrically on the current price", () => {
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(Math.sqrt(result.data.lowerPrice * result.data.upperPrice)).toBeCloseTo(
      CURRENT_PRICE,
      9,
    );
  });

  it("keeps the 365-day annualization basis", () => {
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.data.annualizationDays).toBe(365);
    expect(result.data.method).toBe(PRICE_BAND_METHOD);
  });

  it("scales the horizon by sqrt(horizonDays / 365)", () => {
    const ninety = calculate({ horizonDays: 90 });

    expect(ninety.status).toBe("success");
    if (ninety.status !== "success") return;
    // 0.5 * sqrt(90/365) = 0.5 * 0.49656353316142077 = 0.24828176658071038
    expect(ninety.data.horizonVolatility).toBeCloseTo(0.24828176658071038, 12);
    // The ratio against the full-year horizon is exactly sqrt(90 / 365).
    const fullYear = calculate({ horizonDays: 365 });
    expect(fullYear.status).toBe("success");
    if (fullYear.status !== "success") return;
    expect(ninety.data.horizonVolatility / fullYear.data.horizonVolatility).toBeCloseTo(
      Math.sqrt(90 / 365),
      12,
    );
  });

  it("scales the log distance linearly with the multiplier", () => {
    const single = calculate({ standardDeviationMultiplier: 1 });
    const double = calculate({ standardDeviationMultiplier: 2 });

    expect(single.status).toBe("success");
    expect(double.status).toBe("success");
    if (single.status !== "success" || double.status !== "success") return;
    expect(double.data.logPriceDistance).toBeCloseTo(2 * single.data.logPriceDistance, 12);
    // The horizon volatility itself is unchanged by the multiplier.
    expect(double.data.horizonVolatility).toBeCloseTo(single.data.horizonVolatility, 12);
  });

  it("is deterministic", () => {
    expect(calculate({})).toEqual(calculate({}));
  });
});

describe("zero volatility", () => {
  const result = calculate({ volatility: volatilityForAnnualized(0) });

  it("collapses the band onto the current price without failing", () => {
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.data.horizonVolatility).toBe(0);
    expect(result.data.logPriceDistance).toBe(0);
    expect(result.data.lowerPrice).toBe(CURRENT_PRICE);
    expect(result.data.upperPrice).toBe(CURRENT_PRICE);
    expect(result.data.downsideDistanceRatio).toBe(0);
    expect(result.data.upsideDistanceRatio).toBe(0);
  });

  it("invents no minimum width", () => {
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.data.upperPrice - result.data.lowerPrice).toBe(0);
  });
});

describe("coverage and freshness warnings", () => {
  it("succeeds without warnings when everything is complete", () => {
    const result = calculate({});
    expect(result.status).toBe("success");
  });

  it("returns partial when volatility coverage is incomplete", () => {
    const incomplete = volatilityForAnnualized(0.5, {
      usableReturnCount: 20,
      missingReturnCount: 10,
      returnCoverageRatio: 20 / 30,
      observationCount: 21,
      dailyLogReturns: Array.from({ length: 20 }, (_unused, index) =>
        returnAt(index, index % 2 === 0 ? -0.1 : 0.1),
      ),
      meanDailyLogReturn: 0,
      dailyVolatility: 0.1 * Math.sqrt(20 / 19),
      annualizedVolatility: 0.1 * Math.sqrt(20 / 19) * Math.sqrt(365),
    });
    const result = calculate({ volatility: incomplete });

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("fewer daily returns");
  });

  it("returns partial when the current price has no source block time", () => {
    const result = calculate({ snapshot: snapshot({ sourceBlockTimestamp: null }) });

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.warnings).toEqual([expect.stringContaining("current price source")]);
  });

  it("returns partial when the volatility has no source block time", () => {
    const result = calculate({
      volatility: volatilityForAnnualized(0.5, { sourceBlockTimestamp: null }),
    });

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.warnings).toEqual([expect.stringContaining("volatility source")]);
  });

  it("orders several warnings deterministically", () => {
    const incomplete = volatilityForAnnualized(0.5, {
      usableReturnCount: 20,
      missingReturnCount: 10,
      returnCoverageRatio: 20 / 30,
      observationCount: 21,
      sourceBlockTimestamp: null,
      dailyLogReturns: Array.from({ length: 20 }, (_unused, index) =>
        returnAt(index, index % 2 === 0 ? -0.1 : 0.1),
      ),
      meanDailyLogReturn: 0,
      dailyVolatility: 0.1 * Math.sqrt(20 / 19),
      annualizedVolatility: 0.1 * Math.sqrt(20 / 19) * Math.sqrt(365),
    });
    const result = calculate({
      snapshot: snapshot({ sourceBlockTimestamp: null }),
      volatility: incomplete,
    });

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.warnings).toHaveLength(3);
    expect(result.warnings[0]).toContain("fewer daily returns");
    expect(result.warnings[1]).toContain("current price source");
    expect(result.warnings[2]).toContain("volatility source");
  });

  it("keeps warnings free of pool addresses, timestamps and provider text", () => {
    const result = calculate({ snapshot: snapshot({ sourceBlockTimestamp: null }) });

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    for (const warning of result.warnings) {
      expect(warning).not.toContain(POOL.id);
      expect(warning).not.toContain("2026-");
      expect(warning).not.toContain("uniswap-v3-subgraph");
    }
  });
});

describe("rejected input", () => {
  it("reports a missing current price as insufficient-data", () => {
    const noPrice = snapshot({ token0PriceInToken1: null, token1PriceInToken0: null });

    expect(calculate({ snapshot: noPrice })).toMatchObject({
      status: "unavailable",
      reason: "insufficient-data",
    });
  });

  it.each([
    ["a different pool address", { id: `0x${"9".repeat(40)}` }],
    ["a different chain", { chainId: 8453 }],
  ])("rejects %s between the two inputs", (_label, poolOverride) => {
    const otherPool = volatilityForAnnualized(0.5, { pool: { ...POOL, ...poolOverride } });

    expect(calculate({ volatility: otherPool })).toMatchObject({
      status: "unavailable",
      reason: "invalid-input",
    });
  });

  it("rejects a mismatched protocol version", () => {
    const v4Snapshot = snapshot({
      pool: { protocolVersion: "v4", chainId: 1, id: `0x${"c".repeat(64)}` },
    });

    expect(calculate({ snapshot: v4Snapshot })).toMatchObject({
      status: "unavailable",
      reason: "invalid-input",
    });
  });

  it("rejects a volatility quoted in the opposite direction", () => {
    const flipped = volatilityForAnnualized(0.5, { priceDirection: "token1PriceInToken0" });

    expect(calculate({ volatility: flipped })).toMatchObject({
      status: "unavailable",
      reason: "invalid-input",
    });
  });

  it.each([
    ["a different volatility method", { method: "parkinson-range-volatility" }],
    ["a 252-day annualization basis", { annualizationDays: 252 }],
  ])("rejects %s", (_label, overrides) => {
    expect(calculate({ volatility: volatilityForAnnualized(0.5, overrides) })).toMatchObject({
      status: "unavailable",
      reason: "invalid-input",
    });
  });

  it.each([
    ["zero", 0],
    ["negative", -30],
    ["fractional", 30.5],
    ["above the 365-day scope", 366],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a numeric string", "30"],
  ])("rejects a horizon that is %s", (_label, horizonDays) => {
    expect(calculate({ horizonDays })).toMatchObject({
      status: "unavailable",
      reason: "invalid-input",
    });
  });

  it("accepts the boundary horizons", () => {
    expect(calculate({ horizonDays: 1 }).status).toBe("success");
    expect(calculate({ horizonDays: 365 }).status).toBe("success");
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a numeric string", "2"],
  ])("rejects a multiplier that is %s", (_label, standardDeviationMultiplier) => {
    expect(calculate({ standardDeviationMultiplier })).toMatchObject({
      status: "unavailable",
      reason: "invalid-input",
    });
  });

  it("rejects a malformed snapshot", () => {
    expect(calculate({ snapshot: { pool: POOL } })).toMatchObject({
      status: "unavailable",
      reason: "invalid-input",
    });
  });

  it("rejects malformed volatility", () => {
    expect(calculate({ volatility: { pool: POOL } })).toMatchObject({
      status: "unavailable",
      reason: "invalid-input",
    });
  });
});

describe("numeric limits", () => {
  const extremeVolatility = volatilityForAnnualized(100);

  it("reports an underflowed lower bound as calculation-error", () => {
    // log(1e-300) - 100 = -790.8, and exp of that is exactly 0.
    const tinyPrice = snapshot({ token0PriceInToken1: 1e-300, token1PriceInToken0: 1e300 });
    expect(Math.exp(Math.log(1e-300) - 100)).toBe(0);

    expect(
      calculate({ snapshot: tinyPrice, volatility: extremeVolatility, horizonDays: 365 }),
    ).toMatchObject({ status: "unavailable", reason: "calculation-error" });
  });

  it("reports an overflowed upper bound as calculation-error", () => {
    // log(1e300) + 100 = 790.8, beyond the largest representable exponent.
    const hugePrice = snapshot({ token0PriceInToken1: 1e300, token1PriceInToken0: 1e-300 });
    expect(Math.exp(Math.log(1e300) + 100)).toBe(Number.POSITIVE_INFINITY);

    expect(
      calculate({ snapshot: hugePrice, volatility: extremeVolatility, horizonDays: 365 }),
    ).toMatchObject({ status: "unavailable", reason: "calculation-error" });
  });

  it("clamps nothing when a bound cannot be represented", () => {
    const tinyPrice = snapshot({ token0PriceInToken1: 1e-300, token1PriceInToken0: 1e300 });
    const result = calculate({ snapshot: tinyPrice, volatility: extremeVolatility });

    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    // No Number.MIN_VALUE, no artificial floor — the result carries no data at all.
    expect(result).not.toHaveProperty("data");
  });
});

describe("traceability", () => {
  const result = calculate({});

  it("copies snapshot provenance exactly", () => {
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.data.pool).toEqual(POOL);
    expect(result.data.currentPrice).toBe(CURRENT_PRICE);
    expect(result.data.currentPriceFetchedAt).toBe("2026-08-20T09:15:00.000Z");
    expect(result.data.currentPriceSourceBlockNumber).toBe("21500000");
    expect(result.data.currentPriceSourceBlockTimestamp).toBe("2026-08-20T09:14:48.000Z");
  });

  it("copies volatility provenance exactly", () => {
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.data.volatilitySourceFetchedAt).toBe("2026-08-20T09:15:00.000Z");
    expect(result.data.volatilitySourceBlockNumber).toBe("21500000");
    expect(result.data.volatilitySourceBlockTimestamp).toBe("2026-08-20T09:14:48.000Z");
    expect(result.data.volatilityRangeStart).toBe(RANGE_START);
    expect(result.data.volatilityRangeEndExclusive).toBe(RANGE_END_EXCLUSIVE);
    expect(result.data.volatilityReturnCoverageRatio).toBe(1);
    expect(result.data.annualizedVolatility).toBeCloseTo(0.5, 12);
  });

  it("leaves null source metadata null", () => {
    const nulled = calculate({
      snapshot: snapshot({ sourceBlockNumber: null, sourceBlockTimestamp: null }),
      volatility: volatilityForAnnualized(0.5, {
        sourceBlockNumber: null,
        sourceBlockTimestamp: null,
      }),
    });

    expect(nulled.status).toBe("partial");
    if (nulled.status !== "partial") return;
    expect(nulled.data.currentPriceSourceBlockNumber).toBeNull();
    expect(nulled.data.currentPriceSourceBlockTimestamp).toBeNull();
    expect(nulled.data.volatilitySourceBlockNumber).toBeNull();
    expect(nulled.data.volatilitySourceBlockTimestamp).toBeNull();
  });

  it("carries no calculation clock and no tick fields", () => {
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    const keys = Object.keys(result.data);
    for (const forbidden of [
      "calculatedAt",
      "tick",
      "tickLower",
      "tickUpper",
      "tickSpacing",
      "confidenceLevel",
      "riskCategory",
      "feeTier",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("does not derive the price from the snapshot tick", () => {
    // The snapshot carries a tick; the band must ignore it entirely.
    const differentTick = snapshot({ tick: 99_999 });
    const withOtherTick = calculate({ snapshot: differentTick });

    expect(withOtherTick.status).toBe("success");
    if (withOtherTick.status !== "success" || result.status !== "success") return;
    expect(withOtherTick.data.currentPrice).toBe(result.data.currentPrice);
    expect(withOtherTick.data.lowerPrice).toBe(result.data.lowerPrice);
  });
});
