import { describe, expect, it } from "vitest";

import {
  MAX_SOURCE_CLOCK_SKEW_MS,
  MAX_SOURCE_LAG_MS,
  normalizeV3PoolSnapshot,
} from "./v3PoolSnapshotAdapter";

const POOL_ADDRESS = "0xabcdef0123456789abcdef0123456789abcdef01";
const FETCHED_AT = "2026-08-20T09:15:00.000Z";
/** 12 seconds before FETCHED_AT — roughly one Ethereum block of indexer lag. */
const BLOCK_TIMESTAMP_SECONDS = 1_787_217_288;
const BLOCK_TIMESTAMP_ISO = "2026-08-20T09:14:48.000Z";

/** Offsets from FETCHED_AT, in Unix seconds, for the freshness boundary cases. */
const FETCHED_AT_SECONDS = 1_787_217_300;
const secondsBeforeFetch = (seconds: number) => FETCHED_AT_SECONDS - seconds;

/**
 * `token0Price` is token0 per token1 and `token1Price` is token1 per token0 —
 * the opposite perspective from our field names. The two values are deliberately
 * different so a reversed mapping cannot pass.
 */
const rawPool = (overrides: Record<string, unknown> = {}) => ({
  id: POOL_ADDRESS,
  token0Price: "0.0004",
  token1Price: "2500",
  totalValueLockedUSD: "1234.56",
  liquidity: "123456789012345678901234567890",
  tick: "-12345",
  ...overrides,
});

const rawMeta = (overrides: Record<string, unknown> = {}) => ({
  block: { number: 21_500_000, timestamp: BLOCK_TIMESTAMP_SECONDS },
  hasIndexingErrors: false,
  ...overrides,
});

const payload = (pool: unknown = rawPool(), meta: unknown = rawMeta()) => ({
  data: { pool, _meta: meta },
});

const normalize = (body: unknown) =>
  normalizeV3PoolSnapshot({ payload: body, poolAddress: POOL_ADDRESS, fetchedAt: FETCHED_AT });

describe("normalizeV3PoolSnapshot success", () => {
  it("produces the exact expected partial snapshot", () => {
    const result = normalize(payload());

    expect(result).toEqual({
      status: "partial",
      data: {
        pool: { protocolVersion: "v3", chainId: 1, id: POOL_ADDRESS },
        fetchedAt: FETCHED_AT,
        sourceBlockNumber: "21500000",
        sourceBlockTimestamp: BLOCK_TIMESTAMP_ISO,
        token0PriceInToken1: 2500,
        token1PriceInToken0: 0.0004,
        tvlUsd: 1234.56,
        volume24hUsd: null,
        volume7dUsd: null,
        volume30dUsd: null,
        tick: -12345,
        liquidity: "123456789012345678901234567890",
        source: "uniswap-v3-subgraph",
      },
      missingFields: ["volume24hUsd", "volume7dUsd", "volume30dUsd"],
      warnings: [expect.stringContaining("Rolling")],
    });
  });

  it("maps subgraph token1Price to token0PriceInToken1, not the reverse", () => {
    const result = normalize(payload(rawPool({ token0Price: "0.0004", token1Price: "2500" })));

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    // token1Price (token1 per token0) is the price of token0 expressed in token1.
    expect(result.data.token0PriceInToken1).toBe(2500);
    // token0Price (token0 per token1) is the price of token1 expressed in token0.
    expect(result.data.token1PriceInToken0).toBe(0.0004);
  });

  it("keeps the two price directions distinct when the pair is inverted", () => {
    const result = normalize(payload(rawPool({ token0Price: "2500", token1Price: "0.0004" })));

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.data.token0PriceInToken1).toBe(0.0004);
    expect(result.data.token1PriceInToken0).toBe(2500);
  });

  it("normalizes an upper-case pool address to lowercase", () => {
    const upper = POOL_ADDRESS.toUpperCase().replace("0X", "0x");
    const result = normalizeV3PoolSnapshot({
      payload: payload(rawPool({ id: upper })),
      poolAddress: POOL_ADDRESS,
      fetchedAt: FETCHED_AT,
    });

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.data.pool.id).toBe(POOL_ADDRESS);
  });

  it("carries the block number as an exact decimal string", () => {
    const result = normalize(payload(rawPool(), rawMeta({ block: { number: 21_500_001, timestamp: null } })));

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.data.sourceBlockNumber).toBe("21500001");
  });

  it("converts the block timestamp to fixed-millisecond UTC", () => {
    const result = normalize(payload());

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.data.sourceBlockTimestamp).toBe(BLOCK_TIMESTAMP_ISO);
  });

  it("accepts a null tick and reports it as missing", () => {
    const result = normalize(payload(rawPool({ tick: null })));

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.data.tick).toBeNull();
    expect(result.missingFields).toContain("tick");
  });

  it("accepts a zero TVL as a reported figure", () => {
    const result = normalize(payload(rawPool({ totalValueLockedUSD: "0" })));

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.data.tvlUsd).toBe(0);
    expect(result.missingFields).not.toContain("tvlUsd");
  });
});

