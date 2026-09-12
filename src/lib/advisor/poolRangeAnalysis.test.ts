import { describe, expect, it } from "vitest";

import type {
  DataResult,
  PoolDailyPriceHistory,
  PoolMarketSnapshot,
  V3Pool,
} from "../../schemas";
import {
  analysePoolRange,
  DEFAULT_PRICE_BAND_PARAMETERS,
  type PoolRangeAnalysisInput,
} from "./poolRangeAnalysis";

const POOL_ID = `0x${"c".repeat(40)}`;
const POOL_REF = { protocolVersion: "v3", chainId: 1, id: POOL_ID } as const;

const FETCHED_AT = "2026-08-21T09:15:00.000Z";
const BLOCK_NUMBER = "21500000";
const BLOCK_TIMESTAMP = "2026-08-21T09:14:48.000Z";

/** USDC (6 decimals) sorts before WETH (18), as it does on mainnet. */
const CURRENT_PRICE = 1 / 3000;
const CURRENT_TICK = 196_256;

const pool = (token0Decimals = 6, token1Decimals = 18): V3Pool =>
  ({
    ...POOL_REF,
    token0: { chainId: 1, address: `0x${"a".repeat(40)}`, symbol: "USDC", decimals: token0Decimals },
    token1: { chainId: 1, address: `0x${"b".repeat(40)}`, symbol: "WETH", decimals: token1Decimals },
    feePpm: 3000,
    tickSpacing: 60,
  }) as unknown as V3Pool;

const snapshot = (overrides: Record<string, unknown> = {}): PoolMarketSnapshot =>
  ({
    pool: POOL_REF,
    fetchedAt: FETCHED_AT,
    sourceBlockNumber: BLOCK_NUMBER,
    sourceBlockTimestamp: BLOCK_TIMESTAMP,
    token0PriceInToken1: CURRENT_PRICE,
    token1PriceInToken0: 1 / CURRENT_PRICE,
    tvlUsd: 12_500_000,
    volume24hUsd: null,
    volume7dUsd: null,
    volume30dUsd: null,
    tick: CURRENT_TICK,
    liquidity: "987654321",
    source: "uniswap-v3-subgraph",
    ...overrides,
  }) as unknown as PoolMarketSnapshot;

const DAY_MS = 86_400_000;
const RANGE_START = Date.parse("2026-07-21T00:00:00.000Z");

/**
 * 31 completed daily closes alternating ±1% in log terms, which gives a sample
 * standard deviation near 0.00995 per day and an annualised figure near 19% —
 * an ordinary number for a major pair, so the band it produces is realistic.
 *
 * `skipDays` drops calendar days from the series to model an indexer gap.
 */
const history = (
  pointCount = 31,
  skipDays: readonly number[] = [],
): PoolDailyPriceHistory => {
  const points: { timestamp: string; price: number }[] = [];
  let price = CURRENT_PRICE;

  for (let day = 0; day < pointCount; day += 1) {
    if (day > 0) price *= day % 2 === 0 ? 1.01 : 1 / 1.01;
    if (skipDays.includes(day)) continue;
    points.push({
      timestamp: new Date(RANGE_START + day * DAY_MS).toISOString(),
      price,
    });
  }

  return {
    pool: POOL_REF,
    fetchedAt: FETCHED_AT,
    sourceBlockNumber: BLOCK_NUMBER,
    sourceBlockTimestamp: BLOCK_TIMESTAMP,
    rangeStart: "2026-07-21T00:00:00.000Z",
    rangeEndExclusive: new Date(RANGE_START + pointCount * DAY_MS).toISOString(),
    interval: "1d",
    priceDirection: "token0PriceInToken1",
    points,
    source: "uniswap-v3-subgraph",
  } as unknown as PoolDailyPriceHistory;
};

const ok = <T,>(data: T): DataResult<T> => ({ status: "success", data });

