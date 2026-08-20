import { describe, expect, it } from "vitest";

import {
  HOOK_PERMISSION_FLAGS,
  hookPermissionBits,
  PoolReferenceSchema,
  PoolSchema,
  ProtocolVersionSchema,
  TokenSchema,
  V3PoolSchema,
  V3TokenSchema,
  V4PoolSchema,
  ZERO_ADDRESS,
} from "./index";

const V3_POOL_ID = `0x${"d".repeat(40)}`;
const V4_POOL_ID = `0x${"c".repeat(64)}`;

/** A hook's permissions are the low 14 bits, i.e. its last four hex digits. */
const hookAddressWithPermissions = (bits: number) =>
  `0x${"a".repeat(36)}${bits.toString(16).padStart(4, "0")}`;

const tokenA = { chainId: 1, address: `0x${"1".repeat(40)}`, symbol: "AAA", decimals: 18 };
const tokenB = { chainId: 1, address: `0x${"b".repeat(40)}`, symbol: "BBB", decimals: 6 };
const nativeCurrency = { chainId: 1, address: ZERO_ADDRESS, symbol: "ETH", decimals: 18 };

const v3Pool = {
  protocolVersion: "v3",
  chainId: 1,
  id: V3_POOL_ID,
  token0: tokenA,
  token1: tokenB,
  tickSpacing: 60,
  feePpm: 3000,
};

const staticFee = { kind: "static", feePpm: 500 };
const dynamicFee = (currentFeePpm: number | null = null) => ({ kind: "dynamic", currentFeePpm });

const v4PoolWith = (fee: unknown, hookAddress: string | null) => ({
  protocolVersion: "v4",
  chainId: 1,
  id: V4_POOL_ID,
  token0: tokenA,
  token1: tokenB,
  tickSpacing: 60,
  fee,
  hookAddress,
});

const v4Pool = v4PoolWith(staticFee, null);

describe("ProtocolVersionSchema", () => {
  it.each([["v3"], ["v4"]])("accepts %s", (version) => {
    expect(ProtocolVersionSchema.safeParse(version).success).toBe(true);
  });

  it.each([["v2"], ["v5"], [""], [3]])("rejects unsupported version %s", (version) => {
    expect(ProtocolVersionSchema.safeParse(version).success).toBe(false);
  });
});

describe("TokenSchema", () => {
  it("accepts a token with an optional name", () => {
    expect(TokenSchema.safeParse({ ...tokenB, name: "B Token" }).success).toBe(true);
  });

  it("accepts the zero address, which v4 uses for native currency", () => {
    expect(TokenSchema.safeParse(nativeCurrency).success).toBe(true);
  });

  it.each([
    ["an empty symbol", { ...tokenA, symbol: "" }],
    ["negative decimals", { ...tokenA, decimals: -1 }],
    ["decimals beyond uint8", { ...tokenA, decimals: 256 }],
    ["fractional decimals", { ...tokenA, decimals: 18.5 }],
    ["a zero chain id", { ...tokenA, chainId: 0 }],
    ["a negative chain id", { ...tokenA, chainId: -1 }],
    ["a malformed address", { ...tokenA, address: "0xnope" }],
  ])("rejects %s", (_label, token) => {
    expect(TokenSchema.safeParse(token).success).toBe(false);
  });

  it("rejects an unexpected field rather than silently dropping it", () => {
    expect(TokenSchema.safeParse({ ...tokenA, priceUsd: 1 }).success).toBe(false);
  });
});

describe("V3TokenSchema", () => {
  it("accepts an ERC-20 token", () => {
    expect(V3TokenSchema.safeParse(tokenA).success).toBe(true);
  });

  it("rejects the zero address, because v3 has no native currency", () => {
    expect(V3TokenSchema.safeParse(nativeCurrency).success).toBe(false);
  });
});

