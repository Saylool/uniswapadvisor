import { describe, expect, it } from "vitest";

import {
  Bytes32HexSchema,
  EvmAddressSchema,
  IsoTimestampSchema,
  nonZeroEvmAddress,
  PositivePriceSchema,
  Uint128StringSchema,
  UnsignedIntegerStringSchema,
  UsdAmountSchema,
  ZERO_ADDRESS,
} from "./index";

const hexAddress = (body: string) => `0x${body.repeat(40)}`;
const MAX_UINT128 = "340282366920938463463374607431768211455";

describe("EvmAddressSchema", () => {
  it("accepts a well-formed address", () => {
    expect(EvmAddressSchema.safeParse(hexAddress("a")).success).toBe(true);
  });

  it("normalizes to lowercase so one address has one spelling", () => {
    expect(EvmAddressSchema.parse(`0x${"AbCdEf0123".repeat(4)}`)).toBe(`0x${"abcdef0123".repeat(4)}`);
  });

  it.each([
    ["too short", `0x${"a".repeat(39)}`],
    ["too long", `0x${"a".repeat(41)}`],
    ["missing 0x prefix", "a".repeat(40)],
    ["non-hex characters", hexAddress("g")],
    ["empty string", ""],
    ["a number", 12345],
    ["null", null],
  ])("rejects %s", (_label, value) => {
    expect(EvmAddressSchema.safeParse(value).success).toBe(false);
  });

  it("accepts the zero address, which v4 uses for native currency", () => {
    expect(EvmAddressSchema.safeParse(ZERO_ADDRESS).success).toBe(true);
  });
});

describe("nonZeroEvmAddress", () => {
  const schema = nonZeroEvmAddress("must not be zero");

  it("accepts a real address", () => {
    expect(schema.safeParse(hexAddress("a")).success).toBe(true);
  });

  it("rejects the zero address", () => {
    expect(schema.safeParse(ZERO_ADDRESS).success).toBe(false);
  });

  it("reports the caller's message so the reader learns what to use instead", () => {
    const result = schema.safeParse(ZERO_ADDRESS);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("must not be zero");
  });
});

describe("Bytes32HexSchema", () => {
  it("accepts 32 bytes of hex and lowercases it", () => {
    expect(Bytes32HexSchema.parse(`0x${"C".repeat(64)}`)).toBe(`0x${"c".repeat(64)}`);
  });

  it.each([
    ["63 hex characters", `0x${"c".repeat(63)}`],
    ["65 hex characters", `0x${"c".repeat(65)}`],
    ["an address-length value", hexAddress("c")],
    ["no 0x prefix", "c".repeat(64)],
    ["non-hex characters", `0x${"z".repeat(64)}`],
  ])("rejects %s", (_label, value) => {
    expect(Bytes32HexSchema.safeParse(value).success).toBe(false);
  });
});

describe("IsoTimestampSchema", () => {
  it("accepts exactly-millisecond UTC", () => {
    expect(IsoTimestampSchema.safeParse("2026-08-20T09:15:00.000Z").success).toBe(true);
  });

  it("accepts what Date.toISOString produces", () => {
    expect(IsoTimestampSchema.safeParse(new Date(0).toISOString()).success).toBe(true);
  });

  it.each([
    ["second precision", "2026-08-20T09:15:00Z"],
    ["microsecond precision", "2026-08-20T09:15:00.123456Z"],
    ["single-digit fraction", "2026-08-20T09:15:00.1Z"],
    ["a numeric UTC offset", "2026-08-20T12:15:00.000+03:00"],
    ["a lowercase zone marker", "2026-08-20T09:15:00.000z"],
    ["a space separator", "2026-08-20 09:15:00.000Z"],
    ["a date without a time", "2026-08-20"],
    ["a locale-formatted date", "20/08/2026 09:15"],
    ["an impossible day", "2026-02-30T09:15:00.000Z"],
    ["an impossible month", "2026-13-01T09:15:00.000Z"],
    ["an impossible hour", "2026-08-20T25:15:00.000Z"],
    ["an epoch number", 1755680100],
  ])("rejects %s", (_label, value) => {
    expect(IsoTimestampSchema.safeParse(value).success).toBe(false);
  });

  it("sorts lexicographically in the same order as chronologically", () => {
    const times = [
      "2026-08-20T09:15:01.000Z",
      "2026-01-01T00:00:00.000Z",
      "2026-08-20T09:15:00.000Z",
      "2026-08-20T09:15:00.999Z",
      "2025-12-31T23:59:59.999Z",
      "2026-08-20T09:15:00.123Z",
    ];
    for (const time of times) {
      expect(IsoTimestampSchema.safeParse(time).success).toBe(true);
    }

    expect([...times].sort()).toEqual([...times].sort((a, b) => Date.parse(a) - Date.parse(b)));
  });
});

