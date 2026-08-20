import { describe, expect, it } from "vitest";

import {
  ANNUALIZATION_DAYS,
  HistoricalVolatilitySchema,
  type PoolDailyPriceHistory,
  VOLATILITY_METHOD,
} from "../../schemas";
import { calculateHistoricalVolatility } from "./historicalVolatility";

const DAY_MS = 86_400_000;
const RANGE_START = "2026-07-20T00:00:00.000Z";
const RANGE_END_EXCLUSIVE = "2026-08-20T00:00:00.000Z";
const DAY_ZERO = Date.parse(RANGE_START);

const at = (dayIndex: number) => new Date(DAY_ZERO + dayIndex * DAY_MS).toISOString();
const point = (dayIndex: number, price: number) => ({ timestamp: at(dayIndex), price });

const POOL = { protocolVersion: "v3", chainId: 1, id: `0x${"d".repeat(40)}` };

const history = (points: unknown, overrides: Record<string, unknown> = {}) => ({
  pool: POOL,
  fetchedAt: "2026-08-20T09:15:00.000Z",
  sourceBlockNumber: "21500000",
  sourceBlockTimestamp: "2026-08-20T09:14:48.000Z",
  rangeStart: RANGE_START,
  rangeEndExclusive: RANGE_END_EXCLUSIVE,
  interval: "1d",
  priceDirection: "token0PriceInToken1",
  points,
  source: "uniswap-v3-subgraph",
  ...overrides,
});

/** The public function takes the domain type; tests deliberately feed it worse. */
const calculate = (value: unknown) =>
  calculateHistoricalVolatility(value as PoolDailyPriceHistory);

/** 31 points whose price never changes: every return is exactly zero. */
const constantPrices = Array.from({ length: 31 }, (_unused, index) => point(index, 100));

/** 31 points rising 1% per day: every log return is ln(1.01). */
const steadyGrowth = Array.from({ length: 31 }, (_unused, index) =>
  point(index, 100 * 1.01 ** index),
);

describe("a complete 31-day history", () => {
  it("produces 30 returns and succeeds", () => {
    const result = calculate(history(constantPrices));

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.data.observationCount).toBe(31);
    expect(result.data.expectedObservationCount).toBe(31);
    expect(result.data.expectedReturnCount).toBe(30);
    expect(result.data.usableReturnCount).toBe(30);
    expect(result.data.missingReturnCount).toBe(0);
    expect(result.data.returnCoverageRatio).toBe(1);
    expect(result.data.dailyLogReturns).toHaveLength(30);
  });

  it("gives zero volatility for constant prices", () => {
    const result = calculate(history(constantPrices));

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.data.dailyLogReturns.every((entry) => entry.logReturn === 0)).toBe(true);
    expect(result.data.meanDailyLogReturn).toBe(0);
    expect(result.data.dailyVolatility).toBe(0);
    expect(result.data.annualizedVolatility).toBe(0);
  });

  it("gives zero volatility but a non-zero mean for steady growth", () => {
    // A constant daily return has drift but no dispersion.
    const result = calculate(history(steadyGrowth));

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.data.meanDailyLogReturn).toBeCloseTo(Math.log(1.01), 12);
    expect(result.data.dailyVolatility).toBeCloseTo(0, 12);
  });

  it("copies source metadata from the input without inventing anything", () => {
    const input = history(constantPrices);
    const result = calculate(input);

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.data.pool).toEqual(POOL);
    expect(result.data.sourceFetchedAt).toBe("2026-08-20T09:15:00.000Z");
    expect(result.data.sourceBlockNumber).toBe("21500000");
    expect(result.data.sourceBlockTimestamp).toBe("2026-08-20T09:14:48.000Z");
    expect(result.data.rangeStart).toBe(RANGE_START);
    expect(result.data.rangeEndExclusive).toBe(RANGE_END_EXCLUSIVE);
    expect(result.data.priceDirection).toBe("token0PriceInToken1");
    expect(result.data.source).toBe("uniswap-v3-subgraph");
    expect(result.data.method).toBe(VOLATILITY_METHOD);
    expect(result.data.annualizationDays).toBe(365);
  });

  it("keeps missing block metadata null rather than substituting another time", () => {
    const input = history(constantPrices, {
      sourceBlockNumber: null,
      sourceBlockTimestamp: null,
    });
    const result = calculate(input);

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.data.sourceBlockNumber).toBeNull();
    expect(result.data.sourceBlockTimestamp).toBeNull();
    expect(result.data.sourceFetchedAt).toBe("2026-08-20T09:15:00.000Z");
  });

  it("carries no calculation clock", () => {
    const result = calculate(history(constantPrices));

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(Object.keys(result.data)).not.toContain("calculatedAt");
  });

  it("emits strictly ordered returns", () => {
    const result = calculate(history(constantPrices));

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    const instants = result.data.dailyLogReturns.map((entry) => Date.parse(entry.fromTimestamp));
    expect(instants).toEqual([...instants].sort((a, b) => a - b));
    expect(new Set(instants).size).toBe(30);
  });

  it("is deterministic for the same input", () => {
    expect(calculate(history(constantPrices))).toEqual(calculate(history(constantPrices)));
  });

  it("produces data the analytics schema accepts", () => {
    const result = calculate(history(constantPrices));

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(HistoricalVolatilitySchema.safeParse(result.data).success).toBe(true);
  });
});