describe("rolling volume windows", () => {
  it("leaves all three windows null", () => {
    const result = normalize(payload());

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.data.volume24hUsd).toBeNull();
    expect(result.data.volume7dUsd).toBeNull();
    expect(result.data.volume30dUsd).toBeNull();
  });

  it("never adopts a cumulative volumeUSD as a rolling window", () => {
    const withCumulative = rawPool({ volumeUSD: "987654321.12", untrackedVolumeUSD: "5" });
    const result = normalize(payload(withCumulative));

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    for (const window of [
      result.data.volume24hUsd,
      result.data.volume7dUsd,
      result.data.volume30dUsd,
    ]) {
      expect(window).toBeNull();
      expect(window).not.toBe(987_654_321.12);
    }
  });

  it("declares the three windows missing", () => {
    const result = normalize(payload());

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.missingFields).toEqual(["volume24hUsd", "volume7dUsd", "volume30dUsd"]);
  });
});

describe("missingFields determinism", () => {
  it("lists fields in schema order, not discovery order", () => {
    const result = normalize(payload(rawPool({ tick: null }), null));

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.missingFields).toEqual([
      "sourceBlockNumber",
      "sourceBlockTimestamp",
      "volume24hUsd",
      "volume7dUsd",
      "volume30dUsd",
      "tick",
    ]);
  });

  it("reports a missing block timestamp without the block number", () => {
    const result = normalize(
      payload(rawPool(), rawMeta({ block: { number: 21_500_000, timestamp: null } })),
    );

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.missingFields).toEqual([
      "sourceBlockTimestamp",
      "volume24hUsd",
      "volume7dUsd",
      "volume30dUsd",
    ]);
  });

  it("returns an identical array for an identical payload", () => {
    const first = normalize(payload(rawPool({ tick: null })));
    const second = normalize(payload(rawPool({ tick: null })));

    expect(first).toEqual(second);
  });
});

describe("failing closed", () => {
  it("reports a null pool as not found", () => {
    const result = normalize(payload(null));

    expect(result).toMatchObject({ status: "unavailable", reason: "not-found" });
  });

  it("refuses a response carrying GraphQL errors even when data is present", () => {
    const body = { ...payload(), errors: [{ message: "boom" }] };

    expect(normalize(body)).toMatchObject({ status: "unavailable", reason: "invalid-response" });
  });

  it("refuses a response the indexer flagged with indexing errors", () => {
    const result = normalize(payload(rawPool(), rawMeta({ hasIndexingErrors: true })));

    expect(result).toMatchObject({ status: "unavailable", reason: "invalid-response" });
  });

  it("refuses a pool id that does not match the requested address", () => {
    const other = `0x${"9".repeat(40)}`;
    const result = normalize(payload(rawPool({ id: other })));

    expect(result).toMatchObject({ status: "unavailable", reason: "invalid-response" });
  });

  it.each([
    ["a missing data envelope", {}],
    ["a null data envelope", { data: null }],
    ["a non-object payload", 42],
    ["a missing pool field", { data: { pool: {}, _meta: rawMeta() } }],
    ["a missing _meta key", { data: { pool: rawPool() } }],
  ])("refuses %s", (_label, body) => {
    expect(normalize(body)).toMatchObject({ status: "unavailable", reason: "invalid-response" });
  });

  it.each([
    ["a boolean where a decimal string belongs", { totalValueLockedUSD: true }],
    ["a JS number where a decimal string belongs", { totalValueLockedUSD: 1234.56 }],
    ["non-numeric text", { totalValueLockedUSD: "not-a-number" }],
    ["a negative TVL", { totalValueLockedUSD: "-1" }],
    ["an overflowing TVL", { totalValueLockedUSD: "1e400" }],
    ["a zero token0Price", { token0Price: "0" }],
    ["a zero token1Price", { token1Price: "0" }],
    ["a negative price", { token0Price: "-0.0004" }],
    ["liquidity beyond uint128", { liquidity: "340282366920938463463374607431768211456" }],
    ["liquidity with leading zeros", { liquidity: "0123" }],
    ["liquidity as a JS number", { liquidity: 12345 }],
    ["a fractional tick", { tick: "1.5" }],
    ["a tick beyond TickMath's range", { tick: "887273" }],
    ["contradictory, non-reciprocal prices", { token0Price: "2", token1Price: "2" }],
  ])("refuses %s", (_label, overrides) => {
    expect(normalize(payload(rawPool(overrides)))).toMatchObject({
      status: "unavailable",
      reason: "invalid-response",
    });
  });

  it("refuses a non-zero TVL that underflows to zero rather than reporting a verified zero", () => {
    const result = normalize(payload(rawPool({ totalValueLockedUSD: "1e-400" })));

    expect(result).toMatchObject({ status: "unavailable", reason: "invalid-response" });
  });

  it("still accepts a TVL spelled as zero with decimal places", () => {
    const result = normalize(payload(rawPool({ totalValueLockedUSD: "0.0000" })));

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.data.tvlUsd).toBe(0);
  });

  it.each([
    ["a negative block number", { block: { number: -1, timestamp: BLOCK_TIMESTAMP_SECONDS } }],
    ["a fractional block number", { block: { number: 1.5, timestamp: BLOCK_TIMESTAMP_SECONDS } }],
    ["a string block number", { block: { number: "21500000", timestamp: BLOCK_TIMESTAMP_SECONDS } }],
    ["a block timestamp beyond the representable range", { block: { number: 1, timestamp: 9e15 } }],
  ])("refuses %s", (_label, metaOverrides) => {
    expect(normalize(payload(rawPool(), rawMeta(metaOverrides)))).toMatchObject({
      status: "unavailable",
      reason: "invalid-response",
    });
  });
});

