import { z } from "zod";

/*
 * The untrusted edge of the pool-metadata query. Provider field names stop here.
 *
 * Non-strict objects, as with the other subgraph boundaries: a provider adding a
 * field must not break the read, so unknown keys are dropped rather than rejected.
 */

/**
 * A `Token` entity, narrowed to identity.
 *
 * `decimals` is `BigInt!` in the official schema, so it arrives as a *string*
 * rather than a JSON number — the same for `feeTier` below. Declaring them as
 * strings up front is what stops a silent coercion from papering over a provider
 * that changed representation.
 */
const RawTokenSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  name: z.string(),
  decimals: z.string(),
});

const RawPoolSchema = z.object({
  id: z.string(),
  /** `BigInt!`, in hundredths of a basis point. 3000 means 0.30%. */
  feeTier: z.string(),
  token0: RawTokenSchema,
  token1: RawTokenSchema,
});

/**
 * Only the indexing-error flag is read from `_meta`.
 *
 * The other adapters also take the block number and time because their figures
 * change and staleness matters. A pool's tokens and fee tier are fixed at
 * deployment, so how far behind the indexer is says nothing about whether this
 * answer is correct — asking for a block position we would never use would just
 * invite the question of why it is there.
 */
const RawMetaSchema = z.object({
  hasIndexingErrors: z.boolean(),
});

export const V3PoolMetadataResponseSchema = z.object({
  data: z
    .object({
      pool: RawPoolSchema.nullable(),
      _meta: RawMetaSchema.nullable(),
    })
    .nullish(),
  /** Read only for presence; provider error text is never inspected or forwarded. */
  errors: z.array(z.unknown()).nullish(),
});

export type V3PoolMetadataResponse = z.infer<typeof V3PoolMetadataResponseSchema>;