describe("known volatility arithmetic", () => {
  /*
   * Prices e^0, e^0.1, e^0.3, e^0.6 give log returns 0.1, 0.2, 0.3.
   * Hand-derived: mean 0.2; deviations -0.1, 0, 0.1; sum of squares 0.02.
   *   sample sd (n-1)     = sqrt(0.02 / 2) = 0.1
   *   population sd (n)   = sqrt(0.02 / 3) = 0.0816496580927726
   *   annualized          = 0.1 * sqrt(365) = 1.91049731745428
   */
  const knownSeries = [
    point(0, 1),
    point(1, Math.exp(0.1)),
    point(2, Math.exp(0.3)),
    point(3, Math.exp(0.6)),
  ];

  const result = calculate(history(knownSeries));

  it("computes the sample standard deviation using n - 1", () => {
    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.data.dailyVolatility).toBeCloseTo(0.1, 12);
  });

  it("is not the population standard deviation", () => {
    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    // A divisor of n would give 0.0816..., which differs in the second decimal.
    expect(result.data.dailyVolatility).not.toBeCloseTo(0.0816496580927726, 3);
  });

  it("reports the mean of the log returns", () => {
    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.data.meanDailyLogReturn).toBeCloseTo(0.2, 12);
  });

  it("annualizes with sqrt(365)", () => {
    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.data.annualizedVolatility).toBeCloseTo(1.91049731745428, 10);
    // sqrt(252), the equities convention, would give 1.5874... instead.
    expect(result.data.annualizedVolatility).not.toBeCloseTo(0.1 * Math.sqrt(252), 3);
    expect(ANNUALIZATION_DAYS).toBe(365);
  });

  it("reports ratios, not percentages", () => {
    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    // 0.1 means 10%; a percentage-scaled implementation would report 10.
    expect(result.data.dailyVolatility).toBeLessThan(1);
    expect(result.data.dailyLogReturns.every((entry) => Math.abs(entry.logReturn) < 1)).toBe(true);
  });
});

