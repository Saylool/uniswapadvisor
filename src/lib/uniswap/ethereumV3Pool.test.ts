import { describe, expect, it, vi } from "vitest";

import { fetchEthereumV3Pool } from "./ethereumV3Pool";
import { fetchEthereumV3TickSpacing } from "./ethereumV3TickSpacing";
import type { FetchLike } from "./v3SubgraphTransport";

const POOL_ADDRESS = "0xabcdef0123456789abcdef0123456789abcdef01";
const ZERO_POOL_ADDRESS = `0x${"0".repeat(40)}`;
const API_KEY = "test-graph-key-must-never-leak";
const SUBGRAPH_ID = "TestStableSubgraphId";
/** Providers embed the key in the path, so the whole URL is a credential. */
const RPC_URL = "https://eth-mainnet.example.test/v2/RPC-SECRET-MUST-NEVER-LEAK";

const metadataBody = {
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

const abiWord = (value: number) => `0x${value.toString(16).padStart(64, "0")}`;
const tickSpacingBody = { jsonrpc: "2.0", id: 1, result: abiWord(60) };

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

/** Routes by destination, so one mock serves both the subgraph and the node. */
const routedFetch = (
  overrides: { subgraph?: Response; rpc?: Response } = {},
): ReturnType<typeof vi.fn<FetchLike>> =>
  vi.fn<FetchLike>(async (url) =>
    url.includes("gateway.thegraph.com")
      ? (overrides.subgraph ?? jsonResponse(metadataBody))
      : (overrides.rpc ?? jsonResponse(tickSpacingBody)),
  );

const run = (overrides: Partial<Parameters<typeof fetchEthereumV3Pool>[0]> = {}) =>
  fetchEthereumV3Pool({
    poolAddress: POOL_ADDRESS,
    apiKey: API_KEY,
    subgraphId: SUBGRAPH_ID,
    rpcUrl: RPC_URL,
    fetchImpl: routedFetch(),
    ...overrides,
  });

describe("assembling a complete pool", () => {
  it("combines subgraph metadata with the on-chain tick spacing", async () => {
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
      tickSpacing: 60,
      feePpm: 3000,
    });
  });

  it("supplies all three inputs a tick conversion needs", async () => {
    const result = await run();

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    // Ordering, decimals, spacing — the set the snapshot alone could not provide.
    expect(result.data.token0.address < result.data.token1.address).toBe(true);
    expect(result.data.token0.decimals).toBe(18);
    expect(result.data.token1.decimals).toBe(6);
    expect(result.data.tickSpacing).toBe(60);
  });

  it("issues exactly one request to each source", async () => {
    const fetchImpl = routedFetch();
    await run({ fetchImpl });

    const targets = fetchImpl.mock.calls.map(([url]) => url);
    expect(targets).toHaveLength(2);
    expect(targets.filter((url) => url.includes("gateway.thegraph.com"))).toHaveLength(1);
    expect(targets.filter((url) => url === RPC_URL)).toHaveLength(1);
  });

  it("does not accept a nonstandard fee tier paired with a mismatched spacing check", async () => {
    // A governance-enabled tier is fine; the spacing is read, never inferred.
    const rpc = jsonResponse({ result: abiWord(37) });
    const subgraph = jsonResponse({
      data: { ...metadataBody.data, pool: { ...metadataBody.data.pool, feeTier: "137" } },
    });
    const result = await run({ fetchImpl: routedFetch({ subgraph, rpc }) });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.data.feePpm).toBe(137);
    expect(result.data.tickSpacing).toBe(37);
  });

  it("is deterministic", async () => {
    expect(await run()).toEqual(await run());
  });
});