describe("source freshness", () => {
  const atOffset = (secondsOfLag: number) =>
    normalize(
      payload(rawPool(), rawMeta({ block: { number: 21_500_000, timestamp: secondsBeforeFetch(secondsOfLag) } })),
    );

  it("accepts a source block well inside the lag limit", () => {
    expect(atOffset(60).status).toBe("partial");
  });

  it("accepts a source block exactly at the lag limit", () => {
    expect(atOffset(MAX_SOURCE_LAG_MS / 1000).status).toBe("partial");
  });

  it("refuses a source block one second past the lag limit", () => {
    expect(atOffset(MAX_SOURCE_LAG_MS / 1000 + 1)).toMatchObject({
      status: "unavailable",
      reason: "stale-data",
    });
  });

  it("refuses a badly lagging source rather than reporting it as usable", () => {
    expect(atOffset(30 * 60)).toMatchObject({ status: "unavailable", reason: "stale-data" });
  });

  it("tolerates a source block slightly ahead of our clock", () => {
    expect(atOffset(-(MAX_SOURCE_CLOCK_SKEW_MS / 1000)).status).toBe("partial");
  });

  it("refuses a source block further ahead than the tolerated skew", () => {
    expect(atOffset(-(MAX_SOURCE_CLOCK_SKEW_MS / 1000 + 1))).toMatchObject({
      status: "unavailable",
      reason: "invalid-response",
    });
  });

  it("keeps a snapshot usable when the source reports no block time, but says so", () => {
    const result = normalize(
      payload(rawPool(), rawMeta({ block: { number: 21_500_000, timestamp: null } })),
    );

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.data.sourceBlockTimestamp).toBeNull();
    expect(result.missingFields).toContain("sourceBlockTimestamp");
    expect(result.warnings.some((warning) => warning.includes("how current"))).toBe(true);
  });

  it("never substitutes the fetch time for a missing block time", () => {
    const result = normalize(
      payload(rawPool(), rawMeta({ block: { number: 21_500_000, timestamp: null } })),
    );

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.data.sourceBlockTimestamp).not.toBe(result.data.fetchedAt);
    expect(result.data.sourceBlockTimestamp).toBeNull();
  });

  it("orders warnings deterministically", () => {
    const withBlockTime = normalize(payload());
    const withoutBlockTime = normalize(
      payload(rawPool(), rawMeta({ block: { number: 21_500_000, timestamp: null } })),
    );

    expect(withBlockTime.status).toBe("partial");
    expect(withoutBlockTime.status).toBe("partial");
    if (withBlockTime.status !== "partial" || withoutBlockTime.status !== "partial") return;

    expect(withBlockTime.warnings).toHaveLength(1);
    expect(withoutBlockTime.warnings).toHaveLength(2);
    // The freshness caveat is appended after the volume caveat, never interleaved.
    expect(withoutBlockTime.warnings[0]).toBe(withBlockTime.warnings[0]);
    expect(withoutBlockTime.warnings[1]).toContain("how current");
    expect(withoutBlockTime.missingFields).toEqual([
      "sourceBlockTimestamp",
      "volume24hUsd",
      "volume7dUsd",
      "volume30dUsd",
    ]);
  });

  it("repeats the same warnings and missing fields for the same payload", () => {
    const body = payload(rawPool({ tick: null }), rawMeta({ block: { number: 7, timestamp: null } }));
    expect(normalize(body)).toEqual(normalize(body));
  });

  it("keeps freshness failure messages free of provider data and credentials", () => {
    const staleAt = secondsBeforeFetch(60 * 60);
    const result = normalize(
      payload(
        rawPool({ liquidity: "999888777666555444333222111" }),
        rawMeta({ block: { number: 21_500_123, timestamp: staleAt } }),
      ),
    );

    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    for (const forbidden of [
      String(staleAt),
      "21500123",
      "999888777666555444333222111",
      "gateway.thegraph.com",
      "Bearer",
      "apiKey",
      "SUBGRAPH_ID",
    ]) {
      expect(result.message).not.toContain(forbidden);
    }
  });
});
