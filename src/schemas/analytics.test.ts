import { describe, expect, it } from "vitest";

import {
  ANNUALIZATION_DAYS,
  AnalyticsFailureReasonSchema,
  DailyLogReturnSchema,
  HistoricalVolatilitySchema,
  VOLATILITY_METHOD,
} from "./index";

const DAY_MS = 86_400_000;
const RANGE_START = "2026-07-20T00:00:00.000Z";
const DAY_ZERO = Date.parse(RANGE_START);
const at = (dayIndex: number) => new Date(DAY_ZERO + dayIndex * DAY_MS).toISOString();

// `logReturn` is `unknown` so the rejection cases can pass non-numeric values
// without a cast; every consumer here feeds the result to `safeParse`.
const dailyReturn = (dayIndex: number, logReturn: unknown = 0.01) => ({
  fromTimestamp: at(dayIndex),
  toTimestamp: at(dayIndex + 1),
  logReturn,
});

describe("DailyLogReturnSchema", () => {
  it("accepts a one-day span", () => {
    expect(DailyLogReturnSchema.safeParse(dailyReturn(0)).success).toBe(true);
  });

  it.each([
    ["a negative return", -0.25],
    ["a zero return", 0],
    ["a large finite return", 1381.55],
  ])("accepts %s", (_label, logReturn) => {
    expect(DailyLogReturnSchema.safeParse(dailyReturn(0, logReturn)).success).toBe(true);
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["a numeric string", "0.01"],
  ])("rejects %s", (_label, logReturn) => {
    expect(DailyLogReturnSchema.safeParse(dailyReturn(0, logReturn)).success).toBe(false);
  });

  it.each([
    ["a two-day span", { fromTimestamp: at(0), toTimestamp: at(2), logReturn: 0.01 }],
    ["a reversed span", { fromTimestamp: at(2), toTimestamp: at(1), logReturn: 0.01 }],
    ["a zero-length span", { fromTimestamp: at(1), toTimestamp: at(1), logReturn: 0.01 }],
    [
      "a span one millisecond short",
      {
        fromTimestamp: at(0),
        toTimestamp: new Date(DAY_ZERO + DAY_MS - 1).toISOString(),
        logReturn: 0.01,
      },
    ],
  ])("rejects %s", (_label, value) => {
    expect(DailyLogReturnSchema.safeParse(value).success).toBe(false);
  });

  it("rejects an unexpected field", () => {
    expect(DailyLogReturnSchema.safeParse({ ...dailyReturn(0), pct: 1 }).success).toBe(false);
  });
});

