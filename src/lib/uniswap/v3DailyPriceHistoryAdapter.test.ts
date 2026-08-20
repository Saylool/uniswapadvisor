import { describe, expect, it } from "vitest";

import { resolveDailyHistoryWindow } from "./v3DailyHistoryWindow";
import { normalizeV3DailyPriceHistory } from "./v3DailyPriceHistoryAdapter";

const POOL_ADDRESS = "0xabcdef0123456789abcdef0123456789abcdef01";
const FETCHED_AT = "2026-08-20T09:15:00.000Z";
const WINDOW = resolveDailyHistoryWindow(new Date(FETCHED_AT));
const DAY = 86_400;
const FIRST_DAY_UNIX = WINDOW.rangeStartUnixSeconds;

/** 12 seconds before FETCHED_AT — one block of ordinary indexer lag. */
const BLOCK_TIMESTAMP_SECONDS = 1_787_217_288;

const dayRow = (index: number, token1Price = String(2500 + index)) => ({
  id: `${POOL_ADDRESS}-${index}`,
  date: FIRST_DAY_UNIX + index * DAY,
  token1Price,
  pool: { id: POOL_ADDRESS },
});

const fullDays = () => Array.from({ length: 31 }, (_unused, index) => dayRow(index));

const rawMeta = (overrides: Record<string, unknown> = {}) => ({
  block: { number: 21_500_000, timestamp: BLOCK_TIMESTAMP_SECONDS },
  hasIndexingErrors: false,
  ...overrides,
});

const payload = (
  poolDayDatas: unknown = fullDays(),
  meta: unknown = rawMeta(),
  pool: unknown = { id: POOL_ADDRESS },
) => ({ data: { pool, poolDayDatas, _meta: meta } });

const normalize = (body: unknown) =>
  normalizeV3DailyPriceHistory({
    payload: body,
    poolAddress: POOL_ADDRESS,
    fetchedAt: FETCHED_AT,
    window: WINDOW,
  });

describe("a complete 31-day history", () => {
  it("produces the exact expected success object", () => {
    const result = normalize(payload());

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.data).toEqual({
      pool: { protocolVersion: "v3", chainId: 1, id: POOL_ADDRESS },
      fetchedAt: FETCHED_AT,
      sourceBlockNumber: "21500000",
      sourceBlockTimestamp: "2026-08-20T09:14:48.000Z",
      rangeStart: "2026-07-20T00:00:00.000Z",
      rangeEndExclusive: "2026-08-20T00:00:00.000Z",
      interval: "1d",
      priceDirection: "token0PriceInToken1",
      points: Array.from({ length: 31 }, (_unused, index) => ({
        timestamp: new Date((FIRST_DAY_UNIX + index * DAY) * 1000).toISOString(),
        price: 2500 + index,
      })),
      source: "uniswap-v3-subgraph",
    });
  });

  it("maps subgraph token1Price onto the token0PriceInToken1 direction", () => {
    // token1Price is token1 per token0 — the price of token0 quoted in token1.
    const rows = fullDays().map((row, index) => ({ ...row, token1Price: String(1000 + index) }));
    const result = normalize(payload(rows));

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.data.priceDirection).toBe("token0PriceInToken1");
    expect(result.data.points[0]?.price).toBe(1000);
    expect(result.data.points.at(-1)?.price).toBe(1030);
  });

  it("ignores a token0Price the provider also sends", () => {
    const rows = fullDays().map((row) => ({ ...row, token0Price: "0.0004" }));
    const result = normalize(payload(rows));

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.data.points[0]?.price).toBe(2500);
  });

  it("emits points in strictly ascending timestamp order", () => {
    const result = normalize(payload());

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    const instants = result.data.points.map((point) => Date.parse(point.timestamp));
    expect(instants).toEqual([...instants].sort((a, b) => a - b));
    expect(new Set(instants).size).toBe(31);
  });

  it("covers the whole window without touching the current day", () => {
    const result = normalize(payload());

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.data.points[0]?.timestamp).toBe("2026-07-20T00:00:00.000Z");
    expect(result.data.points.at(-1)?.timestamp).toBe("2026-08-19T00:00:00.000Z");
  });
});