describe("PoolReferenceSchema", () => {
  it("accepts a v3 reference identified by a pool contract address", () => {
    expect(
      PoolReferenceSchema.safeParse({ protocolVersion: "v3", chainId: 1, id: V3_POOL_ID }).success,
    ).toBe(true);
  });

  it("accepts a v4 reference identified by a bytes32 pool id", () => {
    expect(
      PoolReferenceSchema.safeParse({ protocolVersion: "v4", chainId: 1, id: V4_POOL_ID }).success,
    ).toBe(true);
  });

  it("rejects a v3 reference whose id is the zero address", () => {
    expect(
      PoolReferenceSchema.safeParse({ protocolVersion: "v3", chainId: 1, id: ZERO_ADDRESS }).success,
    ).toBe(false);
  });

  it("rejects a v3 reference carrying a bytes32 id", () => {
    expect(
      PoolReferenceSchema.safeParse({ protocolVersion: "v3", chainId: 1, id: V4_POOL_ID }).success,
    ).toBe(false);
  });

  it("rejects a v4 reference carrying an address-shaped id", () => {
    expect(
      PoolReferenceSchema.safeParse({ protocolVersion: "v4", chainId: 1, id: V3_POOL_ID }).success,
    ).toBe(false);
  });
});

describe("pool discrimination", () => {
  it("accepts a v3 pool through both its own schema and the union", () => {
    expect(V3PoolSchema.safeParse(v3Pool).success).toBe(true);
    expect(PoolSchema.safeParse(v3Pool).success).toBe(true);
  });

  it("accepts a v4 pool through both its own schema and the union", () => {
    expect(V4PoolSchema.safeParse(v4Pool).success).toBe(true);
    expect(PoolSchema.safeParse(v4Pool).success).toBe(true);
  });

  it("rejects a v3 pool carrying v4-only fields", () => {
    expect(PoolSchema.safeParse({ ...v3Pool, hookAddress: null }).success).toBe(false);
    expect(PoolSchema.safeParse({ ...v3Pool, fee: staticFee }).success).toBe(false);
  });

  it("rejects a v4 pool carrying the v3-only fee field", () => {
    expect(PoolSchema.safeParse({ ...v4Pool, feePpm: 3000 }).success).toBe(false);
  });

  it("rejects an unsupported protocol version", () => {
    expect(PoolSchema.safeParse({ ...v3Pool, protocolVersion: "v2" }).success).toBe(false);
  });

  it("rejects an unexpected field", () => {
    expect(PoolSchema.safeParse({ ...v3Pool, apr: 12.5 }).success).toBe(false);
  });
});

describe("pool token invariants", () => {
  const cases = [
    ["V3PoolSchema", V3PoolSchema, v3Pool],
    ["V4PoolSchema", V4PoolSchema, v4Pool],
    ["PoolSchema (v3)", PoolSchema, v3Pool],
    ["PoolSchema (v4)", PoolSchema, v4Pool],
  ] as const;

  it.each(cases)("%s rejects a token on a different chain", (_label, schema, pool) => {
    expect(schema.safeParse({ ...pool, token1: { ...pool.token1, chainId: 8453 } }).success).toBe(
      false,
    );
  });

  it.each(cases)("%s rejects a reversed token pair", (_label, schema, pool) => {
    expect(schema.safeParse({ ...pool, token0: pool.token1, token1: pool.token0 }).success).toBe(
      false,
    );
  });

  it.each(cases)("%s rejects an identical token pair", (_label, schema, pool) => {
    expect(
      schema.safeParse({ ...pool, token1: { ...pool.token1, address: pool.token0.address } })
        .success,
    ).toBe(false);
  });
});

describe("v3 zero-address rules", () => {
  it("rejects a pool id of zero", () => {
    expect(PoolSchema.safeParse({ ...v3Pool, id: ZERO_ADDRESS }).success).toBe(false);
  });

  it.each([["token0"], ["token1"]])("rejects a zero %s address", (field) => {
    const token = field === "token0" ? v3Pool.token0 : v3Pool.token1;
    expect(PoolSchema.safeParse({ ...v3Pool, [field]: { ...token, address: ZERO_ADDRESS } }).success).toBe(
      false,
    );
  });
});

describe("v4 native currency", () => {
  it("accepts the zero address as token0, where it sorts first", () => {
    expect(PoolSchema.safeParse({ ...v4Pool, token0: nativeCurrency }).success).toBe(true);
  });

  it("rejects the zero address as token1, which would break Uniswap's ordering", () => {
    expect(PoolSchema.safeParse({ ...v4Pool, token1: nativeCurrency }).success).toBe(false);
  });
});