const input = (overrides: Partial<PoolRangeAnalysisInput> = {}): PoolRangeAnalysisInput => ({
  pool: ok(pool()),
  snapshot: ok(snapshot()),
  history: ok(history()),
  parameters: DEFAULT_PRICE_BAND_PARAMETERS,
  ...overrides,
});

const succeed = (overrides: Partial<PoolRangeAnalysisInput> = {}) => {
  const result = analysePoolRange(input(overrides));
  if (result.status === "unavailable") {
    throw new Error(`expected data, got ${result.step}/${result.reason}: ${result.message}`);
  }
  return result;
};

describe("analysePoolRange", () => {
  it("runs a whole pool through to a deployable tick range", () => {
    const { data } = succeed();

    expect(data.range.lowerTick).toBeLessThan(data.range.upperTick);
    expect(data.range.lowerTick % data.pool.tickSpacing).toBe(0);
    expect(data.range.upperTick % data.pool.tickSpacing).toBe(0);
    expect(data.range.containsCurrentPrice).toBe(true);
  });

  it("wires each stage's output into the next", () => {
    const { data } = succeed();

    // A mis-wired pipeline would still produce plausible numbers, so the links
    // themselves are asserted rather than only the final figures.
    expect(data.band.currentPrice).toBe(data.snapshot.token0PriceInToken1);
    expect(data.band.annualizedVolatility).toBe(data.volatility.annualizedVolatility);
    expect(data.range.band).toEqual(data.band);
    expect(data.range.pool).toEqual(data.pool);
    expect(data.volatility.pool).toEqual(data.history.pool);
  });

  it("measures a realistic annualised volatility from the series", () => {
    const { data } = succeed();

    // Alternating ±1% daily log moves: sd ~0.00995/day, ~19% annualised.
    expect(data.volatility.annualizedVolatility).toBeGreaterThan(0.15);
    expect(data.volatility.annualizedVolatility).toBeLessThan(0.25);
  });

  it("passes the caller's band parameters through rather than its own", () => {
    const wide = succeed({ parameters: { horizonDays: 365, standardDeviationMultiplier: 2 } });
    const narrow = succeed();

    expect(wide.data.band.horizonDays).toBe(365);
    expect(wide.data.band.standardDeviationMultiplier).toBe(2);
    expect(wide.data.parameters).toEqual({ horizonDays: 365, standardDeviationMultiplier: 2 });

    // A longer horizon and a larger multiplier must widen the range, not just
    // relabel it.
    expect(wide.data.range.upperTick - wide.data.range.lowerTick).toBeGreaterThan(
      narrow.data.range.upperTick - narrow.data.range.lowerTick,
    );
  });

  it("is deterministic", () => {
    expect(analysePoolRange(input())).toEqual(analysePoolRange(input()));
  });

  it("keeps every stage's own provenance", () => {
    const { data } = succeed();

    expect(data.band.currentPriceSourceBlockNumber).toBe(BLOCK_NUMBER);
    expect(data.band.currentPriceSourceBlockTimestamp).toBe(BLOCK_TIMESTAMP);
    expect(data.range.chainReportedTick).toBe(CURRENT_TICK);
    expect(data.snapshot.fetchedAt).toBe(FETCHED_AT);
  });
});