describe("incomplete coverage", () => {
  it("keeps real observations and never fabricates a skipped day", () => {
    const withGap = fullDays().filter((_row, index) => index !== 10);
    const result = normalize(payload(withGap));

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.data.points).toHaveLength(30);
    const missingDay = new Date((FIRST_DAY_UNIX + 10 * DAY) * 1000).toISOString();
    expect(result.data.points.map((point) => point.timestamp)).not.toContain(missingDay);
    expect(result.missingFields).toContain("points");
    expect(result.warnings.some((warning) => warning.includes("missing days"))).toBe(true);
  });

  it.each([[2], [5], [30]])("returns partial for %s real points", (count) => {
    const result = normalize(payload(fullDays().slice(0, count)));

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.data.points).toHaveLength(count);
    expect(result.missingFields).toEqual(["points"]);
    expect(result.warnings).toHaveLength(1);
  });

  it("orders missing fields and warnings deterministically", () => {
    const result = normalize(payload(fullDays().slice(0, 5), null));

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.missingFields).toEqual([
      "sourceBlockNumber",
      "sourceBlockTimestamp",
      "points",
    ]);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toContain("missing days");
    expect(result.warnings[1]).toContain("how current");
  });

  it("repeats identical output for an identical payload", () => {
    const body = payload(fullDays().slice(0, 7), null);
    expect(normalize(body)).toEqual(normalize(body));
  });

  it("stays a success when every day is present but block metadata is not", () => {
    const result = normalize(payload(fullDays(), rawMeta({ block: { number: 5, timestamp: null } })));

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.data.points).toHaveLength(31);
    expect(result.missingFields).toEqual(["sourceBlockTimestamp"]);
    expect(result.warnings).toEqual([expect.stringContaining("how current")]);
  });
});

describe("insufficient history", () => {
  it.each([
    ["no days at all", []],
    ["a single day", [dayRow(0)]],
  ])("reports %s as insufficient-data rather than not-found", (_label, rows) => {
    expect(normalize(payload(rows))).toMatchObject({
      status: "unavailable",
      reason: "insufficient-data",
    });
  });

  it("becomes usable at two points", () => {
    expect(normalize(payload([dayRow(0), dayRow(1)])).status).toBe("partial");
  });

  it("keeps the insufficient-data message free of provider detail", () => {
    const result = normalize(payload([dayRow(0)]));

    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.message).not.toContain(POOL_ADDRESS);
    expect(result.message).not.toContain("21500000");
  });
});

