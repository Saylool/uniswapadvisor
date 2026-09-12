import { describe, expect, it } from "vitest";

import {
  ANNUALIZATION_DAYS,
  MAX_TICK_DISAGREEMENT,
  PRICE_BAND_METHOD,
  V3_TICK_RANGE_METHOD,
  V3TickRangeSchema,
} from "../../schemas";
import { priceAtTick } from "../uniswap/v3TickMath";
import { calculateV3TickRange, type V3TickRangeInput } from "./v3TickRange";

/*
 * Fixtures are shaped after two pools whose live ticks are publicly checkable, so
 * the assertions below say something about Uniswap rather than only about this
 * module's internal consistency:
 *
 *   USDC (6 decimals) / WETH (18), 0.30% tier, tick spacing 60, price ~1/3000
 *   DAI  (18)         / USDC (6),  0.01% tier, tick spacing 1,  price ~1
 */

const POOL_ID = `0x${"c".repeat(40)}`;
const POOL_REF = { protocolVersion: "v3", chainId: 1, id: POOL_ID } as const;

const FETCHED_AT = "2026-08-20T09:15:00.000Z";
const BLOCK_NUMBER = "21500000";
const BLOCK_TIMESTAMP = "2026-08-20T09:14:48.000Z";

const CURRENT_PRICE = 1 / 3000;
const CURRENT_TICK = 196_256;

const poolWith = (token0Decimals: number, token1Decimals: number, tickSpacing: number) => ({
  ...POOL_REF,
  token0: {
    chainId: 1,
    address: `0x${"a".repeat(40)}`,
    symbol: "USDC",
    decimals: token0Decimals,
  },
  token1: {
    chainId: 1,
    address: `0x${"b".repeat(40)}`,
    symbol: "WETH",
    decimals: token1Decimals,
  },
  feePpm: 3000,
  tickSpacing,
});

const USDC_WETH_POOL = poolWith(6, 18, 60);

const snapshotWith = (price: number, tick: number | null) => ({
  pool: POOL_REF,
  fetchedAt: FETCHED_AT,
  sourceBlockNumber: BLOCK_NUMBER,
  sourceBlockTimestamp: BLOCK_TIMESTAMP,
  token0PriceInToken1: price,
  token1PriceInToken0: 1 / price,
  tvlUsd: 1_000_000,
  volume24hUsd: null,
  volume7dUsd: null,
  volume30dUsd: null,
  tick,
  liquidity: "123456789",
  source: "uniswap-v3-subgraph",
});

/**
 * A band built by the same arithmetic the band schema verifies, so the fixture is
 * a genuinely valid band rather than one that merely looks plausible. A 365-day
 * horizon with a multiplier of 1 makes `logPriceDistance` equal the annualised
 * volatility, which keeps the expected ticks hand-checkable.
 */
const bandWith = (currentPrice: number, annualizedVolatility: number) => {
  const horizonVolatility = annualizedVolatility * Math.sqrt(365 / ANNUALIZATION_DAYS);
  const logPriceDistance = horizonVolatility;
  const lowerPrice =
    logPriceDistance === 0 ? currentPrice : Math.exp(Math.log(currentPrice) - logPriceDistance);
  const upperPrice =
    logPriceDistance === 0 ? currentPrice : Math.exp(Math.log(currentPrice) + logPriceDistance);

  return {
    pool: POOL_REF,
    priceDirection: "token0PriceInToken1",
    method: PRICE_BAND_METHOD,
    annualizationDays: ANNUALIZATION_DAYS,
    horizonDays: 365,
    standardDeviationMultiplier: 1,

    currentPrice,
    currentPriceFetchedAt: FETCHED_AT,
    currentPriceSourceBlockNumber: BLOCK_NUMBER,
    currentPriceSourceBlockTimestamp: BLOCK_TIMESTAMP,

    volatilitySourceFetchedAt: FETCHED_AT,
    volatilitySourceBlockNumber: BLOCK_NUMBER,
    volatilitySourceBlockTimestamp: BLOCK_TIMESTAMP,
    volatilityRangeStart: "2026-07-21T00:00:00.000Z",
    volatilityRangeEndExclusive: "2026-08-20T00:00:00.000Z",
    volatilityReturnCoverageRatio: 1,

    annualizedVolatility,
    horizonVolatility,
    logPriceDistance,

    lowerPrice,
    upperPrice,
    downsideDistanceRatio: 1 - lowerPrice / currentPrice,
    upsideDistanceRatio: upperPrice / currentPrice - 1,
  };
};