describe("gaps in the window", () => {
  /** All 31 days except day 10. */
  const withOneMissingDay = constantPrices.filter((_unused, index) => index !== 10);

  it("does not create a return across the gap", () => {
    const result = calculate(history(withOneMissingDay));

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    const spans = result.data.dailyLogReturns.map(
      (entry) => Date.parse(entry.toTimestamp) - Date.parse(entry.fromTimestamp),
    );
    expect(new Set(spans)).toEqual(new Set([DAY_MS]));
    expect(
      result.data.dailyLogReturns.some((entry) => entry.fromTimestamp === at(9)),
    ).toBe(false);
  });

  it("loses exactly the two returns the missing day touched", () => {
    const result = calculate(history(withOneMissingDay));

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.data.observationCount).toBe(30);
    expect(result.data.expectedReturnCount).toBe(30);
    expect(result.data.usableReturnCount).toBe(28);
    expect(result.data.missingReturnCount).toBe(2);
    expect(result.data.returnCoverageRatio).toBeCloseTo(28 / 30, 15);
  });

  it("warns about incomplete coverage, deterministically", () => {
    const result = calculate(history(withOneMissingDay));

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("skipped rather than estimated");
    expect(calculate(history(withOneMissingDay))).toEqual(result);
  });

  it("never forward-fills, zero-fills or interpolates the gap", () => {
    const rising = Array.from({ length: 31 }, (_unused, index) => point(index, 100 + index));
    const gapped = rising.filter((_unused, index) => index !== 10);
    const result = calculate(history(gapped));

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    // A fabricated day 10 would restore the count to 30 and add a zero or an
    // interpolated return; neither appears.
    expect(result.data.usableReturnCount).toBe(28);
    expect(result.data.dailyLogReturns.some((entry) => entry.logReturn === 0)).toBe(false);
    expect(result.data.dailyLogReturns.map((entry) => entry.fromTimestamp)).not.toContain(at(10));
  });

  it("handles several separate segments", () => {
    const segments = [
      point(0, 100),
      point(1, 101),
      point(2, 102),
      point(10, 200),
      point(11, 202),
      point(20, 300),
      point(21, 303),
    ];
    const result = calculate(history(segments));

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.data.usableReturnCount).toBe(4);
    expect(result.data.observationCount).toBe(7);
    expect(result.data.missingReturnCount).toBe(26);
  });
});

describe("too little data", () => {
  it.each([
    ["no points", []],
    ["one point", [point(0, 100)]],
    ["two points one day apart, giving a single return", [point(0, 100), point(1, 110)]],
    ["two points separated by a gap", [point(0, 100), point(5, 110)]],
    ["three points that are all isolated", [point(0, 100), point(5, 110), point(10, 120)]],
  ])("reports %s as insufficient-data", (_label, points) => {
    expect(calculate(history(points))).toMatchObject({
      status: "unavailable",
      reason: "insufficient-data",
    });
  });

  it("calculates from exactly two usable returns, the sample-variance minimum", () => {
    const result = calculate(history([point(0, 100), point(1, 110), point(2, 99)]));

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.data.usableReturnCount).toBe(2);
    expect(Number.isFinite(result.data.dailyVolatility)).toBe(true);
    expect(result.data.dailyVolatility).toBeGreaterThan(0);
  });

  it("keeps the insufficient-data message free of pool detail", () => {
    const result = calculate(history([point(0, 100)]));

    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.message).not.toContain(POOL.id);
  });
});

describe("invalid input", () => {
  it.each([
    ["descending points", [point(2, 100), point(1, 110)]],
    ["duplicate timestamps", [point(1, 100), point(1, 110)]],
    ["a non-midnight timestamp", [point(0, 100), { timestamp: "2026-07-21T12:00:00.000Z", price: 110 }]],
    ["a zero price", [point(0, 0), point(1, 110)]],
    ["a negative price", [point(0, -100), point(1, 110)]],
    ["a point before rangeStart", [point(-1, 100), point(0, 110)]],
    ["a point at rangeEndExclusive", [point(30, 100), point(31, 110)]],
    ["a price that is not a number", [{ timestamp: at(0), price: "100" }, point(1, 110)]],
  ])("rejects %s as invalid-input", (_label, points) => {
    expect(calculate(history(points))).toMatchObject({
      status: "unavailable",
      reason: "invalid-input",
    });
  });

  it.each([
    ["a v4 pool", { pool: { protocolVersion: "v4", chainId: 1, id: `0x${"c".repeat(64)}` } }],
    ["another chain", { pool: { protocolVersion: "v3", chainId: 8453, id: `0x${"d".repeat(40)}` } }],
    ["a non-midnight rangeStart", { rangeStart: "2026-07-20T00:00:00.001Z" }],
    ["an hourly interval", { interval: "1h" }],
    ["the opposite price direction", { priceDirection: "token1PriceInToken0" }],
    ["a foreign source", { source: "derived-analytics" }],
    ["an unexpected field", { volatility: 0.4 }],
  ])("rejects %s as invalid-input", (_label, overrides) => {
    expect(calculate(history(constantPrices, overrides))).toMatchObject({
      status: "unavailable",
      reason: "invalid-input",
    });
  });

  it.each([
    ["null", null],
    ["a number", 42],
    ["an empty object", {}],
    ["a plain array", []],
  ])("rejects %s as invalid-input", (_label, value) => {
    expect(calculate(value)).toMatchObject({ status: "unavailable", reason: "invalid-input" });
  });
});

