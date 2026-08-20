import { z } from "zod";

/**
 * The all-zero address. On-chain this doubles as "no contract here", so the
 * domain model must translate it into an explicit absence rather than carrying
 * it around as if it were a real address.
 */
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * An EVM account or contract address.
 *
 * Structural validation only: `0x` followed by exactly 40 hex characters.
 * EIP-55 checksum casing is **not** verified — a mixed-case address whose
 * checksum is wrong still passes. Values are lower-cased so the same address
 * reported with different casing by two sources compares and keys as equal.
 */
export const EvmAddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, {
    error: "Must be 0x followed by exactly 40 hexadecimal characters.",
  })
  .transform((address) => address.toLowerCase());

export type EvmAddress = z.infer<typeof EvmAddressSchema>;

/**
 * An address that is structurally valid *and* not the zero address.
 *
 * On-chain, `address(0)` is overloaded: depending on the field it means "no
 * contract", "no hook", or (in Uniswap v4) the chain's native currency. Callers
 * pass the message that explains which meaning applies, so a rejected value tells
 * the reader what should have been used instead.
 */
export const nonZeroEvmAddress = (error: string) =>
  EvmAddressSchema.refine((address) => address !== ZERO_ADDRESS, { error });

/**
 * A 32-byte hash rendered as hex. Uniswap v4 identifies a pool by the keccak256
 * of its PoolKey rather than by a contract address, because every v4 pool lives
 * inside the singleton PoolManager.
 */
export const Bytes32HexSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, {
    error: "Must be 0x followed by exactly 64 hexadecimal characters.",
  })
  .transform((value) => value.toLowerCase());

export type Bytes32Hex = z.infer<typeof Bytes32HexSchema>;

/**
 * An instant as an ISO-8601 UTC string with *exactly* millisecond precision:
 * `YYYY-MM-DDTHH:MM:SS.sssZ`, e.g. `2026-08-20T09:15:00.000Z`.
 *
 * Numeric offsets, locale formats, and any other fractional-second precision are
 * rejected. Fixing the width is what makes lexicographic order agree with
 * chronological order — allowing both `…:00Z` and `…:00.123Z` would not, since
 * `"Z"` sorts after `"."`, placing the earlier instant second.
 *
 * `new Date(…).toISOString()` emits precisely this format, so producing a valid
 * value needs no formatting helper.
 */
export const IsoTimestampSchema = z.iso.datetime({ precision: 3 });

export type IsoTimestamp = z.infer<typeof IsoTimestampSchema>;

/**
 * An exact non-negative on-chain integer (uint128 / uint160 / uint256) carried
 * as a base-10 string.
 *
 * These values routinely exceed `Number.MAX_SAFE_INTEGER`, so parsing them into
 * a JS `number` would silently round. Leading zeros are rejected so each value
 * has exactly one canonical spelling and string equality is meaningful.
 */
export const UnsignedIntegerStringSchema = z.string().regex(/^(0|[1-9][0-9]*)$/, {
  error: "Must be a base-10 non-negative integer string with no leading zeros.",
});

export type UnsignedIntegerString = z.infer<typeof UnsignedIntegerStringSchema>;

/**
 * The largest value a uint128 can hold, `2^128 - 1`.
 *
 * A `bigint` because the literal is far past `Number.MAX_SAFE_INTEGER`; comparing
 * against it must never round.
 */
const MAX_UINT128 = (1n << 128n) - 1n;

/**
 * An exact uint128 carried as a base-10 string — the width Uniswap uses for a
 * pool's liquidity (`L`).
 *
 * Builds on {@link UnsignedIntegerStringSchema} for canonical spelling and adds
 * the width bound, so a value too large to have come from a uint128 slot is
 * rejected rather than quietly accepted as "some big number". The comparison goes
 * through `BigInt`, which parses the decimal string exactly; the parsed value is
 * discarded and the schema's output stays the original string, so nothing is ever
 * narrowed to a JS `number`.
 */
export const Uint128StringSchema = UnsignedIntegerStringSchema.refine(
  // Zod runs every check on a string schema even after an earlier one has failed,
  // so this predicate still sees input the canonical-form regex just rejected.
  // `BigInt("1.5")` throws, and a throw would escape `safeParse` as a crash
  // instead of a validation error — hence the digit guard before converting.
  (value) => /^[0-9]+$/.test(value) && BigInt(value) <= MAX_UINT128,
  { error: "Must fit in a uint128 (at most 2^128 - 1)." },
);

export type Uint128String = z.infer<typeof Uint128StringSchema>;

/** EVM chain identifier (1 = Ethereum mainnet). Never zero or negative. */
export const ChainIdSchema = z.int().positive();

export type ChainId = z.infer<typeof ChainIdSchema>;

/**
 * A USD-denominated analytics figure such as TVL or traded volume.
 *
 * `z.number()` already rejects `NaN` and `±Infinity`, so this is finite and
 * non-negative. Absence of a figure is *not* representable here — callers use
 * `null` at the field level so that "unknown" never collapses into `0`.
 */
export const UsdAmountSchema = z.number().nonnegative();

export type UsdAmount = z.infer<typeof UsdAmountSchema>;

/**
 * An exchange rate between two tokens. Strictly greater than zero: a zero or
 * negative price is malformed input, not a cheap asset.
 */
export const PositivePriceSchema = z.number().positive();

export type PositivePrice = z.infer<typeof PositivePriceSchema>;