describe("failing closed", () => {
  it("reports an unknown pool as not-found", () => {
    expect(normalize(payload(fullDays(), rawMeta(), null))).toMatchObject({
      status: "unavailable",
      reason: "not-found",
    });
  });

  it("refuses a response carrying GraphQL errors even when data is present", () => {
    const body = { ...payload(), errors: [{ message: "boom" }] };
    expect(normalize(body)).toMatchObject({ status: "unavailable", reason: "invalid-response" });
  });

  it("refuses a response flagged with indexing errors", () => {
    expect(normalize(payload(fullDays(), rawMeta({ hasIndexingErrors: true })))).toMatchObject({
      status: "unavailable",
      reason: "invalid-response",
    });
  });

  it("refuses a pool id that does not match the requested address", () => {
    const other = `0x${"9".repeat(40)}`;
    expect(normalize(payload(fullDays(), rawMeta(), { id: other }))).toMatchObject({
      status: "unavailable",
      reason: "invalid-response",
    });
  });

  it("refuses duplicate day timestamps instead of de-duplicating them", () => {
    const duplicated = [...fullDays(), dayRow(10)];
    expect(normalize(payload(duplicated))).toMatchObject({
      status: "unavailable",
      reason: "invalid-response",
    });
  });

  it.each([
    ["a day before the window", FIRST_DAY_UNIX - DAY],
    ["the current incomplete day", WINDOW.rangeEndExclusiveUnixSeconds],
    ["a day beyond the window", WINDOW.rangeEndExclusiveUnixSeconds + DAY],
    ["a timestamp that is not a UTC day boundary", FIRST_DAY_UNIX + 3600],
  ])("refuses %s", (_label, date) => {
    const rows = [...fullDays().slice(0, 3), { ...dayRow(9), date }];
    expect(normalize(payload(rows))).toMatchObject({
      status: "unavailable",
      reason: "invalid-response",
    });
  });

  it("refuses a misaligned timestamp even when it is in range and in order", () => {
    // Inside the window and strictly ascending, so neither the range check nor
    // the ordering check would catch it: only day-boundary alignment does.
    const misaligned = [dayRow(0), { ...dayRow(1), date: FIRST_DAY_UNIX + DAY + 3600 }];

    expect(normalize(payload(misaligned))).toMatchObject({
      status: "unavailable",
      reason: "invalid-response",
    });
  });

  it("accepts the same two rows once the second lands on a day boundary", () => {
    expect(normalize(payload([dayRow(0), dayRow(1)])).status).toBe("partial");
  });

  it.each([
    ["a zero price", "0"],
    ["a zero price with decimals", "0.000"],
    ["a negative price", "-1500"],
    ["non-numeric text", "not-a-number"],
    ["an overflowing price", "1e400"],
    ["an empty string", ""],
  ])("refuses %s", (_label, token1Price) => {
    const rows = fullDays();
    rows[5] = dayRow(5, token1Price);
    expect(normalize(payload(rows))).toMatchObject({
      status: "unavailable",
      reason: "invalid-response",
    });
  });

  it("refuses a non-zero price that underflows to zero", () => {
    const rows = fullDays();
    rows[5] = dayRow(5, "1e-400");
    expect(normalize(payload(rows))).toMatchObject({
      status: "unavailable",
      reason: "invalid-response",
    });
  });

  it.each([
    ["a boolean price", true],
    ["a numeric price", 2500],
    ["a null price", null],
  ])("refuses %s rather than coercing it", (_label, token1Price) => {
    const rows: unknown[] = fullDays();
    rows[5] = { ...dayRow(5), token1Price };
    expect(normalize(payload(rows))).toMatchObject({
      status: "unavailable",
      reason: "invalid-response",
    });
  });

  it.each([
    ["a string date", "1784505600"],
    ["a fractional date", 1_784_505_600.5],
    ["a negative date", -1],
  ])("refuses %s", (_label, date) => {
    const rows: unknown[] = fullDays();
    rows[5] = { ...dayRow(5), date };
    expect(normalize(payload(rows))).toMatchObject({
      status: "unavailable",
      reason: "invalid-response",
    });
  });

  it.each([
    ["a missing data envelope", {}],
    ["a null data envelope", { data: null }],
    ["a non-object payload", 42],
    ["a missing poolDayDatas list", { data: { pool: { id: POOL_ADDRESS }, _meta: rawMeta() } }],
    ["poolDayDatas as an object", { data: { pool: { id: POOL_ADDRESS }, poolDayDatas: {}, _meta: rawMeta() } }],
  ])("refuses %s", (_label, body) => {
    expect(normalize(body)).toMatchObject({ status: "unavailable", reason: "invalid-response" });
  });
});