describe("protocol fee limits", () => {
  it("accepts the largest v3 fee the factory allows", () => {
    expect(PoolSchema.safeParse({ ...v3Pool, feePpm: 999_999 }).success).toBe(true);
  });

  it("rejects a v3 fee of 1_000_000, which the factory forbids", () => {
    expect(PoolSchema.safeParse({ ...v3Pool, feePpm: 1_000_000 }).success).toBe(false);
  });

  it("accepts a v4 fee of 1_000_000, which v4 allows inclusively", () => {
    const pool = v4PoolWith({ kind: "static", feePpm: 1_000_000 }, null);
    expect(PoolSchema.safeParse(pool).success).toBe(true);
  });

  it("rejects a v4 fee of 1_000_001", () => {
    const pool = v4PoolWith({ kind: "static", feePpm: 1_000_001 }, null);
    expect(PoolSchema.safeParse(pool).success).toBe(false);
  });

  it("accepts a non-standard tier, since enabled tiers are governance-controlled", () => {
    expect(PoolSchema.safeParse({ ...v3Pool, feePpm: 137 }).success).toBe(true);
  });

  it.each([["static"], ["dynamic"]])(
    "rejects the dynamic-fee sentinel as a normalized %s fee value",
    (kind) => {
      const sentinel = 0x800000;
      const fee =
        kind === "static"
          ? { kind: "static", feePpm: sentinel }
          : { kind: "dynamic", currentFeePpm: sentinel };
      expect(PoolSchema.safeParse(v4PoolWith(fee, hookAddressWithPermissions(0))).success).toBe(
        false,
      );
    },
  );
});

describe("protocol tick-spacing limits", () => {
  it("accepts the largest v3 tick spacing", () => {
    expect(PoolSchema.safeParse({ ...v3Pool, tickSpacing: 16_383 }).success).toBe(true);
  });

  it("rejects a v3 tick spacing of 16_384", () => {
    expect(PoolSchema.safeParse({ ...v3Pool, tickSpacing: 16_384 }).success).toBe(false);
  });

  it("accepts the largest v4 tick spacing", () => {
    expect(PoolSchema.safeParse({ ...v4Pool, tickSpacing: 32_767 }).success).toBe(true);
  });

  it("rejects a v4 tick spacing of 32_768", () => {
    expect(PoolSchema.safeParse({ ...v4Pool, tickSpacing: 32_768 }).success).toBe(false);
  });

  it("accepts a v4 tick spacing that would be invalid in v3", () => {
    expect(PoolSchema.safeParse({ ...v4Pool, tickSpacing: 16_384 }).success).toBe(true);
  });

  it.each([[0], [-60]])("rejects a tick spacing of %s", (tickSpacing) => {
    expect(PoolSchema.safeParse({ ...v3Pool, tickSpacing }).success).toBe(false);
  });
});

describe("hookPermissionBits", () => {
  it("reads no permissions from an address whose low bits are clear", () => {
    expect(hookPermissionBits(hookAddressWithPermissions(0))).toBe(0);
  });

  it("reads a permission the address claims", () => {
    const address = hookAddressWithPermissions(HOOK_PERMISSION_FLAGS.BEFORE_SWAP);
    expect(hookPermissionBits(address)).toBe(HOOK_PERMISSION_FLAGS.BEFORE_SWAP);
  });

  it("ignores bits above the permission mask", () => {
    expect(hookPermissionBits(`0x${"a".repeat(36)}ffff`)).toBe(hookPermissionBits(`0x${"a".repeat(36)}3fff`));
  });

  it("reads permissions regardless of address casing", () => {
    expect(hookPermissionBits(`0x${"A".repeat(36)}0080`)).toBe(HOOK_PERMISSION_FLAGS.BEFORE_SWAP);
  });
});