describe("extreme but finite prices", () => {
  it("stays finite because returns use log differences", () => {
    const extreme = [point(0, 1e-300), point(1, 1e300), point(2, 1e-300)];
    const result = calculate(history(extreme));

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(Number.isFinite(result.data.dailyVolatility)).toBe(true);
    expect(Number.isFinite(result.data.annualizedVolatility)).toBe(true);
    expect(Number.isFinite(result.data.meanDailyLogReturn)).toBe(true);
    expect(result.data.dailyLogReturns[0]?.logReturn).toBeCloseTo(1381.5510557964274, 9);
    expect(result.data.dailyLogReturns[1]?.logReturn).toBeCloseTo(-1381.5510557964274, 9);
  });
});

describe("count and coverage bookkeeping", () => {
  it("derives expected counts from the declared range, not a constant", () => {
    // A 5-day window, not the adapter's 31.
    const shortWindow = history([point(0, 100), point(1, 110), point(2, 105)], {
      rangeEndExclusive: at(5),
    });
    const result = calculate(shortWindow);

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.data.expectedObservationCount).toBe(5);
    expect(result.data.expectedReturnCount).toBe(4);
    expect(result.data.usableReturnCount).toBe(2);
    expect(result.data.missingReturnCount).toBe(2);
    expect(result.data.returnCoverageRatio).toBe(0.5);
  });

  it("keeps every count relationship exact", () => {
    for (const points of [constantPrices, constantPrices.filter((_u, i) => i !== 10)]) {
      const result = calculate(history(points));
      if (result.status === "unavailable") throw new Error("expected a result");

      const data = result.data;
      expect(data.expectedReturnCount).toBe(Math.max(data.expectedObservationCount - 1, 0));
      expect(data.missingReturnCount).toBe(data.expectedReturnCount - data.usableReturnCount);
      expect(data.dailyLogReturns).toHaveLength(data.usableReturnCount);
      expect(data.returnCoverageRatio).toBeCloseTo(
        data.usableReturnCount / data.expectedReturnCount,
        15,
      );
      expect(data.returnCoverageRatio).toBeGreaterThanOrEqual(0);
      expect(data.returnCoverageRatio).toBeLessThanOrEqual(1);
    }
  });
});

describe("source block number provenance", () => {
  it.each([
    ["zero", "0"],
    ["a canonical block number", "21500000"],
    ["a very large canonical unsigned integer", "99999999999999999999999999999999"],
    ["null", null],
  ])("accepts %s", (_label, sourceBlockNumber) => {
    const result = calculate(history(constantPrices, { sourceBlockNumber }));

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.data.sourceBlockNumber).toBe(sourceBlockNumber);
  });

  it.each([
    ["a negative value", "-1"],
    ["a leading zero", "01"],
    ["a fractional value", "1.5"],
    ["non-numeric text", "not-a-block"],
    ["a JavaScript number", 21_500_000],
    ["an empty string", ""],
  ])("rejects %s as invalid-input", (_label, sourceBlockNumber) => {
    expect(calculate(history(constantPrices, { sourceBlockNumber }))).toMatchObject({
      status: "unavailable",
      reason: "invalid-input",
    });
  });
});
