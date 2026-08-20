import { describe, expect, it } from "vitest";

import {
  HistoricalPricePointSchema,
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