describe("HistoricalVolatilitySchema", () => {
  const RANGE_END_EXCLUSIVE = "2026-08-20T00:00:00.000Z"; // 31 days after RANGE_START
  const SQRT_365 = Math.sqrt(365);

  const returnAt = (dayIndex: number, logReturn: number) => ({
    fromTimestamp: at(dayIndex),
    toTimestamp: at(dayIndex + 1),
    logReturn,
  });

  /*
   * Hand-derived, not produced by the code under test:
   *   returns    0.1, 0.2, 0.3
   *   mean       0.2
   *   deviations -0.1, 0, 0.1  ->  sum of squares 0.02
   *   sample sd  sqrt(0.02 / 2) = 0.1        (divisor n - 1)
   *   population sqrt(0.02 / 3) = 0.0816496580927726
   */
  const KNOWN_RETURNS = [returnAt(0, 0.1), returnAt(1, 0.2), returnAt(2, 0.3)];
  const KNOWN_MEAN = 0.2;
  const KNOWN_SAMPLE_SD = 0.1;
  const KNOWN_POPULATION_SD = 0.0816496580927726;

  /** 30 identical returns: mean 0.01, and no dispersion at all. */
  const CONSTANT_RETURNS = Array.from({ length: 30 }, (_unused, index) => returnAt(index, 0.01));

  const analytics = (overrides: Record<string, unknown> = {}) => ({
    pool: { protocolVersion: "v3", chainId: 1, id: `0x${"d".repeat(40)}` },
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
    expectedReturnCount: 30,
    observationCount: KNOWN_RETURNS.length + 1,
    usableReturnCount: KNOWN_RETURNS.length,
    missingReturnCount: 30 - KNOWN_RETURNS.length,
    returnCoverageRatio: KNOWN_RETURNS.length / 30,
    dailyLogReturns: KNOWN_RETURNS,
    meanDailyLogReturn: KNOWN_MEAN,
    dailyVolatility: KNOWN_SAMPLE_SD,
    annualizedVolatility: KNOWN_SAMPLE_SD * SQRT_365,
    ...overrides,
  });

  /** Swaps in a different return series and keeps every derived count coherent. */
  const withReturns = (
    returns: readonly { fromTimestamp: string; toTimestamp: string; logReturn: number }[],
    stats: { mean: number; sd: number },
    overrides: Record<string, unknown> = {},
  ) =>
    analytics({
      dailyLogReturns: returns,
      usableReturnCount: returns.length,
      missingReturnCount: 30 - returns.length,
      returnCoverageRatio: returns.length / 30,
      observationCount: returns.length + 1,
      meanDailyLogReturn: stats.mean,
      dailyVolatility: stats.sd,
      annualizedVolatility: stats.sd * SQRT_365,
      ...overrides,
    });

  const parse = (value: unknown) => HistoricalVolatilitySchema.safeParse(value);

  describe("accepts coherent results", () => {
    it("accepts the hand-derived 0.1/0.2/0.3 sample", () => {
      expect(parse(analytics()).success).toBe(true);
    });

    it("accepts constant returns reporting zero volatility", () => {
      const flat = withReturns(CONSTANT_RETURNS, { mean: 0.01, sd: 0 }, {
        observationCount: 31,
        usableReturnCount: 30,
        missingReturnCount: 0,
        returnCoverageRatio: 1,
      });
      expect(parse(flat).success).toBe(true);
    });

    it("accepts exactly two returns with the correct sample standard deviation", () => {
      // Returns 0.1 and 0.3: mean 0.2, sum of squares 0.02, sample variance 0.02,
      // sd = sqrt(0.02) = 0.1414213562373095.
      const twoReturns = [returnAt(0, 0.1), returnAt(1, 0.3)];
      expect(parse(withReturns(twoReturns, { mean: 0.2, sd: 0.1414213562373095 })).success).toBe(
        true,
      );
    });

    it("reports 31 observations and 30 returns for an aligned 31-day range", () => {
      const result = parse(analytics());

      expect(result.success).toBe(true);
      expect(result.data?.expectedObservationCount).toBe(31);
      expect(result.data?.expectedReturnCount).toBe(30);
    });
  });

  describe("recomputes the statistics independently", () => {
    it("rejects a wrong mean beside otherwise valid returns", () => {
      const result = parse(analytics({ meanDailyLogReturn: 0.5 }));

      expect(result.success).toBe(false);
      expect(result.error?.issues.some((issue) => issue.path[0] === "meanDailyLogReturn")).toBe(
        true,
      );
    });

    it("rejects a wrong daily volatility", () => {
      const result = parse(
        analytics({ dailyVolatility: 0.42, annualizedVolatility: 0.42 * SQRT_365 }),
      );

      expect(result.success).toBe(false);
      expect(result.error?.issues.some((issue) => issue.path[0] === "dailyVolatility")).toBe(true);
    });

    it("rejects the population standard deviation used in place of the sample one", () => {
      const populationVariant = analytics({
        dailyVolatility: KNOWN_POPULATION_SD,
        annualizedVolatility: KNOWN_POPULATION_SD * SQRT_365,
      });

      expect(parse(populationVariant).success).toBe(false);
    });

    it("rejects nonzero volatility for constant returns", () => {
      const flatButVolatile = withReturns(CONSTANT_RETURNS, { mean: 0.01, sd: 0.05 }, {
        observationCount: 31,
        usableReturnCount: 30,
        missingReturnCount: 0,
        returnCoverageRatio: 1,
      });
      expect(parse(flatButVolatile).success).toBe(false);
    });

    it("rejects a daily and annualized pair that agree with each other but not the series", () => {
      // Internally consistent under sqrt(365), yet describing a series that is not
      // the one supplied. Only recomputation catches this.
      const consistentButWrong = analytics({
        dailyVolatility: 0.5,
        annualizedVolatility: 0.5 * SQRT_365,
      });

      expect(parse(consistentButWrong).success).toBe(false);
    });

    it.each([
      ["zero daily returns", []],
      ["a single daily return", [returnAt(0, 0.1)]],
    ])("rejects %s", (_label, returns) => {
      const tooFew = analytics({
        dailyLogReturns: returns,
        usableReturnCount: returns.length,
        missingReturnCount: 30 - returns.length,
        returnCoverageRatio: returns.length / 30,
        observationCount: returns.length + 1,
        meanDailyLogReturn: 0.1,
        dailyVolatility: 0,
        annualizedVolatility: 0,
      });

      expect(parse(tooFew).success).toBe(false);
    });
  });

  describe("correlates provenance with the returns", () => {
    it("rejects a non-midnight rangeStart", () => {
      const result = parse(analytics({ rangeStart: "2026-07-20T00:00:00.001Z" }));

      expect(result.success).toBe(false);
      expect(result.error?.issues.some((issue) => issue.path[0] === "rangeStart")).toBe(true);
    });

    it("rejects a non-midnight rangeEndExclusive", () => {
      const result = parse(
        analytics({ rangeEndExclusive: "2026-08-20T09:15:00.000Z", expectedObservationCount: 31 }),
      );

      expect(result.success).toBe(false);
      expect(result.error?.issues.some((issue) => issue.path[0] === "rangeEndExclusive")).toBe(
        true,
      );
    });

    it("rejects return timestamps that are not UTC-day aligned", () => {
      const noon = [
        { fromTimestamp: at(0), toTimestamp: at(1), logReturn: 0.1 },
        {
          fromTimestamp: new Date(DAY_ZERO + DAY_MS + 12 * 60 * 60 * 1000).toISOString(),
          toTimestamp: new Date(DAY_ZERO + 2 * DAY_MS + 12 * 60 * 60 * 1000).toISOString(),
          logReturn: 0.3,
        },
      ];

      expect(parse(withReturns(noon, { mean: 0.2, sd: 0.1414213562373095 })).success).toBe(false);
    });

    it("rejects a return entirely before the declared range", () => {
      const before = [returnAt(-5, 0.1), returnAt(-4, 0.3)];
      expect(parse(withReturns(before, { mean: 0.2, sd: 0.1414213562373095 })).success).toBe(false);
    });

    it("rejects a return entirely after the declared range", () => {
      const after = [returnAt(40, 0.1), returnAt(41, 0.3)];
      expect(parse(withReturns(after, { mean: 0.2, sd: 0.1414213562373095 })).success).toBe(false);
    });

    it("rejects a return crossing the exclusive range end", () => {
      // from day 30 to day 31, where day 31 is rangeEndExclusive itself.
      const crossing = [returnAt(29, 0.1), returnAt(30, 0.3)];
      expect(parse(withReturns(crossing, { mean: 0.2, sd: 0.1414213562373095 })).success).toBe(
        false,
      );
    });

    it("rejects returns copied from an unrelated date window", () => {
      const unrelated = [returnAt(200, 0.1), returnAt(201, 0.2), returnAt(202, 0.3)];
      expect(parse(withReturns(unrelated, { mean: KNOWN_MEAN, sd: KNOWN_SAMPLE_SD })).success).toBe(
        false,
      );
    });

    it("rejects counts that do not match the range duration", () => {
      // The range spans 5 days, but the counts claim a 31-day window.
      const mismatched = analytics({ rangeEndExclusive: at(5) });
      const result = parse(mismatched);

      expect(result.success).toBe(false);
      expect(
        result.error?.issues.some((issue) => issue.path[0] === "expectedObservationCount"),
      ).toBe(true);
    });

    it("rejects an observation count smaller than the return sequence requires", () => {
      // Three returns need at least four prices behind them.
      const result = parse(analytics({ observationCount: 3 }));

      expect(result.success).toBe(false);
      expect(result.error?.issues.some((issue) => issue.path[0] === "observationCount")).toBe(true);
    });

    it("rejects a range whose end is not after its start", () => {
      const inverted = analytics({
        rangeStart: RANGE_END_EXCLUSIVE,
        rangeEndExclusive: RANGE_START,
      });
      expect(parse(inverted).success).toBe(false);
    });
  });

  describe("bookkeeping refinements", () => {
    it.each([
      [
        "a return array whose length disagrees with usableReturnCount",
        { usableReturnCount: 2, missingReturnCount: 28, returnCoverageRatio: 2 / 30 },
      ],
      ["a missing count that does not close the books", { missingReturnCount: 5 }],
      ["an expectedReturnCount that is not one fewer than observations", { expectedReturnCount: 31 }],
      ["observations exceeding the window", { observationCount: 32 }],
      ["a coverage ratio that contradicts the counts", { returnCoverageRatio: 0.5 }],
      ["coverage above one", { returnCoverageRatio: 1.5 }],
      ["coverage below zero", { returnCoverageRatio: -0.1 }],
      ["usable exceeding expected", { usableReturnCount: 31, missingReturnCount: -1 }],
    ])("rejects %s", (_label, overrides) => {
      expect(parse(analytics(overrides)).success).toBe(false);
    });

    it("rejects an annualization that does not use sqrt(365)", () => {
      expect(parse(analytics({ annualizedVolatility: KNOWN_SAMPLE_SD * Math.sqrt(252) })).success).toBe(
        false,
      );
    });

    it("tolerates last-bit drift in the annualization identity", () => {
      const drifted = analytics({
        annualizedVolatility: KNOWN_SAMPLE_SD * SQRT_365 * (1 + 1e-12),
      });
      expect(parse(drifted).success).toBe(true);
    });

    it("rejects unordered returns", () => {
      const unordered = [returnAt(5, 0.1), returnAt(1, 0.3)];
      expect(parse(withReturns(unordered, { mean: 0.2, sd: 0.1414213562373095 })).success).toBe(
        false,
      );
    });

    it.each([
      ["a negative daily volatility", { dailyVolatility: -0.1 }],
      ["a NaN volatility", { dailyVolatility: Number.NaN }],
      ["an infinite volatility", { dailyVolatility: Number.POSITIVE_INFINITY }],
      ["a NaN mean", { meanDailyLogReturn: Number.NaN }],
      ["a fractional count", { observationCount: 30.5 }],
      ["a negative count", { observationCount: -1 }],
    ])("rejects %s", (_label, overrides) => {
      expect(parse(analytics(overrides)).success).toBe(false);
    });

    it.each([
      ["a wrong method label", { method: "parkinson-range-volatility" }],
      ["a 252-day annualization basis", { annualizationDays: 252 }],
      ["a v4 pool", { pool: { protocolVersion: "v4", chainId: 1, id: `0x${"c".repeat(64)}` } }],
      ["another chain", { pool: { protocolVersion: "v3", chainId: 8453, id: `0x${"d".repeat(40)}` } }],
      ["a calculation clock", { calculatedAt: "2026-08-20T09:15:00.000Z" }],
      ["a formatted percentage", { dailyVolatilityPercent: "10%" }],
      ["a risk label", { riskCategory: "high" }],
    ])("rejects %s", (_label, overrides) => {
      expect(parse(analytics(overrides)).success).toBe(false);
    });
  });

  describe("sourceBlockNumber provenance", () => {
    it.each([
      ["zero", "0"],
      ["a canonical block number", "21500000"],
      ["a very large canonical unsigned integer", "99999999999999999999999999999999"],
      ["null", null],
    ])("accepts %s", (_label, sourceBlockNumber) => {
      expect(parse(analytics({ sourceBlockNumber })).success).toBe(true);
    });

    it.each([
      ["a negative value", "-1"],
      ["a leading zero", "01"],
      ["a fractional value", "1.5"],
      ["non-numeric text", "not-a-block"],
      ["a JavaScript number", 21_500_000],
      ["an empty string", ""],
      ["hexadecimal notation", "0x14"],
    ])("rejects %s", (_label, sourceBlockNumber) => {
      expect(parse(analytics({ sourceBlockNumber })).success).toBe(false);
    });
  });
});

describe("AnalyticsFailureReasonSchema", () => {
  it.each([["invalid-input"], ["insufficient-data"], ["calculation-error"]])(
    "accepts %s",
    (reason) => {
      expect(AnalyticsFailureReasonSchema.safeParse(reason).success).toBe(true);
    },
  );

  it.each([["not-found"], ["network-error"], ["stale-data"], [""]])(
    "rejects the fetch-oriented reason %s",
    (reason) => {
      // Fetch failures are DataResult's concern; a pure calculation cannot have one.
      expect(AnalyticsFailureReasonSchema.safeParse(reason).success).toBe(false);
    },
  );
});
