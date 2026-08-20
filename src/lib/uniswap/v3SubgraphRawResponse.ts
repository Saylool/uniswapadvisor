import { z } from "zod";

/*
 * The untrusted edge of the Uniswap v3 subgraph integration.
 *
 * Everything here describes the provider's wire format, not our domain. These
 * types are deliberately not exported beyond the adapter that consumes them, so
 * a subgraph field name can never reach a component, an analytics function or a
 * prompt.
 *
 * Objects are non-strict on purpose: this is the one place where extra fields are
 * expected. A provider adding a field must not break the read, so unknown keys are
 * dropped rather than rejected — the opposite of the domain schemas, which are
 * strict because we build those values ourselves.
 */

/**
 * A base-10 decimal as The Graph serializes `BigDecimal`. The optional exponent
 * is accepted because very large and very small values can be rendered that way.
 * Nothing looser is allowed — a boolean or a number would be rejected before this
 * pattern is ever applied, since the field is declared as a string.
 */
const DECIMAL_STRING_PATTERN = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** A base-10 integer as The Graph serializes `BigInt`. */
const INTEGER_STRING_PATTERN = /^-?\d+$/;

/**
 * True when a decimal string denotes exactly zero, whatever its spelling —
 * `0`, `0.0`, `-0.000`, `0e9`.
 *
 * Used to tell a reported zero apart from a value so small that `Number()`
 * flushes it to zero. The first is a fact; the second is silent data loss.
 */
const denotesZero = (decimal: string): boolean => {
  const mantissa = decimal.split(/[eE]/)[0] ?? decimal;
  const digits = mantissa.replace(/^[+-]/, "").replace(".", "");
  return digits.length > 0 && !/[1-9]/.test(digits);
};

export type DecimalConversion =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false };

/**
 * Converts a provider decimal string into a JS number, refusing every way the
 * conversion could lie.
 *
 * Rejects malformed text, `NaN`, and `±Infinity` (which is what an overflowing
 * magnitude becomes), negatives, and — when `allowZero` is false — a legitimate
 * zero. It also rejects underflow: a non-zero decimal that `Number()` rounds down
 * to `0` would otherwise be published as a verified zero TVL or price.
 */
export const convertNonNegativeDecimal = (
  raw: string,
  { allowZero }: { allowZero: boolean },
): DecimalConversion => {
  if (!DECIMAL_STRING_PATTERN.test(raw)) return { ok: false };

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return { ok: false };

  if (value === 0) {
    if (!denotesZero(raw)) return { ok: false };
    if (!allowZero) return { ok: false };
  }

  return { ok: true, value };
};

export type IntegerConversion =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false };

/** Converts a provider `BigInt` string into a safe JS integer, or fails. */
export const convertSafeInteger = (raw: string): IntegerConversion => {
  if (!INTEGER_STRING_PATTERN.test(raw)) return { ok: false };

  const value = Number(raw);
  return Number.isSafeInteger(value) ? { ok: true, value } : { ok: false };
};

/**
 * `_Block_.number` and `_Block_.timestamp` are GraphQL `Int`, so they arrive as
 * JSON numbers rather than strings. `z.int()` rejects non-integers, non-finite
 * values and unrelated types such as booleans without coercing anything.
 */
const RawBlockSchema = z.object({
  number: z.int().min(0),
  timestamp: z.int().min(0).nullable(),
});

const RawMetaSchema = z.object({
  block: RawBlockSchema,
  hasIndexingErrors: z.boolean(),
});

/** The `Pool` fields this snapshot needs. Values arrive as strings. */
const RawPoolSchema = z.object({
  id: z.string(),
  /** Provider perspective: token0 per token1. Maps to `token1PriceInToken0`. */
  token0Price: z.string(),
  /** Provider perspective: token1 per token0. Maps to `token0PriceInToken1`. */
  token1Price: z.string(),
  totalValueLockedUSD: z.string(),
  liquidity: z.string(),
  tick: z.string().nullable(),
});

/**
 * A GraphQL envelope. `errors` is read only for its presence — provider error
 * text is never inspected or forwarded, so it is typed as opaque.
 */
export const V3PoolQueryResponseSchema = z.object({
  data: z
    .object({
      pool: RawPoolSchema.nullable(),
      _meta: RawMetaSchema.nullable(),
    })
    .nullish(),
  errors: z.array(z.unknown()).nullish(),
});

export type V3PoolQueryResponse = z.infer<typeof V3PoolQueryResponseSchema>;