describe("propagating failures without flattening them", () => {
  it("passes through a missing pool from the subgraph", async () => {
    const subgraph = jsonResponse({ data: { pool: null, _meta: { hasIndexingErrors: false } } });

    expect(await run({ fetchImpl: routedFetch({ subgraph }) })).toMatchObject({
      status: "unavailable",
      reason: "not-found",
    });
  });

  it("passes through a non-pool address from the node", async () => {
    const rpc = jsonResponse({ result: "0x" });

    expect(await run({ fetchImpl: routedFetch({ rpc }) })).toMatchObject({
      status: "unavailable",
      reason: "not-found",
    });
  });

  it("distinguishes a missing Graph credential from a missing RPC one", async () => {
    const noGraph = await run({ apiKey: undefined });
    const noRpc = await run({ rpcUrl: undefined });

    expect(noGraph).toMatchObject({ status: "unavailable", reason: "configuration-error" });
    expect(noRpc).toMatchObject({ status: "unavailable", reason: "configuration-error" });
    // Same category, different remedy — the messages must not be identical.
    if (noGraph.status !== "unavailable" || noRpc.status !== "unavailable") return;
    expect(noGraph.message).not.toBe(noRpc.message);
    expect(noGraph.message).toContain("THE_GRAPH_API_KEY");
    expect(noRpc.message).toContain("ETHEREUM_RPC_URL");
  });

  it.each([
    ["rate limiting from the node", { rpc: jsonResponse({}, 429) }, "rate-limited"],
    ["a node outage", { rpc: jsonResponse({}, 503) }, "network-error"],
    ["rate limiting from the subgraph", { subgraph: jsonResponse({}, 429) }, "rate-limited"],
  ])("passes through %s", async (_label, responses, reason) => {
    expect(await run({ fetchImpl: routedFetch(responses) })).toMatchObject({
      status: "unavailable",
      reason,
    });
  });

  it("rejects an invalid address without contacting either source", async () => {
    const fetchImpl = routedFetch();
    const result = await run({ fetchImpl, poolAddress: ZERO_POOL_ADDRESS });

    expect(result).toMatchObject({ status: "unavailable", reason: "invalid-input" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("credential containment across both sources", () => {
  it("never puts the RPC url or the Graph key in a message", async () => {
    const failures = [
      await run({ fetchImpl: routedFetch({ rpc: jsonResponse({}, 401) }) }),
      await run({ fetchImpl: routedFetch({ subgraph: jsonResponse({}, 401) }) }),
      await run({ fetchImpl: routedFetch({ rpc: new Response("nope", { status: 200 }) }) }),
    ];

    for (const result of failures) {
      expect(result.status).toBe("unavailable");
      if (result.status !== "unavailable") continue;
      expect(result.message).not.toContain("RPC-SECRET-MUST-NEVER-LEAK");
      expect(result.message).not.toContain(RPC_URL);
      expect(result.message).not.toContain(API_KEY);
    }
  });

  it("keeps the RPC url out of every transport failure path", async () => {
    /*
     * The status-mapped paths are covered above; these are the two that build a
     * message from a *thrown* error, which is exactly where an endpoint tends to
     * get appended for debugging and then ship.
     */
    const networkFailure: FetchLike = async (url) => {
      if (url === RPC_URL) throw new TypeError(`fetch failed for ${RPC_URL}`);
      return jsonResponse(metadataBody);
    };
    const serverFault = routedFetch({ rpc: jsonResponse({}, 503) });
    const abortedRpc: FetchLike = async (url, init) => {
      if (url !== RPC_URL) return jsonResponse(metadataBody);
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    };

    const results = [
      await run({ fetchImpl: networkFailure }),
      await run({ fetchImpl: serverFault }),
      await run({ fetchImpl: abortedRpc, timeoutMs: 5 }),
    ];

    expect(results.map((result) => result.status)).toEqual([
      "unavailable",
      "unavailable",
      "unavailable",
    ]);
    for (const result of results) {
      if (result.status !== "unavailable") continue;
      expect(result.message).not.toContain("RPC-SECRET-MUST-NEVER-LEAK");
      expect(result.message).not.toContain(RPC_URL);
      expect(result.message).not.toContain("eth-mainnet.example.test");
    }
  });

  it("sends the Graph key only to the Graph, and never to the node", async () => {
    const fetchImpl = routedFetch();
    await run({ fetchImpl });

    for (const [url, init] of fetchImpl.mock.calls) {
      const headers = new Headers(init.headers);
      const authorization = headers.get("Authorization");
      if (url === RPC_URL) {
        expect(authorization).toBeNull();
        expect(typeof init.body === "string" ? init.body : "").not.toContain(API_KEY);
      } else {
        expect(authorization).toBe(`Bearer ${API_KEY}`);
      }
    }
  });

  it("keeps both requests uncached and cancellable", async () => {
    const fetchImpl = routedFetch();
    await run({ fetchImpl });

    for (const [, init] of fetchImpl.mock.calls) {
      expect(init.cache).toBe("no-store");
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });
});

describe("the on-chain read is read-only", () => {
  it("only ever calls eth_call, never a signing or sending method", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse(tickSpacingBody));
    await fetchEthereumV3TickSpacing({ poolAddress: POOL_ADDRESS, rpcUrl: RPC_URL, fetchImpl });

    const call = fetchImpl.mock.calls[0];
    if (call === undefined) throw new Error("fetch was not called");
    const body = JSON.parse(typeof call[1].body === "string" ? call[1].body : "") as {
      method: string;
      params: [{ to: string; data: string }, string];
    };

    expect(body.method).toBe("eth_call");
    expect(body.params[0].to).toBe(POOL_ADDRESS);
    expect(body.params[0].data).toBe("0xd0c93a7c");
    expect(body.params[1]).toBe("latest");
  });

  it("carries no signing method anywhere in the request", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse(tickSpacingBody));
    await fetchEthereumV3TickSpacing({ poolAddress: POOL_ADDRESS, rpcUrl: RPC_URL, fetchImpl });

    const raw = typeof fetchImpl.mock.calls[0]?.[1].body === "string"
      ? (fetchImpl.mock.calls[0]?.[1].body as string)
      : "";
    for (const forbidden of [
      "eth_sendTransaction",
      "eth_sendRawTransaction",
      "eth_sign",
      "personal_sign",
      "eth_accounts",
    ]) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it("reports a missing RPC url without contacting the node", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse(tickSpacingBody));
    const result = await fetchEthereumV3TickSpacing({
      poolAddress: POOL_ADDRESS,
      rpcUrl: "   ",
      fetchImpl,
    });

    expect(result).toMatchObject({ status: "unavailable", reason: "configuration-error" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps an aborted node request to timeout", async () => {
    const fetchImpl: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });

    expect(
      await fetchEthereumV3TickSpacing({
        poolAddress: POOL_ADDRESS,
        rpcUrl: RPC_URL,
        fetchImpl,
        timeoutMs: 5,
      }),
    ).toMatchObject({ status: "unavailable", reason: "timeout" });
  });
});
