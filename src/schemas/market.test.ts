import { describe, expect, it } from "vitest";

import {
  DAILY_PRICE_HISTORY_MAX_POINTS,
  HistoricalPricePointSchema,
  PoolDailyPriceHistorySchema,
  PoolMarketSnapshotSchema,
  RECIPROCAL_PRICE_TOLERANCE,
} from "./index";

const MAX_UINT128 = "340282366920938463463374607431768211455";
const FETCHED_AT = "2026-08-20T09:15:00.000Z";
const BLOCK_TIME = "2026-08-20T09:14:48.000Z";

const v3Reference = { protocolVersion: "v3", chainId: 1, id: `0x${"d".repeat(40)}` };
const v4Reference = { protocolVersion: "v4", chainId: 1, id: `0x${"c".repeat(64)}` };

const snapshot = {
  pool: v3Reference,
  fetchedAt: FETCHED_AT,
  sourceBlockNumber: "21500000",
  sourceBlockTimestamp: BLOCK_TIME,
  token0PriceInToken1: 2500,
  token1PriceInToken0: 1 / 2500,
  tvlUsd: 1234.56,
  volume24hUsd: 98765.43,
  volume7dUsd: null,
  volume30dUsd: null,
  tick: -12345,
  liquidity: "123456789012345678901234567890",
  source: "uniswap-v3-subgraph",
};

const v4Snapshot = { ...snapshot, pool: v4Reference, source: "uniswap-v4-subgraph" };

const without = (key: string) => {
  const copy: Record<string, unknown> = { ...snapshot };
  delete copy[key];
  return copy;
};

const METRIC_FIELDS = [
  "token0PriceInToken1",
  "token1PriceInToken0",
  "tvlUsd",
  "volume24hUsd",
  "volume7dUsd",
  "volume30dUsd",
  "tick",
  "liquidity",
] as const;

