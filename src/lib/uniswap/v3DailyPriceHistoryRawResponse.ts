import { z } from "zod";

import { RawMetaSchema } from "./v3SubgraphRawResponse";

/*
 * The untrusted edge of the daily-history query. Provider field names stop here;
 * nothing below is re-exported into the domain.
 *
 * Non-strict objects, as with the snapshot boundary: a provider adding a field
 * must not break the read, so unknown keys are dropped rather than rejected.
 */

/**
 * One `PoolDayData` row, narrowed to the fields this series needs.
 *
 * `date` is `Int!` in the official schema — a Unix second count already rounded
 * to the start of its UTC day — so it arrives as a JSON number. `token1Price` is
 * `BigDecimal!` and arrives as a string. Declaring the expected JSON types up
 * front is what keeps a boolean or a number from being coerced into a price.
 */
const RawPoolDayDataSchema = z.object({
  id: z.string(),
  date: z.int().min(0),
  /** Provider perspective: token1 per token0. Becomes `token0PriceInToken1`. */
  token1Price: z.string(),
  /**
   * Required, not optional. Each row states which pool it belongs to so ownership
   * can be proved per row rather than inferred from the query's filter, from the
   * row's opaque `id`, or from the separate top-level `pool` field. `Pool!` is
   * non-null in the schema, so a row without it is a malformed response.
   */
  pool: z.object({ id: z.string() }),
});

/** Only the pool's identity is requested; its metadata is not part of a series. */
const RawPoolIdentitySchema = z.object({
  id: z.string(),
});

export const V3DailyPriceHistoryResponseSchema = z.object({
  data: z
    .object({
      /**
       * Present even though only `id` is read: it is what separates "this pool
       * does not exist" from "this pool exists but has no indexed days".
       */
      pool: RawPoolIdentitySchema.nullable(),
      poolDayDatas: z.array(RawPoolDayDataSchema),
      _meta: RawMetaSchema.nullable(),
    })
    .nullish(),
  /** Read only for presence; provider error text is never inspected or forwarded. */
  errors: z.array(z.unknown()).nullish(),
});

export type V3DailyPriceHistoryResponse = z.infer<typeof V3DailyPriceHistoryResponseSchema>;
