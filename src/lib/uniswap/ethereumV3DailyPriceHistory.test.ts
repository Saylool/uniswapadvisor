import { describe, expect, it, vi } from "vitest";

import {
  fetchEthereumV3DailyPriceHistory,
  V3_DAILY_PRICE_HISTORY_QUERY,
} from "./ethereumV3DailyPriceHistory";
import { resolveDailyHistoryWindow } from "./v3DailyHistoryWindow";
import type { FetchLike } from "./v3SubgraphTransport";

const POOL_ADDRESS = "0xabcdef0123456789abcdef0123456789abcdef01";
const MIXED_CASE_ADDRESS = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";
const UPPER_CASE_ADDRESS = "0xABCDEF0123456789ABCDEF0123456789ABCDEF01";
const ZERO_POOL_ADDRESS = `0x${"0".repeat(40)}`;
const API_KEY = "test-graph-key-must-never-leak";
const SUBGRAPH_ID = "TestStableSubgraphId";
const FIXED_NOW = new Date("2026-08-20T09:15:00.000Z");
const WINDOW = resolveDailyHistoryWindow(FIXED_NOW);
const DAY = 86_400;

const successBody = {
  data: {
    pool: { id: POOL_ADDRESS },
    poolDayDatas: Array.from({ length: 31 }, (_unused, index) => ({
      id: `${POOL_ADDRESS}-${index}`,
      date: WINDOW.rangeStartUnixSeconds + index * DAY,
      token1Price: String(2500 + index),
      pool: { id: POOL_ADDRESS },
    })),
    _meta: {
      // 12 seconds before FIXED_NOW: one block of ordinary indexer lag.
      block: { number: 21_500_000, timestamp: 1_787_217_288 },
      hasIndexingErrors: false,
    },
  },
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

const respondWith = (response: Response) => vi.fn<FetchLike>(async () => response);

const run = (
  overrides: Partial<Parameters<typeof fetchEthereumV3DailyPriceHistory>[0]> = {},
) =>
  fetchEthereumV3DailyPriceHistory({
    poolAddress: POOL_ADDRESS,
    apiKey: API_KEY,
    subgraphId: SUBGRAPH_ID,
    fetchImpl: respondWith(jsonResponse(successBody)),
    now: () => FIXED_NOW,
    ...overrides,
  });

const captureRequest = async (
  overrides: Partial<Parameters<typeof fetchEthereumV3DailyPriceHistory>[0]> = {},
) => {
  const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse(successBody));
  const result = await run({ fetchImpl, ...overrides });

  const call = fetchImpl.mock.calls[0];
  if (call === undefined) throw new Error("fetch was not called");
  const [url, init] = call;
  const rawBody = typeof init.body === "string" ? init.body : "";

  return {
    result,
    url,
    init,
    rawBody,
    headers: new Headers(init.headers),
    body: JSON.parse(rawBody) as { query: string; variables: Record<string, unknown> },
  };
};

describe("request construction", () => {
  it("posts to the gateway's Subgraph ID endpoint", async () => {
    const { url, init } = await captureRequest();

    expect(url).toBe(`https://gateway.thegraph.com/api/subgraphs/id/${SUBGRAPH_ID}`);
    expect(init.method).toBe("POST");
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("sends the api key only as a bearer token", async () => {
    const { headers } = await captureRequest();

    expect(headers.get("Authorization")).toBe(`Bearer ${API_KEY}`);
  });

  it("passes the pool address through variables for both scalar positions", async () => {
    const { body } = await captureRequest({ poolAddress: MIXED_CASE_ADDRESS });

    // The singular lookup takes ID!, the reference filter takes String!, so the
    // same validated address is supplied twice rather than spliced into the text.
    expect(body.variables.poolId).toBe(POOL_ADDRESS);
    expect(body.variables.poolRef).toBe(POOL_ADDRESS);
  });

  it("passes the UTC window bounds as Int variables", async () => {
    const { body } = await captureRequest();

    expect(body.variables.rangeStart).toBe(1_784_505_600);
    expect(body.variables.rangeEndExclusive).toBe(1_787_184_000);
    expect(body.variables.dayLimit).toBe(31);
  });

  it("never interpolates the pool address into the query string", async () => {
    const { body } = await captureRequest({ poolAddress: MIXED_CASE_ADDRESS });

    expect(body.query).toBe(V3_DAILY_PRICE_HISTORY_QUERY);
    expect(body.query.toLowerCase()).not.toContain(POOL_ADDRESS.toLowerCase());
    expect(body.query).toContain("$poolId");
    expect(body.query).toContain("$poolRef");
  });

  it("asks for the pool identity so an unknown pool is distinguishable", async () => {
    const { body } = await captureRequest();

    expect(body.query).toContain("pool(id: $poolId)");
  });

  it("filters, orders and caps the daily rows in the query itself", async () => {
    const { body } = await captureRequest();

    expect(body.query).toContain("date_gte: $rangeStart");
    expect(body.query).toContain("date_lt: $rangeEndExclusive");
    expect(body.query).toContain("orderBy: date");
    expect(body.query).toContain("orderDirection: asc");
    expect(body.query).toContain("first: $dayLimit");
    expect(body.query).not.toContain("skip");
  });

  it("requests no volume or fee fields yet", async () => {
    const { body } = await captureRequest();

    for (const field of ["volumeUSD", "feesUSD", "volumeToken0", "open", "high", "low", "close"]) {
      expect(body.query).not.toContain(field);
    }
  });
});

describe("credential containment", () => {
  it("keeps the api key out of the url, body and variables", async () => {
    const { url, rawBody, body } = await captureRequest();

    expect(url).not.toContain(API_KEY);
    expect(rawBody).not.toContain(API_KEY);
    expect(JSON.stringify(body.variables)).not.toContain(API_KEY);
  });

  it.each([
    ["rejected credentials", jsonResponse({}, 401)],
    ["rate limiting", jsonResponse({}, 429)],
    ["a server fault", jsonResponse({}, 503)],
    ["an unreadable body", new Response("not json", { status: 200 })],
  ])("keeps the api key out of the message after %s", async (_label, response) => {
    const result = await run({ fetchImpl: respondWith(response) });

    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.message).not.toContain(API_KEY);
    expect(result.message).not.toContain(SUBGRAPH_ID);
    expect(result.message).not.toContain("Bearer");
  });

  it("does not echo provider error text", async () => {
    const providerText = "subgraph QmSecretLeak failed for key abc123";
    const result = await run({
      fetchImpl: respondWith(jsonResponse({ errors: [{ message: providerText }] })),
    });

    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.message).not.toContain(providerText);
    expect(result.message).not.toContain("QmSecretLeak");
  });
});