describe("a stage that cannot produce a figure", () => {
  const unreachable = <T,>(): DataResult<T> => ({
    status: "unavailable",
    reason: "network-error",
    message: "The market data service could not be reached.",
  });

  it.each([
    ["pool", { pool: unreachable<V3Pool>() }],
    ["snapshot", { snapshot: unreachable<PoolMarketSnapshot>() }],
    ["history", { history: unreachable<PoolDailyPriceHistory>() }],
  ])("names %s as the step that stopped it", (step, overrides) => {
    const result = analysePoolRange(input(overrides));

    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.step).toBe(step);
    expect(result.reason).toBe("network-error");
    expect(result.message).toBe("The market data service could not be reached.");
  });

  it("stops at the volatility step when the history is too short", () => {
    const result = analysePoolRange(input({ history: ok(history(2)) }));

    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.step).toBe("volatility");
    expect(result.reason).toBe("insufficient-data");
  });

  it("stops at the band step when the pool has no current price", () => {
    const result = analysePoolRange(
      input({
        snapshot: ok(snapshot({ token0PriceInToken1: null, token1PriceInToken0: null })),
      }),
    );

    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.step).toBe("band");
    expect(result.reason).toBe("insufficient-data");
  });

  it("stops at the range step when the pool's decimals contradict its reported tick", () => {
    const result = analysePoolRange(input({ pool: ok(pool(18, 6)) }));

    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.step).toBe("range");
    expect(result.reason).toBe("invalid-input");
  });

  it("carries no data when it stops", () => {
    const result = analysePoolRange(input({ pool: unreachable<V3Pool>() }));

    expect(result).not.toHaveProperty("data");
  });

  it.each([
    ["the history", { history: unreachable<PoolDailyPriceHistory>() }],
    ["the snapshot", { snapshot: unreachable<PoolMarketSnapshot>() }],
  ])("names the pool rather than %s when both are unusable", (_label, alsoFailing) => {
    /*
     * Order is part of the contract, not an accident of how the code reads. The
     * pool's configuration is what gives every later figure its meaning, so when
     * more than one read failed it is the one worth reporting.
     */
    const result = analysePoolRange(input({ pool: unreachable<V3Pool>(), ...alsoFailing }));

    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.step).toBe("pool");
  });
});

describe("caveats", () => {
  it("uses a partial fetch rather than refusing it", () => {
    // A snapshot missing rolling volume still carries the price and tick this
    // pipeline needs.
    const result = analysePoolRange(
      input({
        snapshot: {
          status: "partial",
          data: snapshot(),
          missingFields: ["volume24hUsd", "volume7dUsd", "volume30dUsd"],
          warnings: ["Rolling volume is not available from this source."],
        },
      }),
    );

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.data.range.lowerTick).toBeLessThan(result.data.range.upperTick);
    expect(result.warnings).toContain("Rolling volume is not available from this source.");
  });

  it("gathers caveats from every stage in pipeline order", () => {
    const result = analysePoolRange(
      input({
        snapshot: {
          status: "partial",
          data: snapshot(),
          missingFields: ["volume24hUsd"],
          warnings: ["A fetch caveat."],
        },
        // Two missing days leave the volatility window incomplete.
        history: ok(history(31, [7, 8])),
      }),
    );

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.data.volatility.returnCoverageRatio).toBeLessThan(1);

    /*
     * Pinned exactly, because each stage speaks for its own output and two of
     * them have something to say about the same gap: the volatility figure was
     * measured from fewer returns, and the band was built on that figure. The
     * wording differs, and so does what each one is about.
     */
    expect(result.warnings).toHaveLength(3);
    expect(result.warnings[0]).toBe("A fetch caveat.");
    expect(result.warnings[1]).toContain("volatility is measured from fewer daily returns");
    expect(result.warnings[2]).toContain("this band is based on fewer daily returns");
  });

  it("reports a clean run with no caveats as a success", () => {
    const result = analysePoolRange(input());

    expect(result.status).toBe("success");
    expect(result).not.toHaveProperty("warnings");
  });

  it("warns when an edge runs past what the pool can express", () => {
    // A 365-day horizon at a 40-sigma multiplier reaches far beyond TickMath.
    const result = analysePoolRange(
      input({ parameters: { horizonDays: 365, standardDeviationMultiplier: 400 } }),
    );

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.warnings.some((warning) => warning.includes("stops at the"))).toBe(true);
  });
});

describe("DEFAULT_PRICE_BAND_PARAMETERS", () => {
  it("is a plain one-sigma band over the history window the reader fetches", () => {
    expect(DEFAULT_PRICE_BAND_PARAMETERS).toEqual({
      horizonDays: 30,
      standardDeviationMultiplier: 1,
    });
  });
});