describe("PoolMarketSnapshotSchema metrics", () => {
  it("accepts a fully populated snapshot", () => {
    expect(PoolMarketSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it("accepts a snapshot where every metric is unknown", () => {
    const blank = { ...snapshot };
    for (const field of METRIC_FIELDS) {
      Object.assign(blank, { [field]: null });
    }
    expect(PoolMarketSnapshotSchema.safeParse(blank).success).toBe(true);
  });

  it("keeps unknown metrics null rather than turning them into zero", () => {
    const blank = { ...snapshot };
    for (const field of METRIC_FIELDS) {
      Object.assign(blank, { [field]: null });
    }
    const parsed = PoolMarketSnapshotSchema.parse(blank);
    for (const field of METRIC_FIELDS) {
      expect(parsed[field]).toBeNull();
    }
  });

  it("keeps a genuinely reported zero as zero", () => {
    const parsed = PoolMarketSnapshotSchema.parse({ ...snapshot, volume24hUsd: 0, tvlUsd: 0 });
    expect(parsed.volume24hUsd).toBe(0);
    expect(parsed.tvlUsd).toBe(0);
  });

  it.each(METRIC_FIELDS)("rejects an omitted %s, which must be an explicit null", (field) => {
    expect(PoolMarketSnapshotSchema.safeParse(without(field)).success).toBe(false);
  });

  it.each([
    ["negative TVL", { tvlUsd: -1 }],
    ["negative volume", { volume24hUsd: -1 }],
    ["NaN TVL", { tvlUsd: Number.NaN }],
    ["infinite volume", { volume7dUsd: Number.POSITIVE_INFINITY }],
    ["a zero price", { token0PriceInToken1: 0, token1PriceInToken0: null }],
    ["a fractional tick", { tick: 1.5 }],
    ["a tick beyond TickMath's range", { tick: 887_273 }],
  ])("rejects %s", (_label, patch) => {
    expect(PoolMarketSnapshotSchema.safeParse({ ...snapshot, ...patch }).success).toBe(false);
  });

  it("rejects an unexpected field", () => {
    expect(PoolMarketSnapshotSchema.safeParse({ ...snapshot, aprPercent: 12.5 }).success).toBe(false);
  });
});

describe("PoolMarketSnapshotSchema liquidity", () => {
  it("accepts the largest uint128", () => {
    expect(PoolMarketSnapshotSchema.safeParse({ ...snapshot, liquidity: MAX_UINT128 }).success).toBe(
      true,
    );
  });

  it("rejects one past the largest uint128", () => {
    const tooBig = "340282366920938463463374607431768211456";
    expect(PoolMarketSnapshotSchema.safeParse({ ...snapshot, liquidity: tooBig }).success).toBe(false);
  });

  it.each([["0"], [MAX_UINT128]])("keeps %s exact as a string", (liquidity) => {
    expect(PoolMarketSnapshotSchema.parse({ ...snapshot, liquidity }).liquidity).toBe(liquidity);
  });

  it.each([["0123"], ["-1"], ["1.5"], ["12,345"]])("rejects malformed liquidity %s", (liquidity) => {
    expect(PoolMarketSnapshotSchema.safeParse({ ...snapshot, liquidity }).success).toBe(false);
  });

  it("rejects liquidity given as a JS number, which would lose precision", () => {
    expect(PoolMarketSnapshotSchema.safeParse({ ...snapshot, liquidity: 12345 }).success).toBe(false);
  });
});

describe("PoolMarketSnapshotSchema freshness", () => {
  it("accepts a snapshot whose source reports no indexing position", () => {
    const result = PoolMarketSnapshotSchema.safeParse({
      ...snapshot,
      sourceBlockNumber: null,
      sourceBlockTimestamp: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a block number without a block time", () => {
    expect(
      PoolMarketSnapshotSchema.safeParse({ ...snapshot, sourceBlockTimestamp: null }).success,
    ).toBe(true);
  });

  it.each([["sourceBlockNumber"], ["sourceBlockTimestamp"]])(
    "rejects an omitted %s, which must be an explicit null",
    (field) => {
      expect(PoolMarketSnapshotSchema.safeParse(without(field)).success).toBe(false);
    },
  );

  it("requires a fetch time", () => {
    expect(PoolMarketSnapshotSchema.safeParse(without("fetchedAt")).success).toBe(false);
  });

  it("keeps a block number exact rather than parsing it into a number", () => {
    const blockNumber = "99999999999999999999999999";
    const parsed = PoolMarketSnapshotSchema.parse({ ...snapshot, sourceBlockNumber: blockNumber });
    expect(parsed.sourceBlockNumber).toBe(blockNumber);
  });

  it.each([
    ["a JS number", 21_500_000],
    ["leading zeros", "0021500000"],
    ["a negative value", "-1"],
  ])("rejects a block number given as %s", (_label, sourceBlockNumber) => {
    expect(PoolMarketSnapshotSchema.safeParse({ ...snapshot, sourceBlockNumber }).success).toBe(false);
  });

  it.each([["fetchedAt"], ["sourceBlockTimestamp"]])(
    "requires canonical millisecond precision for %s",
    (field) => {
      const coarse = { ...snapshot, [field]: "2026-08-20T09:15:00Z" };
      expect(PoolMarketSnapshotSchema.safeParse(coarse).success).toBe(false);
    },
  );
});

describe("PoolMarketSnapshotSchema reciprocal prices", () => {
  it("accepts a genuine reciprocal pair", () => {
    expect(PoolMarketSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(
      PoolMarketSnapshotSchema.safeParse({
        ...snapshot,
        token0PriceInToken1: 2,
        token1PriceInToken0: 0.5,
      }).success,
    ).toBe(true);
  });

  it("rejects a contradictory pair", () => {
    expect(
      PoolMarketSnapshotSchema.safeParse({
        ...snapshot,
        token0PriceInToken1: 2,
        token1PriceInToken0: 2,
      }).success,
    ).toBe(false);
  });

  it("reports the contradiction against a price field", () => {
    const result = PoolMarketSnapshotSchema.safeParse({
      ...snapshot,
      token0PriceInToken1: 2,
      token1PriceInToken0: 2,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["token1PriceInToken0"]);
  });

  it("accepts a snapshot with neither direction known", () => {
    expect(
      PoolMarketSnapshotSchema.safeParse({
        ...snapshot,
        token0PriceInToken1: null,
        token1PriceInToken0: null,
      }).success,
    ).toBe(true);
  });

  it.each([["token0PriceInToken1"], ["token1PriceInToken0"]])(
    "accepts a snapshot with only %s unknown",
    (field) => {
      expect(PoolMarketSnapshotSchema.safeParse({ ...snapshot, [field]: null }).success).toBe(true);
    },
  );

  it("never fabricates the missing direction", () => {
    const parsed = PoolMarketSnapshotSchema.parse({ ...snapshot, token1PriceInToken0: null });
    expect(parsed.token1PriceInToken0).toBeNull();
  });

  it("accepts drift within the documented tolerance", () => {
    const drifted = { ...snapshot, token0PriceInToken1: 2, token1PriceInToken0: 0.5 * (1 + RECIPROCAL_PRICE_TOLERANCE / 2) };
    expect(PoolMarketSnapshotSchema.safeParse(drifted).success).toBe(true);
  });

  it("rejects drift beyond the documented tolerance", () => {
    const drifted = { ...snapshot, token0PriceInToken1: 2, token1PriceInToken0: 0.5 * (1 + RECIPROCAL_PRICE_TOLERANCE * 10) };
    expect(PoolMarketSnapshotSchema.safeParse(drifted).success).toBe(false);
  });

  it("accepts an extreme but genuine reciprocal pair", () => {
    const extreme = { ...snapshot, token0PriceInToken1: 1e300, token1PriceInToken0: 1e-300 };
    expect(PoolMarketSnapshotSchema.safeParse(extreme).success).toBe(true);
  });

  it("rejects a pair whose product overflows, without throwing", () => {
    const overflow = { ...snapshot, token0PriceInToken1: 1e300, token1PriceInToken0: 1e300 };
    expect(() => PoolMarketSnapshotSchema.safeParse(overflow)).not.toThrow();
    expect(PoolMarketSnapshotSchema.safeParse(overflow).success).toBe(false);
  });
});

describe("PoolMarketSnapshotSchema source correlation", () => {
  it.each([
    ["a v3 pool from the v3 subgraph", snapshot],
    ["a v3 pool from derived analytics", { ...snapshot, source: "derived-analytics" }],
    ["a v4 pool from the v4 subgraph", v4Snapshot],
    ["a v4 pool from derived analytics", { ...v4Snapshot, source: "derived-analytics" }],
  ])("accepts %s", (_label, value) => {
    expect(PoolMarketSnapshotSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    ["a v3 pool attributed to the v4 subgraph", { ...snapshot, source: "uniswap-v4-subgraph" }],
    ["a v4 pool attributed to the v3 subgraph", { ...v4Snapshot, source: "uniswap-v3-subgraph" }],
    ["a v3 pool attributed to the hook registry", { ...snapshot, source: "hook-registry" }],
    ["a v4 pool attributed to the hook registry", { ...v4Snapshot, source: "hook-registry" }],
    ["an unknown source", { ...snapshot, source: "etherscan" }],
  ])("rejects %s", (_label, value) => {
    expect(PoolMarketSnapshotSchema.safeParse(value).success).toBe(false);
  });

  it("reports the mismatch against the source field", () => {
    const result = PoolMarketSnapshotSchema.safeParse({ ...snapshot, source: "hook-registry" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["source"]);
  });
});

describe("HistoricalPricePointSchema", () => {
  it("accepts a well-formed observation", () => {
    expect(
      HistoricalPricePointSchema.safeParse({ timestamp: FETCHED_AT, price: 2500 }).success,
    ).toBe(true);
  });

  it.each([
    ["a zero price", { timestamp: FETCHED_AT, price: 0 }],
    ["a negative price", { timestamp: FETCHED_AT, price: -1 }],
    ["a null price, since a point without one is not an observation", { timestamp: FETCHED_AT, price: null }],
    ["a missing timestamp", { price: 2500 }],
    ["a coarse timestamp", { timestamp: "2026-08-20T09:15:00Z", price: 2500 }],
  ])("rejects %s", (_label, value) => {
    expect(HistoricalPricePointSchema.safeParse(value).success).toBe(false);
  });
});

describe("PoolDailyPriceHistorySchema", () => {
  const RANGE_START = "2026-07-20T00:00:00.000Z";
  const RANGE_END = "2026-08-20T00:00:00.000Z";
  const DAY_MS = 86_400_000;

  const point = (dayIndex: number, price = 2500 + dayIndex) => ({
    timestamp: new Date(Date.parse(RANGE_START) + dayIndex * DAY_MS).toISOString(),
    price,
  });

  const history = (overrides: Record<string, unknown> = {}) => ({
    pool: { protocolVersion: "v3", chainId: 1, id: `0x${"d".repeat(40)}` },
    fetchedAt: "2026-08-20T09:15:00.000Z",
    sourceBlockNumber: "21500000",
    sourceBlockTimestamp: "2026-08-20T09:14:48.000Z",
    rangeStart: RANGE_START,
    rangeEndExclusive: RANGE_END,
    interval: "1d",
    priceDirection: "token0PriceInToken1",
    points: Array.from({ length: 31 }, (_unused, index) => point(index)),
    source: "uniswap-v3-subgraph",
    ...overrides,
  });

  it("accepts a full, well-ordered series", () => {
    expect(PoolDailyPriceHistorySchema.safeParse(history()).success).toBe(true);
  });

  it("accepts a short series, because a gap is not an error", () => {
    expect(PoolDailyPriceHistorySchema.safeParse(history({ points: [point(0), point(5)] })).success).toBe(true);
  });

  it("accepts an empty series at the schema level", () => {
    // Whether too-short is usable is the adapter's policy, not the shape's.
    expect(PoolDailyPriceHistorySchema.safeParse(history({ points: [] })).success).toBe(true);
  });

  it("accepts null source block metadata", () => {
    const result = PoolDailyPriceHistorySchema.safeParse(
      history({ sourceBlockNumber: null, sourceBlockTimestamp: null }),
    );
    expect(result.success).toBe(true);
  });

  it(`rejects more than ${DAILY_PRICE_HISTORY_MAX_POINTS} points`, () => {
    const tooMany = Array.from({ length: DAILY_PRICE_HISTORY_MAX_POINTS + 1 }, (_unused, index) => point(index));
    expect(PoolDailyPriceHistorySchema.safeParse(history({ points: tooMany })).success).toBe(false);
  });

  it("rejects a range whose end is not after its start", () => {
    expect(PoolDailyPriceHistorySchema.safeParse(history({ rangeEndExclusive: RANGE_START })).success).toBe(false);
    expect(PoolDailyPriceHistorySchema.safeParse(history({ rangeStart: RANGE_END, rangeEndExclusive: RANGE_START })).success).toBe(false);
  });

  it("rejects a point before rangeStart", () => {
    expect(PoolDailyPriceHistorySchema.safeParse(history({ points: [point(-1), point(0)] })).success).toBe(false);
  });

  it("rejects a point at or after rangeEndExclusive", () => {
    expect(PoolDailyPriceHistorySchema.safeParse(history({ points: [point(0), point(31)] })).success).toBe(false);
  });

  it("rejects duplicate timestamps rather than de-duplicating them", () => {
    expect(PoolDailyPriceHistorySchema.safeParse(history({ points: [point(3), point(3)] })).success).toBe(false);
  });

  it("rejects descending points", () => {
    expect(PoolDailyPriceHistorySchema.safeParse(history({ points: [point(5), point(2)] })).success).toBe(false);
  });

  it.each([
    ["a zero price", 0],
    ["a negative price", -1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("rejects %s in a point", (_label, price) => {
    expect(PoolDailyPriceHistorySchema.safeParse(history({ points: [point(0, price)] })).success).toBe(false);
  });

  it.each([
    ["another chain", { pool: { protocolVersion: "v3", chainId: 8453, id: `0x${"d".repeat(40)}` } }],
    ["a v4 pool", { pool: { protocolVersion: "v4", chainId: 1, id: `0x${"c".repeat(64)}` } }],
    ["a foreign source", { source: "derived-analytics" }],
    ["an hourly interval", { interval: "1h" }],
    ["the opposite price direction", { priceDirection: "token1PriceInToken0" }],
  ])("rejects %s", (_label, overrides) => {
    expect(PoolDailyPriceHistorySchema.safeParse(history(overrides)).success).toBe(false);
  });

  it.each([
    ["a coarse fetchedAt", { fetchedAt: "2026-08-20T09:15:00Z" }],
    ["a coarse rangeStart", { rangeStart: "2026-07-20T00:00:00Z" }],
    ["a block number as a JS number", { sourceBlockNumber: 21_500_000 }],
  ])("rejects %s", (_label, overrides) => {
    expect(PoolDailyPriceHistorySchema.safeParse(history(overrides)).success).toBe(false);
  });

  it("rejects an unexpected field", () => {
    expect(PoolDailyPriceHistorySchema.safeParse(history({ volatility: 0.42 })).success).toBe(false);
  });

  describe("daily alignment", () => {
    const atOffset = (dayIndex: number, offsetMs: number, price = 2500) => ({
      timestamp: new Date(Date.parse(RANGE_START) + dayIndex * DAY_MS + offsetMs).toISOString(),
      price,
    });

    it("accepts midnight-aligned daily points", () => {
      const result = PoolDailyPriceHistorySchema.safeParse(
        history({ points: [point(0), point(1), point(30)] }),
      );
      expect(result.success).toBe(true);
    });

    it("rejects a noon point that is otherwise in range and correctly ordered", () => {
      // Inside [rangeStart, rangeEndExclusive), strictly after its predecessor,
      // and still not a daily close.
      const points = [point(0), atOffset(1, 12 * 60 * 60 * 1000)];
      const result = PoolDailyPriceHistorySchema.safeParse(history({ points }));

      expect(result.success).toBe(false);
      expect(result.error?.issues.some((issue) => issue.message.includes("UTC day boundary"))).toBe(
        true,
      );
    });

    it("rejects an hourly point", () => {
      const points = [point(0), atOffset(1, 60 * 60 * 1000)];
      expect(PoolDailyPriceHistorySchema.safeParse(history({ points })).success).toBe(false);
    });

    it("rejects a point offset by a single millisecond", () => {
      expect(
        PoolDailyPriceHistorySchema.safeParse(history({ points: [atOffset(1, 1)] })).success,
      ).toBe(false);
    });

    it("rejects two distinct timestamps from the same UTC calendar day", () => {
      const points = [point(3), atOffset(3, 6 * 60 * 60 * 1000)];
      const result = PoolDailyPriceHistorySchema.safeParse(history({ points }));

      expect(result.success).toBe(false);
      const messages = result.error?.issues.map((issue) => issue.message) ?? [];
      expect(messages.some((message) => message.includes("per UTC calendar day"))).toBe(true);
    });

    it("rejects a non-midnight rangeStart", () => {
      const result = PoolDailyPriceHistorySchema.safeParse(
        history({ rangeStart: "2026-07-20T00:00:00.001Z", points: [] }),
      );

      expect(result.success).toBe(false);
      expect(result.error?.issues.some((issue) => issue.path[0] === "rangeStart")).toBe(true);
    });

    it("rejects a non-midnight rangeEndExclusive", () => {
      const result = PoolDailyPriceHistorySchema.safeParse(
        history({ rangeEndExclusive: "2026-08-20T09:15:00.000Z", points: [] }),
      );

      expect(result.success).toBe(false);
      expect(result.error?.issues.some((issue) => issue.path[0] === "rangeEndExclusive")).toBe(true);
    });

    it("keeps HistoricalPricePointSchema itself interval-agnostic", () => {
      // Daily alignment is a property of this wrapper, not of a price point, so
      // hourly and weekly series can reuse the point schema unchanged.
      const noon = { timestamp: "2026-07-20T12:00:00.000Z", price: 2500 };
      expect(HistoricalPricePointSchema.safeParse(noon).success).toBe(true);
    });
  });
});
