import { describe, expect, it } from "vitest";

import { normalizeV3PoolMetadata } from "./v3PoolMetadataAdapter";

const POOL_ADDRESS = "0xabcdef0123456789abcdef0123456789abcdef01";
/** Deliberately ordered: token0 must sort strictly before token1. */
const TOKEN0_ADDRESS = "0x1111111111111111111111111111111111111111";
const TOKEN1_ADDRESS = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const rawToken = (address: string, overrides: Record<string, unknown> = {}) => ({
  id: address,
  symbol: "TKN",
  name: "Token",
  // `decimals` is BigInt! in the schema, so it arrives as a string.
  decimals: "18",
  ...overrides,
});

const rawPool = (overrides: Record<string, unknown> = {}) => ({
  id: POOL_ADDRESS,
  feeTier: "3000",
  token0: rawToken(TOKEN0_ADDRESS, { symbol: "AAA", name: "A Token", decimals: "18" }),
  token1: rawToken(TOKEN1_ADDRESS, { symbol: "BBB", name: "B Token", decimals: "6" }),
  ...overrides,
});

const payload = (pool: unknown = rawPool(), meta: unknown = { hasIndexingErrors: false }) => ({
  data: { pool, _meta: meta },
});

const normalize = (body: unknown) =>
  normalizeV3PoolMetadata({ payload: body, poolAddress: POOL_ADDRESS });

describe("a well-formed pool", () => {
  it("produces the exact expected metadata", () => {
    const result = normalize(payload());

    expect(result).toEqual({
      status: "success",
      data: {
        protocolVersion: "v3",
        chainId: 1,
        id: POOL_ADDRESS,
        token0: {
          chainId: 1,
          address: TOKEN0_ADDRESS,
          symbol: "AAA",
          decimals: 18,
          name: "A Token",
        },
        token1: {
          chainId: 1,
          address: TOKEN1_ADDRESS,
          symbol: "BBB",
          decimals: 6,
          name: "B Token",
        },
        feePpm: 3000,
      },
    });
  });

  it("carries no tickSpacing field", () => {
    const result = normalize(payload());

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    // The subgraph cannot supply it, so the type must not pretend otherwise.
    expect(Object.keys(result.data)).not.toContain("tickSpacing");
  });

  it("converts BigInt decimals and fee tier from strings to numbers", () => {
    const result = normalize(payload());

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.data.token0.decimals).toBe(18);
    expect(result.data.token1.decimals).toBe(6);
    expect(result.data.feePpm).toBe(3000);
  });

  it("preserves the provider's token ordering rather than re-sorting it", () => {
    const result = normalize(payload());

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.data.token0.address).toBe(TOKEN0_ADDRESS);
    expect(result.data.token1.address).toBe(TOKEN1_ADDRESS);
    expect(result.data.token0.address < result.data.token1.address).toBe(true);
  });

  it("lowercases mixed-case token addresses", () => {
    const upperToken0 = TOKEN0_ADDRESS.toUpperCase().replace("0X", "0x");
    const result = normalize(
      payload(rawPool({ token0: rawToken(upperToken0, { symbol: "AAA", decimals: "18" }) })),
    );

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.data.token0.address).toBe(TOKEN0_ADDRESS);
  });

  it.each([
    ["zero decimals", "0", 0],
    ["the uint8 maximum", "255", 255],
  ])("accepts %s", (_label, raw, expected) => {
    const result = normalize(
      payload(rawPool({ token0: rawToken(TOKEN0_ADDRESS, { symbol: "AAA", decimals: raw }) })),
    );

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.data.token0.decimals).toBe(expected);
  });

  it.each([
    ["a governance-enabled nonstandard tier", "137", 137],
    ["the lowest standard tier", "100", 100],
    ["the highest permitted fee", "999999", 999_999],
  ])("accepts %s without a hardcoded tier table", (_label, raw, expected) => {
    const result = normalize(payload(rawPool({ feeTier: raw })));

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.data.feePpm).toBe(expected);
  });

  it("drops an empty token name rather than reporting a token named nothing", () => {
    const result = normalize(
      payload(rawPool({ token0: rawToken(TOKEN0_ADDRESS, { symbol: "AAA", name: "" }) })),
    );

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(Object.keys(result.data.token0)).not.toContain("name");
    expect(result.data.token0.symbol).toBe("AAA");
  });

  it("is deterministic", () => {
    expect(normalize(payload())).toEqual(normalize(payload()));
  });

  it("does not depend on block metadata being present", () => {
    // Pool configuration is fixed at deployment, so a lagging indexer is fine.
    expect(normalize(payload(rawPool(), null)).status).toBe("success");
  });
});