describe("v4 hook validity", () => {
  const schemas = [
    ["V4PoolSchema", V4PoolSchema],
    ["PoolSchema", PoolSchema],
  ] as const;

  it.each(schemas)("%s accepts a static pool with no hook", (_label, schema) => {
    expect(schema.safeParse(v4PoolWith(staticFee, null)).success).toBe(true);
  });

  it.each(schemas)("%s rejects a dynamic pool with no hook", (_label, schema) => {
    expect(schema.safeParse(v4PoolWith(dynamicFee(), null)).success).toBe(false);
    expect(schema.safeParse(v4PoolWith(dynamicFee(4200), null)).success).toBe(false);
  });

  it.each(schemas)("%s accepts a dynamic pool whose hook claims no permissions", (_label, schema) => {
    expect(schema.safeParse(v4PoolWith(dynamicFee(), hookAddressWithPermissions(0))).success).toBe(
      true,
    );
  });

  it.each(schemas)("%s accepts a dynamic pool with a permissioned hook", (_label, schema) => {
    const hook = hookAddressWithPermissions(HOOK_PERMISSION_FLAGS.BEFORE_SWAP);
    expect(schema.safeParse(v4PoolWith(dynamicFee(4200), hook)).success).toBe(true);
  });

  it.each(schemas)("%s rejects a static pool whose hook claims no permissions", (_label, schema) => {
    expect(schema.safeParse(v4PoolWith(staticFee, hookAddressWithPermissions(0))).success).toBe(
      false,
    );
  });

  it.each(schemas)("%s accepts a static pool with a permissioned hook", (_label, schema) => {
    const hook = hookAddressWithPermissions(HOOK_PERMISSION_FLAGS.BEFORE_INITIALIZE);
    expect(schema.safeParse(v4PoolWith(staticFee, hook)).success).toBe(true);
  });

  it.each(schemas)("%s rejects the zero address as a hook", (_label, schema) => {
    expect(schema.safeParse(v4PoolWith(staticFee, ZERO_ADDRESS)).success).toBe(false);
  });

  const returnDeltaPairs = [
    ["before swap", HOOK_PERMISSION_FLAGS.BEFORE_SWAP_RETURNS_DELTA, HOOK_PERMISSION_FLAGS.BEFORE_SWAP],
    ["after swap", HOOK_PERMISSION_FLAGS.AFTER_SWAP_RETURNS_DELTA, HOOK_PERMISSION_FLAGS.AFTER_SWAP],
    [
      "after add liquidity",
      HOOK_PERMISSION_FLAGS.AFTER_ADD_LIQUIDITY_RETURNS_DELTA,
      HOOK_PERMISSION_FLAGS.AFTER_ADD_LIQUIDITY,
    ],
    [
      "after remove liquidity",
      HOOK_PERMISSION_FLAGS.AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA,
      HOOK_PERMISSION_FLAGS.AFTER_REMOVE_LIQUIDITY,
    ],
  ] as const;

  it.each(returnDeltaPairs)(
    "rejects an orphaned %s return-delta flag on both schemas",
    (_label, returnsDelta) => {
      const hook = hookAddressWithPermissions(returnsDelta);
      expect(V4PoolSchema.safeParse(v4PoolWith(staticFee, hook)).success).toBe(false);
      expect(PoolSchema.safeParse(v4PoolWith(staticFee, hook)).success).toBe(false);
      expect(PoolSchema.safeParse(v4PoolWith(dynamicFee(), hook)).success).toBe(false);
    },
  );

  it.each(returnDeltaPairs)(
    "rejects an orphaned %s return-delta flag even beside an unrelated permission",
    (_label, returnsDelta) => {
      const hook = hookAddressWithPermissions(returnsDelta | HOOK_PERMISSION_FLAGS.BEFORE_DONATE);
      expect(PoolSchema.safeParse(v4PoolWith(staticFee, hook)).success).toBe(false);
    },
  );

  it.each(returnDeltaPairs)(
    "accepts a %s return-delta flag alongside its own callback",
    (_label, returnsDelta, parent) => {
      const hook = hookAddressWithPermissions(returnsDelta | parent);
      expect(V4PoolSchema.safeParse(v4PoolWith(staticFee, hook)).success).toBe(true);
      expect(PoolSchema.safeParse(v4PoolWith(staticFee, hook)).success).toBe(true);
    },
  );

  it("accepts a hook claiming every callback and every return-delta flag", () => {
    const bits = returnDeltaPairs.reduce(
      (acc, [, returnsDelta, parent]) => acc | returnsDelta | parent,
      0,
    );
    expect(PoolSchema.safeParse(v4PoolWith(staticFee, hookAddressWithPermissions(bits))).success).toBe(
      true,
    );
  });

  it("leaves v3 pools unaffected by hook rules", () => {
    expect(V3PoolSchema.safeParse(v3Pool).success).toBe(true);
  });
});
