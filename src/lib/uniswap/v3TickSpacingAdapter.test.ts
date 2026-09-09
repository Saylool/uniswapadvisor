import { describe, expect, it } from "vitest";

import { normalizeV3TickSpacing, TICK_SPACING_CALLDATA } from "./v3TickSpacingAdapter";

/** ABI right-aligns an int24 in a 32-byte word. */
const abiWord = (value: number) => `0x${value.toString(16).padStart(64, "0")}`;

describe("TICK_SPACING_CALLDATA", () => {
  it("is the four-byte selector for a no-argument call", () => {
    // keccak256("tickSpacing()")[0:4], cross-checked against 4byte, openchain,
    // and IUniswapV3PoolImmutables.sol. No arguments, so nothing follows it.
    expect(TICK_SPACING_CALLDATA).toBe("0xd0c93a7c");
    expect(TICK_SPACING_CALLDATA).toHaveLength(10);
  });
});

describe("decoding a tick spacing", () => {
  it.each([
    ["the 0.01% tier spacing", 1],
    ["the 0.05% tier spacing", 10],
    ["the 0.30% tier spacing", 60],
    ["the 1% tier spacing", 200],
    ["a governance-enabled nonstandard spacing", 37],
    ["the factory maximum", 16_383],
  ])("decodes %s", (_label, spacing) => {
    expect(normalizeV3TickSpacing({ result: abiWord(spacing) })).toEqual({
      status: "success",
      data: spacing,
    });
  });

  it("accepts uppercase hex", () => {
    const upper = `0x${"0".repeat(61)}03C`;
    expect(normalizeV3TickSpacing({ result: upper })).toEqual({ status: "success", data: 60 });
  });

  it("is deterministic", () => {
    const payload = { result: abiWord(60) };
    expect(normalizeV3TickSpacing(payload)).toEqual(normalizeV3TickSpacing(payload));
  });
});

describe("failing closed", () => {
  it("reports an empty result as not-found, since that is what a non-pool returns", () => {
    // eth_call against an EOA or an unrelated contract returns "0x".
    expect(normalizeV3TickSpacing({ result: "0x" })).toMatchObject({
      status: "unavailable",
      reason: "not-found",
    });
  });

  it("refuses a JSON-RPC error even when a result is present", () => {
    const body = { result: abiWord(60), error: { code: -32000, message: "execution reverted" } };

    expect(normalizeV3TickSpacing(body)).toMatchObject({
      status: "unavailable",
      reason: "invalid-response",
    });
  });

  it.each([
    ["zero, which the factory forbids", 0],
    ["16_384, one past the factory limit", 16_384],
    ["an absurdly large value", 1_000_000],
  ])("refuses %s", (_label, spacing) => {
    expect(normalizeV3TickSpacing({ result: abiWord(spacing) })).toMatchObject({
      status: "unavailable",
      reason: "invalid-response",
    });
  });

  it("refuses a sign-extended negative int24", () => {
    // -60 as a two's-complement 256-bit word.
    const negative = `0x${"f".repeat(62)}c4`;
    expect(normalizeV3TickSpacing({ result: negative })).toMatchObject({
      status: "unavailable",
      reason: "invalid-response",
    });
  });

  it.each([
    // A valid word is exactly 64 hex characters; these are 63 and 65.
    ["a word one character short", `0x${"0".repeat(61)}3c`],
    ["a word one character long", `0x${"0".repeat(63)}3c`],
    ["a value without the 0x prefix", "0".repeat(64)],
    ["non-hex characters", `0x${"z".repeat(64)}`],
    ["an empty string", ""],
  ])("refuses %s", (_label, result) => {
    expect(normalizeV3TickSpacing({ result })).toMatchObject({
      status: "unavailable",
      reason: "invalid-response",
    });
  });

  it.each([
    ["a missing result", {}],
    ["a null result", { result: null }],
    ["a numeric result", { result: 60 }],
    ["a non-object payload", 42],
    ["null", null],
  ])("refuses %s", (_label, payload) => {
    expect(normalizeV3TickSpacing(payload)).toMatchObject({
      status: "unavailable",
      reason: "invalid-response",
    });
  });

  it("keeps failure messages free of provider detail", () => {
    const leaky = { error: { message: "https://eth-mainnet.example/v2/SECRETKEY failed" } };
    const result = normalizeV3TickSpacing(leaky);

    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.message).not.toContain("SECRETKEY");
    expect(result.message).not.toContain("eth-mainnet.example");
  });
});