const input = (overrides: Record<string, unknown> = {}): V3TickRangeInput =>
  ({
    pool: USDC_WETH_POOL,
    band: bandWith(CURRENT_PRICE, 0.2),
    snapshot: snapshotWith(CURRENT_PRICE, CURRENT_TICK),
    ...overrides,
  }) as unknown as V3TickRangeInput;

const succeed = (overrides: Record<string, unknown> = {}) => {
  const result = calculateV3TickRange(input(overrides));
  if (result.status === "unavailable") {
    throw new Error(`expected data, got ${result.reason}: ${result.message}`);
  }
  return result;
};

describe("calculateV3TickRange", () => {
  it("aligns a USDC/WETH band onto the pool's 60-tick grid", () => {
    const result = succeed();

    /*
     * Hand-derived. The band spans exp(±0.2) around 1/3000, which in raw terms is
     * ±0.2 / ln(1.0001) = ±2000.1 ticks around tick 196256:
     *   lower  194256.25 -> floor 194256 -> down to 194220 (3237 * 60)
     *   upper  198256.45 -> ceil  198257 -> up   to 198300 (3305 * 60)
     */
    expect(result.status).toBe("success");
    expect(result.data.lowerTick).toBe(194_220);
    expect(result.data.upperTick).toBe(198_300);
  });

  it("moves each edge outward, so the range always covers the band", () => {
    const { data } = succeed();

    expect(data.lowerPrice).toBeLessThanOrEqual(data.band.lowerPrice);
    expect(data.upperPrice).toBeGreaterThanOrEqual(data.band.upperPrice);
  });

  it("does not overshoot: the next tick inward would not cover the band", () => {
    const { data } = succeed();
    const spacing = data.pool.tickSpacing;

    // One spacing inward on each side must fail to cover, which is what makes
    // this the tightest aligned range rather than merely a valid one.
    expect(1.0001 ** (data.lowerTick + spacing) * 10 ** -12).toBeGreaterThan(data.band.lowerPrice);
    expect(1.0001 ** (data.upperTick - spacing) * 10 ** -12).toBeLessThan(data.band.upperPrice);
  });

  it("returns boundaries the pool would accept", () => {
    const { data } = succeed();

    expect(data.lowerTick % data.pool.tickSpacing).toBe(0);
    expect(data.upperTick % data.pool.tickSpacing).toBe(0);
    expect(data.lowerTick).toBeLessThan(data.upperTick);
  });

  it("reports where the pool currently sits", () => {
    const { data } = succeed();

    expect(data.currentTick).toBe(CURRENT_TICK);
    expect(data.chainReportedTick).toBe(CURRENT_TICK);
    expect(data.containsCurrentPrice).toBe(true);
    expect(data.lowerBoundTruncated).toBe(false);
    expect(data.upperBoundTruncated).toBe(false);
  });

  it("labels the model and carries its inputs verbatim", () => {
    const { data } = succeed();

    expect(data.method).toBe(V3_TICK_RANGE_METHOD);
    expect(data.pool).toEqual(USDC_WETH_POOL);
    expect(data.band.currentPrice).toBe(CURRENT_PRICE);
    expect(data.band.annualizedVolatility).toBe(0.2);
  });

  it("is deterministic", () => {
    expect(calculateV3TickRange(input())).toEqual(calculateV3TickRange(input()));
  });

  it("aligns a DAI/USDC-shaped pool, whose ticks are negative and spacing is 1", () => {
    // Same decimals gap the other way round: token0 has 18, token1 has 6, so par
    // sits at tick -276325 rather than +276324.
    const currentPrice = 1;
    const { data } = succeed({
      pool: poolWith(18, 6, 1),
      band: bandWith(currentPrice, 0.2),
      snapshot: snapshotWith(currentPrice, -276_325),
    });

    expect(data.currentTick).toBe(-276_325);
    expect(data.lowerTick).toBe(-278_325);
    expect(data.upperTick).toBe(-274_323);
  });
});