describe("failing closed", () => {
  it("reports an unknown pool as not-found", () => {
    expect(normalize(payload(null))).toMatchObject({
      status: "unavailable",
      reason: "not-found",
    });
  });

  it("refuses a response carrying GraphQL errors even when data is present", () => {
    const body = { ...payload(), errors: [{ message: "boom" }] };
    expect(normalize(body)).toMatchObject({ status: "unavailable", reason: "invalid-response" });
  });

  it("refuses a response flagged with indexing errors", () => {
    expect(normalize(payload(rawPool(), { hasIndexingErrors: true }))).toMatchObject({
      status: "unavailable",
      reason: "invalid-response",
    });
  });

  it("refuses a pool id that does not match the requested address", () => {
    expect(normalize(payload(rawPool({ id: `0x${"9".repeat(40)}` })))).toMatchObject({
      status: "unavailable",
      reason: "invalid-response",
    });
  });

  it("refuses a reversed token pair instead of silently re-sorting it", () => {
    const swapped = rawPool({
      token0: rawToken(TOKEN1_ADDRESS, { symbol: "BBB", decimals: "6" }),
      token1: rawToken(TOKEN0_ADDRESS, { symbol: "AAA", decimals: "18" }),
    });

    // Swapping the pair would invert every price derived from these decimals.
    expect(normalize(payload(swapped))).toMatchObject({
      status: "unavailable",
      reason: "invalid-response",
    });
  });

  it("refuses an identical token pair", () => {
    const same = rawPool({ token1: rawToken(TOKEN0_ADDRESS, { symbol: "AAA", decimals: "18" }) });

    expect(normalize(payload(same))).toMatchObject({
      status: "unavailable",
      reason: "invalid-response",
    });
  });

  it.each([
    ["a zero token0 address", { token0: rawToken(`0x${"0".repeat(40)}`) }],
    ["a zero token1 address", { token1: rawToken(`0x${"0".repeat(40)}`) }],
    ["a malformed token address", { token0: rawToken("0xnope") }],
  ])("refuses %s", (_label, overrides) => {
    expect(normalize(payload(rawPool(overrides)))).toMatchObject({
      status: "unavailable",
      reason: "invalid-response",
    });
  });

  it.each([
    ["an empty symbol", { symbol: "" }],
    ["decimals beyond uint8", { decimals: "256" }],
    ["negative decimals", { decimals: "-1" }],
    ["fractional decimals", { decimals: "18.5" }],
    ["non-numeric decimals", { decimals: "eighteen" }],
    ["decimals as a JSON number", { decimals: 18 }],
    ["a boolean symbol", { symbol: true }],
  ])("refuses %s", (_label, tokenOverrides) => {
    const pool = rawPool({ token0: rawToken(TOKEN0_ADDRESS, tokenOverrides) });
    expect(normalize(payload(pool))).toMatchObject({
      status: "unavailable",
      reason: "invalid-response",
    });
  });

  it.each([
    ["a fee at the factory limit", "1000000"],
    ["a negative fee", "-1"],
    ["a fractional fee", "3000.5"],
    ["a non-numeric fee", "three thousand"],
    ["a fee as a JSON number", 3000],
  ])("refuses %s", (_label, feeTier) => {
    expect(normalize(payload(rawPool({ feeTier })))).toMatchObject({
      status: "unavailable",
      reason: "invalid-response",
    });
  });

  it.each([
    ["a missing data envelope", {}],
    ["a null data envelope", { data: null }],
    ["a non-object payload", 42],
    ["a pool with no tokens", { data: { pool: { id: POOL_ADDRESS, feeTier: "3000" }, _meta: null } }],
    ["a pool with no feeTier", { data: { pool: { id: POOL_ADDRESS, token0: rawToken(TOKEN0_ADDRESS), token1: rawToken(TOKEN1_ADDRESS) }, _meta: null } }],
  ])("refuses %s", (_label, body) => {
    expect(normalize(body)).toMatchObject({ status: "unavailable", reason: "invalid-response" });
  });

  it("keeps failure messages free of provider detail", () => {
    const result = normalize(payload(rawPool({ feeTier: "-1" })));

    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.message).not.toContain(POOL_ADDRESS);
    expect(result.message).not.toContain("-1");
  });
});