describe("guards that must not reach the network", () => {
  it.each([
    ["a missing api key", { apiKey: undefined }],
    ["a blank api key", { apiKey: "   " }],
    ["a missing subgraph id", { subgraphId: undefined }],
    ["a blank subgraph id", { subgraphId: "" }],
  ])("reports %s as a configuration error without fetching", async (_label, overrides) => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse(successBody));
    const result = await run({ fetchImpl, ...overrides });

    expect(result).toMatchObject({ status: "unavailable", reason: "configuration-error" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["a truncated address", "0x1234"],
    ["a non-hex address", `0x${"z".repeat(40)}`],
    ["an empty string", ""],
    ["the zero address", ZERO_POOL_ADDRESS],
  ])("reports %s as invalid input without fetching", async (_label, poolAddress) => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse(successBody));
    const result = await run({ fetchImpl, poolAddress });

    expect(result).toMatchObject({ status: "unavailable", reason: "invalid-input" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("still blames the caller when the server is also unconfigured", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse(successBody));
    const result = await run({
      fetchImpl,
      poolAddress: ZERO_POOL_ADDRESS,
      apiKey: undefined,
      subgraphId: undefined,
    });

    expect(result).toMatchObject({ status: "unavailable", reason: "invalid-input" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("transport failure mapping", () => {
  it.each([
    [401, "configuration-error"],
    [403, "configuration-error"],
    [429, "rate-limited"],
    [500, "network-error"],
    [503, "network-error"],
    [418, "invalid-response"],
  ])("maps HTTP %s to %s", async (status, reason) => {
    expect(await run({ fetchImpl: respondWith(jsonResponse({}, status)) })).toMatchObject({
      status: "unavailable",
      reason,
    });
  });

  it("maps a network failure to network-error", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => {
      throw new TypeError("fetch failed");
    });

    expect(await run({ fetchImpl })).toMatchObject({
      status: "unavailable",
      reason: "network-error",
    });
  });

  it("maps an aborted request to timeout", async () => {
    const fetchImpl: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });

    expect(await run({ fetchImpl, timeoutMs: 5 })).toMatchObject({
      status: "unavailable",
      reason: "timeout",
    });
  });

  it("maps malformed JSON to invalid-response", async () => {
    const fetchImpl = respondWith(new Response("<html>gateway</html>", { status: 200 }));

    expect(await run({ fetchImpl })).toMatchObject({
      status: "unavailable",
      reason: "invalid-response",
    });
  });

  it("maps an unknown pool to not-found", async () => {
    const body = { data: { ...successBody.data, pool: null } };

    expect(await run({ fetchImpl: respondWith(jsonResponse(body)) })).toMatchObject({
      status: "unavailable",
      reason: "not-found",
    });
  });

  it("maps a pool with no indexed days to insufficient-data", async () => {
    const body = { data: { ...successBody.data, poolDayDatas: [] } };

    expect(await run({ fetchImpl: respondWith(jsonResponse(body)) })).toMatchObject({
      status: "unavailable",
      reason: "insufficient-data",
    });
  });
});

describe("end to end", () => {
  it("normalizes a full response into a success result", async () => {
    const result = await run();

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.data.points).toHaveLength(31);
    expect(result.data.rangeStart).toBe("2026-07-20T00:00:00.000Z");
    expect(result.data.rangeEndExclusive).toBe("2026-08-20T00:00:00.000Z");
    expect(result.data.interval).toBe("1d");
    expect(result.data.priceDirection).toBe("token0PriceInToken1");
    expect(result.data.source).toBe("uniswap-v3-subgraph");
    expect(result.data.fetchedAt).toBe("2026-08-20T09:15:00.000Z");
  });

  it.each([
    ["an already-lowercase address", POOL_ADDRESS],
    ["a mixed-case address", MIXED_CASE_ADDRESS],
    ["an upper-case address", UPPER_CASE_ADDRESS],
  ])("accepts %s and normalizes it to lowercase", async (_label, poolAddress) => {
    const result = await run({ poolAddress });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.data.pool.id).toBe(POOL_ADDRESS);
  });

  it("derives the window from the injected clock, excluding the current day", async () => {
    const { body } = await captureRequest({ now: () => new Date("2026-09-01T23:59:59.999Z") });

    expect(body.variables.rangeEndExclusive).toBe(Date.parse("2026-09-01T00:00:00.000Z") / 1000);
    expect(body.variables.rangeStart).toBe(Date.parse("2026-08-01T00:00:00.000Z") / 1000);
  });

  it("applies the shared stale-data policy to a lagging source", async () => {
    expect(await run({ now: () => new Date("2026-08-20T11:00:00.000Z") })).toMatchObject({
      status: "unavailable",
      reason: "stale-data",
    });
  });
});