describe("the source's own tick as a cross-check", () => {
  it("accepts a reported tick that differs by the rounding allowance", () => {
    for (const offset of [-MAX_TICK_DISAGREEMENT, 0, MAX_TICK_DISAGREEMENT]) {
      const result = calculateV3TickRange(
        input({ snapshot: snapshotWith(CURRENT_PRICE, CURRENT_TICK + offset) }),
      );
      expect(result.status).not.toBe("unavailable");
    }
  });

  it("refuses a reported tick that disagrees with its own price", () => {
    const result = calculateV3TickRange(
      input({ snapshot: snapshotWith(CURRENT_PRICE, CURRENT_TICK + 6) }),
    );

    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.reason).toBe("invalid-input");
    expect(result.message).toContain("does not match the tick its price implies");
  });

  /*
   * The reason this cross-check exists. Nothing inside this application can tell
   * that a pool's decimals are wrong — every downstream figure stays perfectly
   * well-formed — but the pool's own tick can, because the price no longer
   * converts to it.
   */
  it("catches token decimals that do not belong to this pool", () => {
    const result = calculateV3TickRange(
      input({ pool: poolWith(18, 6, 60) }), // 6/18 swapped; the snapshot is unchanged.
    );

    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.reason).toBe("invalid-input");
    // Specifically the cross-check, not some other rejection along the way.
    expect(result.message).toContain("does not match the tick its price implies");
  });

  it("proceeds with a warning when the source reported no tick", () => {
    const result = calculateV3TickRange(input({ snapshot: snapshotWith(CURRENT_PRICE, null) }));

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.data.chainReportedTick).toBeNull();
    expect(result.warnings).toEqual([
      "The price source did not report the pool's own tick, so the converted tick could not be checked against it.",
    ]);
  });
});

describe("edges the pool cannot express", () => {
  it("truncates only the upper edge when only it runs past TickMath", () => {
    // A log distance of 80 reaches tick 996297 upward — past MAX_TICK — while
    // -603784 downward is still representable.
    const result = calculateV3TickRange(input({ band: bandWith(CURRENT_PRICE, 80) }));

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.data.lowerTick).toBe(-603_840);
    expect(result.data.upperTick).toBe(887_220); // maxUsableTick for spacing 60
    expect(result.data.lowerBoundTruncated).toBe(false);
    expect(result.data.upperBoundTruncated).toBe(true);
    expect(result.warnings).toEqual([
      "The upper edge stops at the highest tick this pool accepts, so the range does not reach as far up as the band.",
    ]);
  });

  it("truncates both edges and warns about each, lower first", () => {
    const result = calculateV3TickRange(input({ band: bandWith(CURRENT_PRICE, 120) }));

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.data.lowerTick).toBe(-887_220);
    expect(result.data.upperTick).toBe(887_220);
    expect(result.data.lowerBoundTruncated).toBe(true);
    expect(result.data.upperBoundTruncated).toBe(true);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toContain("lower edge");
    expect(result.warnings[1]).toContain("upper edge");
  });

  it("warns when truncation leaves the current tick outside the range", () => {
    // A pool trading at tick 887250 sits above the highest usable tick for a
    // spacing of 60, so the upper edge cannot be placed beyond it.
    const currentPrice = Math.exp(887_250 * Math.log1p(1e-4));
    const result = calculateV3TickRange({
      pool: poolWith(18, 18, 60),
      band: bandWith(currentPrice, 0.2),
      snapshot: snapshotWith(currentPrice, 887_250),
    } as unknown as V3TickRangeInput);

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.data.currentTick).toBe(887_250);
    expect(result.data.upperTick).toBe(887_220);
    expect(result.data.containsCurrentPrice).toBe(false);
    expect(result.warnings.at(-1)).toContain("would hold a single token");
  });
});