describe("source freshness reuse", () => {
  const withBlockTime = (secondsOfLag: number) =>
    normalize(
      payload(
        fullDays(),
        rawMeta({ block: { number: 21_500_000, timestamp: 1_787_217_300 - secondsOfLag } }),
      ),
    );

  it("accepts a source block exactly at the shared 15-minute limit", () => {
    expect(withBlockTime(15 * 60).status).toBe("success");
  });

  it("applies the shared stale-data policy past that limit", () => {
    expect(withBlockTime(15 * 60 + 1)).toMatchObject({
      status: "unavailable",
      reason: "stale-data",
    });
  });

  it("tolerates the shared 2-minute future clock skew", () => {
    expect(withBlockTime(-(2 * 60)).status).toBe("success");
  });

  it("applies the shared future-timestamp policy beyond that skew", () => {
    expect(withBlockTime(-(2 * 60 + 1))).toMatchObject({
      status: "unavailable",
      reason: "invalid-response",
    });
  });

  it("never substitutes the fetch time for a missing block time", () => {
    const result = normalize(payload(fullDays(), rawMeta({ block: { number: 1, timestamp: null } })));

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.data.sourceBlockTimestamp).toBeNull();
    expect(result.data.sourceBlockTimestamp).not.toBe(result.data.fetchedAt);
  });
});

describe("per-row pool ownership", () => {
  const rowWithPool = (index: number, poolId: unknown) => ({
    ...dayRow(index),
    pool: { id: poolId },
  });

  it("accepts rows whose pool id matches in lowercase", () => {
    expect(normalize(payload(fullDays())).status).toBe("success");
  });

  it("accepts a mixed-case row pool id and normalizes it", () => {
    const mixedCase = POOL_ADDRESS.toUpperCase().replace("0X", "0x");
    const rows = fullDays().map((_row, index) => rowWithPool(index, mixedCase));

    expect(normalize(payload(rows)).status).toBe("success");
  });

  it("refuses a single mismatched row among otherwise valid rows", () => {
    const rows: unknown[] = fullDays();
    rows[17] = rowWithPool(17, `0x${"9".repeat(40)}`);

    expect(normalize(payload(rows))).toMatchObject({
      status: "unavailable",
      reason: "invalid-response",
    });
  });

  it("does not let a matching top-level pool excuse a mismatched row", () => {
    const rows: unknown[] = fullDays();
    rows[0] = rowWithPool(0, `0x${"9".repeat(40)}`);

    // The top-level pool identity is the requested one, and the query filtered on
    // that pool — neither may stand in for per-row proof.
    const body = payload(rows, rawMeta(), { id: POOL_ADDRESS });
    expect(normalize(body)).toMatchObject({
      status: "unavailable",
      reason: "invalid-response",
    });
  });

  it.each([
    ["a malformed row pool address", "0xnope"],
    ["a truncated row pool address", "0x1234"],
    ["the zero address", `0x${"0".repeat(40)}`],
    ["a numeric row pool id", 12345],
    ["a null row pool id", null],
  ])("refuses %s", (_label, poolId) => {
    const rows: unknown[] = fullDays();
    rows[3] = rowWithPool(3, poolId);

    expect(normalize(payload(rows))).toMatchObject({
      status: "unavailable",
      reason: "invalid-response",
    });
  });

  it.each([
    ["a row with no pool field", (row: Record<string, unknown>) => {
      const copy = { ...row };
      delete copy.pool;
      return copy;
    }],
    ["a row whose pool has no id", (row: Record<string, unknown>) => ({ ...row, pool: {} })],
    ["a row whose pool is null", (row: Record<string, unknown>) => ({ ...row, pool: null })],
  ])("refuses %s", (_label, mutate) => {
    const rows: unknown[] = fullDays();
    rows[4] = mutate(dayRow(4));

    expect(normalize(payload(rows))).toMatchObject({
      status: "unavailable",
      reason: "invalid-response",
    });
  });

  it("does not infer ownership from array position or the row's opaque id", () => {
    // Right position, plausible-looking composite id, wrong pool.
    const rows: unknown[] = fullDays();
    rows[0] = { ...dayRow(0), id: `${POOL_ADDRESS}-0`, pool: { id: `0x${"9".repeat(40)}` } };

    expect(normalize(payload(rows))).toMatchObject({
      status: "unavailable",
      reason: "invalid-response",
    });
  });
});