describe("UnsignedIntegerStringSchema", () => {
  it("accepts a value far beyond Number.MAX_SAFE_INTEGER without rounding", () => {
    const huge = "340282366920938463463374607431768211456";
    expect(UnsignedIntegerStringSchema.parse(huge)).toBe(huge);
  });

  it("accepts zero", () => {
    expect(UnsignedIntegerStringSchema.safeParse("0").success).toBe(true);
  });

  it.each([
    ["leading zeros, which would give one value two spellings", "007"],
    ["a negative value", "-5"],
    ["a fractional value", "1.5"],
    ["hexadecimal notation", "0x10"],
    ["an empty string", ""],
    ["a JS number rather than a string", 10],
  ])("rejects %s", (_label, value) => {
    expect(UnsignedIntegerStringSchema.safeParse(value).success).toBe(false);
  });
});

describe("Uint128StringSchema", () => {
  it("accepts zero", () => {
    expect(Uint128StringSchema.safeParse("0").success).toBe(true);
  });

  it("accepts the largest uint128 and returns it unchanged as a string", () => {
    expect(Uint128StringSchema.parse(MAX_UINT128)).toBe(MAX_UINT128);
  });

  it("rejects one past the largest uint128", () => {
    expect(Uint128StringSchema.safeParse("340282366920938463463374607431768211456").success).toBe(
      false,
    );
  });

  it.each([
    ["leading zeros", "0123"],
    ["a negative value", "-1"],
    ["a fractional value", "1.5"],
    ["hexadecimal notation", "0x10"],
    ["an empty string", ""],
    ["a JS number", 5],
    ["letters", "abc"],
  ])("rejects %s", (_label, value) => {
    expect(Uint128StringSchema.safeParse(value).success).toBe(false);
  });

  // Zod runs every check on a string schema even after an earlier one fails, so
  // the width check sees input the canonical-form regex already rejected. It must
  // report that as a validation failure, never as a thrown BigInt conversion.
  it.each([["1.5"], ["abc"], ["-1"], [""], ["0x10"]])(
    "reports %s as invalid instead of throwing",
    (value) => {
      expect(() => Uint128StringSchema.safeParse(value)).not.toThrow();
    },
  );
});

describe("UsdAmountSchema", () => {
  it("accepts zero, because a source may genuinely report zero", () => {
    expect(UsdAmountSchema.parse(0)).toBe(0);
  });

  it("accepts a positive amount", () => {
    expect(UsdAmountSchema.safeParse(1234.56).success).toBe(true);
  });

  it.each([
    ["a negative amount", -0.01],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["a numeric string", "100"],
  ])("rejects %s", (_label, value) => {
    expect(UsdAmountSchema.safeParse(value).success).toBe(false);
  });
});

describe("PositivePriceSchema", () => {
  it("accepts a very small positive price", () => {
    expect(PositivePriceSchema.safeParse(1e-9).success).toBe(true);
  });

  it.each([
    ["zero, which is not a cheap asset but a malformed one", 0],
    ["a negative price", -1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("rejects %s", (_label, value) => {
    expect(PositivePriceSchema.safeParse(value).success).toBe(false);
  });
});
