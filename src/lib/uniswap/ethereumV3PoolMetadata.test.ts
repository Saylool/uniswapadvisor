import { describe, expect, it, vi } from "vitest";

import {
  fetchEthereumV3PoolMetadata,
  V3_POOL_METADATA_QUERY,
} from "./ethereumV3PoolMetadata";
import type { FetchLike } from "./v3SubgraphTransport";

const POOL_ADDRESS = "0xabcdef0123456789abcdef0123456789abcdef01";
const MIXED_CASE_ADDRESS = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";
const UPPER_CASE_ADDRESS = "0xABCDEF0123456789ABCDEF0123456789ABCDEF01";
const ZERO_POOL_ADDRESS = `0x${"0".repeat(40)}`;
const API_KEY = "test-graph-key-must-never-leak";
const SUBGRAPH_ID = "TestStableSubgraphId";

const successBody = {
  data: {
    pool: {
      id: POOL_ADDRESS,
      feeTier: "3000",
      token0: {
        id: "0x1111111111111111111111111111111111111111",
        symbol: "AAA",
        name: "A Token",
        decimals: "18",
      },
      token1: {
        id: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        symbol: "BBB",
        name: "B Token",
        decimals: "6",
      },
    },
    _meta: { hasIndexingErrors: false },
  },
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

const respondWith = (response: Response) => vi.fn<FetchLike>(async () => response);

const run = (overrides: Partial<Parameters<typeof fetchEthereumV3PoolMetadata>[0]> = {}) =>
  fetchEthereumV3PoolMetadata({
    poolAddress: POOL_ADDRESS,
    apiKey: API_KEY,
    subgraphId: SUBGRAPH_ID,
    fetchImpl: respondWith(jsonResponse(successBody)),
    ...overrides,
  });

const captureRequest = async (
  overrides: Partial<Parameters<typeof fetchEthereumV3PoolMetadata>[0]> = {},
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

  it("passes the pool address as a GraphQL variable", async () => {
    const { body } = await captureRequest({ poolAddress: MIXED_CASE_ADDRESS });

    expect(body.variables).toEqual({ poolId: POOL_ADDRESS });
  });

  it("never interpolates the pool address into the query string", async () => {
    const { body } = await captureRequest({ poolAddress: MIXED_CASE_ADDRESS });

    expect(body.query).toBe(V3_POOL_METADATA_QUERY);
    expect(body.query.toLowerCase()).not.toContain(POOL_ADDRESS.toLowerCase());
    expect(body.query).toContain("$poolId");
  });

  it("requests exactly the fields the metadata needs", async () => {
    const { body } = await captureRequest();

    for (const field of ["feeTier", "token0", "token1", "decimals", "symbol", "name"]) {
      expect(body.query).toContain(field);
    }
  });

  it("does not request tickSpacing, which no subgraph exposes", async () => {
    const { body } = await captureRequest();

    expect(body.query).not.toContain("tickSpacing");
  });

  it("does not request market figures this read has no use for", async () => {
    const { body } = await captureRequest();

    for (const field of ["volumeUSD", "totalValueLockedUSD", "liquidity", "sqrtPrice"]) {
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
    expect(
      await run({ fetchImpl: respondWith(new Response("<html>gateway</html>", { status: 200 })) }),
    ).toMatchObject({ status: "unavailable", reason: "invalid-response" });
  });

  it("maps an unknown pool to not-found", async () => {
    const body = { data: { pool: null, _meta: { hasIndexingErrors: false } } };

    expect(await run({ fetchImpl: respondWith(jsonResponse(body)) })).toMatchObject({
      status: "unavailable",
      reason: "not-found",
    });
  });
});

describe("end to end", () => {
  it("normalizes a full response into verified metadata", async () => {
    const result = await run();

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.data).toEqual({
      protocolVersion: "v3",
      chainId: 1,
      id: POOL_ADDRESS,
      token0: {
        chainId: 1,
        address: "0x1111111111111111111111111111111111111111",
        symbol: "AAA",
        decimals: 18,
        name: "A Token",
      },
      token1: {
        chainId: 1,
        address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        symbol: "BBB",
        decimals: 6,
        name: "B Token",
      },
      feePpm: 3000,
    });
  });

  it.each([
    ["an already-lowercase address", POOL_ADDRESS],
    ["a mixed-case address", MIXED_CASE_ADDRESS],
    ["an upper-case address", UPPER_CASE_ADDRESS],
  ])("accepts %s and normalizes it to lowercase", async (_label, poolAddress) => {
    const result = await run({ poolAddress });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.data.id).toBe(POOL_ADDRESS);
  });

  it("gives the decimals and ordering that price work needs", async () => {
    const result = await run();

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    // The two facts the snapshot could not supply.
    expect(result.data.token0.decimals).toBe(18);
    expect(result.data.token1.decimals).toBe(6);
    expect(result.data.token0.address < result.data.token1.address).toBe(true);
  });
});