describe("states with no range to report", () => {
  it("refuses a current price that has no tick at all", () => {
    // A 255-decimal gap puts par at tick ~5.87 million, far past MAX_TICK. No
    // on-chain pool can trade at a price it cannot encode, so this is a
    // contradiction between the price and the decimals, not a truncated edge.
    const result = calculateV3TickRange(
      input({
        pool: poolWith(0, 255, 60),
        snapshot: snapshotWith(CURRENT_PRICE, 887_272),
      }),
    );

    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.reason).toBe("invalid-input");
    expect(result.message).toContain("lies outside the range Uniswap can express");
  });

  it("refuses a band narrower than one tick spacing rather than widening it", () => {
    // Zero volatility collapses the band onto the current price. This price is
    // exactly the price of tick 196260, which is itself a multiple of 60, so both
    // edges align onto the same tick.
    const currentPrice = 0.0003334550946122299;
    const result = calculateV3TickRange(
      input({
        band: bandWith(currentPrice, 0),
        snapshot: snapshotWith(currentPrice, 196_260),
      }),
    );

    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.reason).toBe("insufficient-data");
    // No invented width, and no data at all.
    expect(result).not.toHaveProperty("data");
  });

  it("still produces a range for a zero-width band that does not land on a boundary", () => {
    // The same zero-volatility band one tick away from a spacing boundary has two
    // distinct neighbours, so it is a range rather than a failure.
    const { data } = succeed({
      band: bandWith(CURRENT_PRICE, 0),
      snapshot: snapshotWith(CURRENT_PRICE, CURRENT_TICK),
    });

    expect(data.lowerTick).toBe(196_200);
    expect(data.upperTick).toBe(196_260);
  });
});

describe("inputs that do not belong together", () => {
  const otherPoolRef = { protocolVersion: "v3", chainId: 1, id: `0x${"e".repeat(40)}` } as const;

  it.each([
    ["a pool the band does not describe", { pool: { ...USDC_WETH_POOL, ...otherPoolRef } }],
    ["a snapshot of another pool", { snapshot: { ...snapshotWith(CURRENT_PRICE, CURRENT_TICK), pool: otherPoolRef } }],
    ["a snapshot at a different price", { snapshot: snapshotWith(CURRENT_PRICE * 1.01, CURRENT_TICK) }],
    [
      "a snapshot fetched at another moment",
      { snapshot: { ...snapshotWith(CURRENT_PRICE, CURRENT_TICK), fetchedAt: "2026-08-20T10:15:00.000Z" } },
    ],
    [
      "a snapshot from another block",
      { snapshot: { ...snapshotWith(CURRENT_PRICE, CURRENT_TICK), sourceBlockNumber: "21500001" } },
    ],
    [
      "a snapshot with no block time where the band had one",
      { snapshot: { ...snapshotWith(CURRENT_PRICE, CURRENT_TICK), sourceBlockTimestamp: null } },
    ],
  ])("refuses %s", (_label, overrides) => {
    const result = calculateV3TickRange(input(overrides));

    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.reason).toBe("invalid-input");
  });

  it.each([
    ["a pool whose tokens are misordered", { pool: { ...USDC_WETH_POOL, token0: { ...USDC_WETH_POOL.token1 }, token1: { ...USDC_WETH_POOL.token0 } } }],
    ["a pool with no tick spacing", { pool: { ...USDC_WETH_POOL, tickSpacing: 0 } }],
    ["a band with an inconsistent upper bound", { band: { ...bandWith(CURRENT_PRICE, 0.2), upperPrice: 1 } }],
    ["a snapshot with contradictory reciprocal prices", { snapshot: { ...snapshotWith(CURRENT_PRICE, CURRENT_TICK), token1PriceInToken0: 1 } }],
  ])("refuses %s", (_label, overrides) => {
    const result = calculateV3TickRange(input(overrides));

    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.reason).toBe("invalid-input");
  });

  it("refuses a snapshot with no price at all", () => {
    const result = calculateV3TickRange(
      input({
        snapshot: { ...snapshotWith(CURRENT_PRICE, CURRENT_TICK), token0PriceInToken1: null },
      }),
    );

    expect(result.status).toBe("unavailable");
  });
});