describe("clock capture around the request", () => {
  /**
   * Hands out the given instants in order, so the two reads are distinguishable.
   *
   * The cursor is a closure variable rather than `mock.calls.length`: the call is
   * recorded before the implementation runs, so reading the call count here would
   * return the *second* instant on the very first read and quietly make these
   * assertions vacuous.
   */
  const sequentialClock = (...instants: readonly string[]) => {
    let cursor = 0;
    return vi.fn(() => {
      const instant = instants[Math.min(cursor, instants.length - 1)] ?? "";
      cursor += 1;
      return new Date(instant);
    });
  };

  const BEFORE = "2026-08-20T09:15:00.000Z";
  const AFTER = "2026-08-20T09:15:07.500Z";

  it("reads the clock exactly twice on a successful request", async () => {
    const now = sequentialClock(BEFORE, AFTER);
    await run({ now });

    expect(now).toHaveBeenCalledTimes(2);
  });

  it("derives the query window from the pre-request instant", async () => {
    const now = sequentialClock(BEFORE, AFTER);
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse(successBody));
    await run({ now, fetchImpl });

    const call = fetchImpl.mock.calls[0];
    if (call === undefined) throw new Error("fetch was not called");
    const body = JSON.parse(typeof call[1].body === "string" ? call[1].body : "") as {
      variables: Record<string, unknown>;
    };
    expect(body.variables.rangeEndExclusive).toBe(Date.parse("2026-08-20T00:00:00.000Z") / 1000);
    expect(body.variables.rangeStart).toBe(Date.parse("2026-07-20T00:00:00.000Z") / 1000);
  });

  it("stamps fetchedAt with the post-response instant, not the pre-request one", async () => {
    const now = sequentialClock(BEFORE, AFTER);
    const result = await run({ now });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.data.fetchedAt).toBe(AFTER);
    expect(result.data.fetchedAt).not.toBe(BEFORE);
  });

  it("does not read the clock a second time when transport fails", async () => {
    const now = sequentialClock(BEFORE, AFTER);
    const result = await run({ now, fetchImpl: respondWith(jsonResponse({}, 503)) });

    expect(result).toMatchObject({ status: "unavailable", reason: "network-error" });
    expect(now).toHaveBeenCalledTimes(1);
  });

  it("measures freshness against the post-response instant", async () => {
    // The source block sits 14m56s behind the pre-request clock — inside the
    // 15-minute limit — but 15m04s behind the post-response clock. A slow request
    // must not be able to launder stale data into a fresh-looking result.
    const blockTime = Date.parse("2026-08-20T09:00:04.000Z") / 1000;
    const body = {
      data: {
        ...successBody.data,
        _meta: { block: { number: 21_500_000, timestamp: blockTime }, hasIndexingErrors: false },
      },
    };
    const now = sequentialClock("2026-08-20T09:15:00.000Z", "2026-08-20T09:15:08.000Z");

    const result = await run({ now, fetchImpl: respondWith(jsonResponse(body)) });

    expect(result).toMatchObject({ status: "unavailable", reason: "stale-data" });
    expect(now).toHaveBeenCalledTimes(2);
  });

  it("still accepts a source that is fresh against the post-response instant", async () => {
    const blockTime = Date.parse("2026-08-20T09:01:00.000Z") / 1000;
    const body = {
      data: {
        ...successBody.data,
        _meta: { block: { number: 21_500_000, timestamp: blockTime }, hasIndexingErrors: false },
      },
    };
    const now = sequentialClock("2026-08-20T09:15:00.000Z", "2026-08-20T09:15:08.000Z");

    const result = await run({ now, fetchImpl: respondWith(jsonResponse(body)) });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.data.fetchedAt).toBe("2026-08-20T09:15:08.000Z");
  });
});
