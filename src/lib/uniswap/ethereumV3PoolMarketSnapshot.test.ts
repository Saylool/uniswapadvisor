import { describe, expect, it, vi } from "vitest";

import {
  fetchEthereumV3PoolMarketSnapshot,
  V3_POOL_SNAPSHOT_QUERY,
} from "./ethereumV3PoolMarketSnapshot";
import type { FetchLike } from "./v3SubgraphTransport";

const POOL_ADDRESS = "0xabcdef0123456789abcdef0123456789abcdef01";
const MIXED_CASE_ADDRESS = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";
const UPPER_CASE_ADDRESS = "0xABCDEF0123456789ABCDEF0123456789ABCDEF01";
const ZERO_POOL_ADDRESS = `0x${"0".repeat(40)}`;
const API_KEY = "test-graph-key-must-never-leak";
/** A stable Subgraph ID, as The Graph Explorer shows it — not an IPFS hash. */
const SUBGRAPH_ID = "TestStableSubgraphId";
const FIXED_NOW = new Date("2026-08-20T09:15:00.000Z");

const successBody = {
  data: {
    pool: {
      id: POOL_ADDRESS,
      token0Price: "0.0004",
      token1Price: "2500",
      totalValueLockedUSD: "1234.56",
      liquidity: "123456789012345678901234567890",
      tick: "-12345",
    },
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

const run = (overrides: Partial<Parameters<typeof fetchEthereumV3PoolMarketSnapshot>[0]> = {}) =>
  fetchEthereumV3PoolMarketSnapshot({
    poolAddress: POOL_ADDRESS,
    apiKey: API_KEY,
    subgraphId: SUBGRAPH_ID,
    fetchImpl: respondWith(jsonResponse(successBody)),
    now: () => FIXED_NOW,
    ...overrides,
  });

/** Reads what the code actually put on the wire. */
const captureRequest = async (
  overrides: Partial<Parameters<typeof fetchEthereumV3PoolMarketSnapshot>[0]> = {},
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
  });

  it("queries by Subgraph ID rather than pinning to a deployment id", async () => {
    const { url } = await captureRequest();

    // /api/subgraphs/id/ follows published upgrades; /api/deployments/id/ would
    // freeze this adapter to one IPFS manifest.
    expect(url).toContain("/api/subgraphs/id/");
    expect(url).not.toContain("/api/deployments/id/");
  });

  it("sends the api key as a bearer token", async () => {
    const { headers } = await captureRequest();

    expect(headers.get("Authorization")).toBe(`Bearer ${API_KEY}`);
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("never caches a point-in-time market reading", async () => {
    const { init } = await captureRequest();

    expect(init.cache).toBe("no-store");
  });

  it("supplies an abort signal so the request can time out", async () => {
    const { init } = await captureRequest();

    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("passes the pool address as a GraphQL variable", async () => {
    const { body } = await captureRequest({ poolAddress: MIXED_CASE_ADDRESS });

    expect(body.variables).toEqual({ poolId: POOL_ADDRESS });
  });

  it("never interpolates the pool address into the query string", async () => {
    const { body } = await captureRequest({ poolAddress: MIXED_CASE_ADDRESS });

    expect(body.query).toBe(V3_POOL_SNAPSHOT_QUERY);
    expect(body.query.toLowerCase()).not.toContain(POOL_ADDRESS.toLowerCase());
    expect(body.query).toContain("$poolId");
  });

  it("does not request the cumulative volumeUSD field", async () => {
    const { body } = await captureRequest();

    expect(body.query).not.toContain("volumeUSD");
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
    const providerText = "subgraph deployment QmSecretLeak failed for key abc123";
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
    ["an address without a prefix", "a".repeat(40)],
    ["an empty string", ""],
  ])("reports %s as invalid input without fetching", async (_label, poolAddress) => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse(successBody));
    const result = await run({ fetchImpl, poolAddress });

    expect(result).toMatchObject({ status: "unavailable", reason: "invalid-input" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports the zero address as invalid input without fetching", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse(successBody));
    const result = await run({ fetchImpl, poolAddress: ZERO_POOL_ADDRESS });

    expect(result).toMatchObject({ status: "unavailable", reason: "invalid-input" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports the zero address as invalid input even when unconfigured", async () => {
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

  it("treats invalid caller input as the caller's fault even when unconfigured", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse(successBody));
    const result = await run({ fetchImpl, poolAddress: "0x1234", apiKey: undefined });

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
    [502, "network-error"],
    [503, "network-error"],
    [418, "invalid-response"],
    [301, "invalid-response"],
  ])("maps HTTP %s to %s", async (status, reason) => {
    const result = await run({ fetchImpl: respondWith(jsonResponse({}, status)) });

    expect(result).toMatchObject({ status: "unavailable", reason });
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

  it("maps a null pool to not-found", async () => {
    const body = { data: { pool: null, _meta: successBody.data._meta } };

    expect(await run({ fetchImpl: respondWith(jsonResponse(body)) })).toMatchObject({
      status: "unavailable",
      reason: "not-found",
    });
  });
});

describe("end to end", () => {
  it("normalizes a successful response into a partial snapshot", async () => {
    const result = await run();

    expect(result).toEqual({
      status: "partial",
      data: {
        pool: { protocolVersion: "v3", chainId: 1, id: POOL_ADDRESS },
        fetchedAt: "2026-08-20T09:15:00.000Z",
        sourceBlockNumber: "21500000",
        sourceBlockTimestamp: "2026-08-20T09:14:48.000Z",
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

  it("takes fetchedAt from the injected clock", async () => {
    const result = await run({ now: () => new Date("2026-08-20T09:20:00.000Z") });

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.data.fetchedAt).toBe("2026-08-20T09:20:00.000Z");
  });

  it("refuses a response whose source block is far behind the injected clock", async () => {
    const result = await run({ now: () => new Date("2026-08-20T11:00:00.000Z") });

    expect(result).toMatchObject({ status: "unavailable", reason: "stale-data" });
  });

  it.each([
    ["an already-lowercase address", POOL_ADDRESS],
    ["a mixed-case address", MIXED_CASE_ADDRESS],
    ["an upper-case address", UPPER_CASE_ADDRESS],
  ])("accepts %s and normalizes it to lowercase", async (_label, poolAddress) => {
    const result = await run({ poolAddress });

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.data.pool.id).toBe(POOL_ADDRESS);
  });
});