describe("V3TickRangeSchema", () => {
  const valid = succeed().data;

  const priceOf = (tick: number) =>
    priceAtTick({ tick, token0Decimals: 6, token1Decimals: 18 }) ?? 0;

  /** Moves one edge by whole spacings, keeping its price consistent with its tick. */
  const shifted = (edge: "lower" | "upper", spacings: number) => {
    const tick =
      (edge === "lower" ? valid.lowerTick : valid.upperTick) + spacings * valid.pool.tickSpacing;
    return edge === "lower"
      ? { lowerTick: tick, lowerPrice: priceOf(tick) }
      : { upperTick: tick, upperPrice: priceOf(tick) };
  };

  it("accepts the calculator's own output", () => {
    expect(V3TickRangeSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ["a lower edge one spacing wider than needed", shifted("lower", -1)],
    ["a lower edge that no longer covers the band", shifted("lower", 1)],
    ["an upper edge one spacing wider than needed", shifted("upper", 1)],
    ["an upper edge that no longer covers the band", shifted("upper", -1)],
    [
      "a boundary off the spacing grid",
      { lowerTick: valid.lowerTick + 1, lowerPrice: priceOf(valid.lowerTick + 1) },
    ],
    ["a tick moved without its price", { lowerTick: valid.lowerTick - valid.pool.tickSpacing }],
    ["a price that does not match its tick", { lowerPrice: valid.lowerPrice * 1.5 }],
    ["an upper price that does not match its tick", { upperPrice: valid.upperPrice * 1.5 }],
    ["a crossed range", { lowerTick: valid.upperTick, upperTick: valid.lowerTick }],
    ["a zero-width range", { lowerTick: valid.upperTick }],
    ["a current tick that does not contain the current price", { currentTick: valid.currentTick + 5 }],
    ["a current tick one step below the price's own", { currentTick: valid.currentTick - 1 }],
    ["a reported tick that contradicts the derived one", { chainReportedTick: valid.currentTick + 50 }],
    ["an in-range flag that contradicts the ticks", { containsCurrentPrice: false }],
    ["a truncation flag set on an edge that reached", { lowerBoundTruncated: true }],
    ["another model's label", { method: "nearest-usable-tick" }],
  ])("rejects %s", (_label, overrides) => {
    expect(V3TickRangeSchema.safeParse({ ...valid, ...overrides }).success).toBe(false);
  });

  it("rejects a zero-width range that is otherwise entirely consistent", () => {
    // Tick 196260 is a multiple of 60 and a zero-volatility band collapses onto
    // it, so every bracketing, tightness and pricing rule is satisfied by a range
    // whose two edges are the same tick. Only the ordering rule stands against it.
    const price = 0.0003334550946122299;
    const degenerate = {
      pool: USDC_WETH_POOL,
      band: bandWith(price, 0),
      method: V3_TICK_RANGE_METHOD,
      lowerTick: 196_260,
      upperTick: 196_260,
      lowerPrice: price,
      upperPrice: price,
      currentTick: 196_260,
      chainReportedTick: 196_260,
      lowerBoundTruncated: false,
      upperBoundTruncated: false,
      containsCurrentPrice: false,
    };

    expect(V3TickRangeSchema.safeParse(degenerate).success).toBe(false);
  });

  it("rejects an in-range flag set on a current tick sitting on the upper edge", () => {
    // Uniswap's upper bound is exclusive, so a position whose current tick equals
    // `upperTick` is out of range. Reachable only when truncation pins the upper
    // edge exactly where the pool is trading.
    const currentPrice = Math.exp(887_220 * Math.log1p(1e-4));
    const edgeCase = succeed({
      pool: poolWith(18, 18, 60),
      band: bandWith(currentPrice, 0.2),
      snapshot: snapshotWith(currentPrice, 887_220),
    }).data;

    expect(edgeCase.currentTick).toBe(887_220);
    expect(edgeCase.upperTick).toBe(887_220);
    expect(edgeCase.containsCurrentPrice).toBe(false);
    expect(
      V3TickRangeSchema.safeParse({ ...edgeCase, containsCurrentPrice: true }).success,
    ).toBe(false);
  });

  it("rejects a range whose pool is not the band's pool", () => {
    const swapped = {
      ...valid,
      pool: { ...valid.pool, id: `0x${"e".repeat(40)}` },
    };

    expect(V3TickRangeSchema.safeParse(swapped).success).toBe(false);
  });

  it("rejects an unexpected field", () => {
    expect(
      V3TickRangeSchema.safeParse({ ...valid, liquidityToDeposit: "1000" }).success,
    ).toBe(false);
  });
});
