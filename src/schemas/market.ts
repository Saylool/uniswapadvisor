import { z } from "zod";

import { type DataSource, DataSourceSchema } from "./dataSource";
import {
  IsoTimestampSchema,
  PositivePriceSchema,
  Uint128StringSchema,
  UnsignedIntegerStringSchema,
  UsdAmountSchema,
} from "./primitives";
import { PoolReferenceSchema, type ProtocolVersion, TickSchema } from "./uniswap";

/**
 * Verified pool metrics, together with when they were retrieved and when they
 * were actually true on-chain.
 *
 * Two clocks, kept apart on purpose. `fetchedAt` says when *we* asked; the
 * `sourceBlock*` fields say what the answer describes. An indexer that has fallen
 * an hour behind still answers instantly, so a single "observed at" field would
 * make stale figures look fresh — and staleness is exactly what decides whether a
 * liquidity range is still sensible.
 *
 * Every metric is required-but-nullable rather than optional. That forces the
 * normalizer building a snapshot to make an explicit decision about each field: a
 * source that does not report a metric yields `null`, and `null` never means
 * zero. A source that genuinely reports zero yields `0`. Collapsing the two would
 * let the advisor reason about a pool as though it were empty or untraded when the
 * truth is simply that nobody told us.
 *
 * Unrefined and private: the cross-field rules are layered on below, and
 * `PoolMarketSnapshotSchema` is the only exported way in.
 */
const PoolMarketSnapshotObject = z.strictObject({
  pool: PoolReferenceSchema,

  /**
   * When this application received the response.
   *
   * A transport fact, never a freshness signal: it must not be copied into the
   * source-block fields when a provider omits them.
   */
  fetchedAt: IsoTimestampSchema,
  /**
   * The block the source had indexed up to, as an exact integer string — block
   * numbers are unbounded on-chain integers, so they are not parsed into
   * `number`. `null` when the provider does not report its indexing position.
   */
  sourceBlockNumber: UnsignedIntegerStringSchema.nullable(),
  /**
   * That block's timestamp: the instant these metrics were true. `null` when the
   * provider reports no block time. Compare against `fetchedAt` to measure lag.
   */
  sourceBlockTimestamp: IsoTimestampSchema.nullable(),

  /** How much token1 one whole token0 buys. Null when the source omits it. */
  token0PriceInToken1: PositivePriceSchema.nullable(),
  /** How much token0 one whole token1 buys — the reciprocal direction. */
  token1PriceInToken0: PositivePriceSchema.nullable(),

  tvlUsd: UsdAmountSchema.nullable(),
  volume24hUsd: UsdAmountSchema.nullable(),
  volume7dUsd: UsdAmountSchema.nullable(),
  volume30dUsd: UsdAmountSchema.nullable(),

  /** The pool's current tick, i.e. where the spot price sits on the tick grid. */
  tick: TickSchema.nullable(),
  /**
   * Raw in-range liquidity, kept as an exact decimal string. This is the
   * protocol's L value, not a USD amount and not a token amount, and it is stored
   * on-chain in a uint128 slot — so the schema bounds it to that width rather
   * than accepting any large integer.
   */
  liquidity: Uint128StringSchema.nullable(),

  source: DataSourceSchema,
});

/**
 * How far the product of two reciprocal prices may drift from 1 before the pair
 * is treated as contradictory.
 *
 * Both figures are float64 renderings of high-precision on-chain decimals, so a
 * genuine pair lands within a few ulps — relative error around 1e-15. 1e-6 sits
 * nine orders of magnitude above that, which tolerates a source that publishes
 * prices rounded to a handful of significant digits while still catching a real
 * inversion: reporting 2 and 2 gives a product of 4.
 */
export const RECIPROCAL_PRICE_TOLERANCE = 1e-6;

/**
 * Which sources may legitimately report market metrics for a pool.
 *
 * A v3 subgraph cannot describe a v4 pool or vice versa, and `hook-registry`
 * publishes hook metadata rather than pool metrics. {@link DataSourceSchema}
 * stays permissive because the registry is a valid source for other domain
 * models; the restriction belongs here, where the contradiction is possible.
 */
const SOURCES_BY_PROTOCOL: Record<ProtocolVersion, readonly DataSource[]> = {
  v3: ["uniswap-v3-subgraph", "derived-analytics"],
  v4: ["uniswap-v4-subgraph", "derived-analytics"],
};

/**
 * Verified against multiplication rather than division: both values are already
 * finite and strictly positive, so `p0 * p1` cannot divide by zero, and an
 * overflow to `Infinity` fails the comparison instead of throwing.
 *
 * Only checked when both directions are known — a missing reciprocal stays
 * missing, and is never computed here to fill the gap.
 */
const reciprocalPricesAgree = (snapshot: {
  readonly token0PriceInToken1: number | null;
  readonly token1PriceInToken0: number | null;
}): boolean => {
  const { token0PriceInToken1: forward, token1PriceInToken0: reverse } = snapshot;
  if (forward === null || reverse === null) return true;

  return Math.abs(forward * reverse - 1) <= RECIPROCAL_PRICE_TOLERANCE;
};

const sourceMatchesProtocol = (snapshot: {
  readonly pool: { readonly protocolVersion: ProtocolVersion };
  readonly source: DataSource;
}): boolean => SOURCES_BY_PROTOCOL[snapshot.pool.protocolVersion].includes(snapshot.source);

export const PoolMarketSnapshotSchema = PoolMarketSnapshotObject.refine(reciprocalPricesAgree, {
  error:
    "token0PriceInToken1 and token1PriceInToken0 must be reciprocals: their product must be 1 within tolerance.",
  path: ["token1PriceInToken0"],
}).refine(sourceMatchesProtocol, {
  error: "This data source cannot report market metrics for this pool's protocol version.",
  path: ["source"],
});

export type PoolMarketSnapshot = z.infer<typeof PoolMarketSnapshotSchema>;

/**
 * One point on a price series, later fed into deterministic volatility and range
 * calculations.
 *
 * `timestamp` is source time — when the price held — not when the series was
 * downloaded. Neither field is nullable: an observation missing its price or its
 * time is not an observation, and dropping it is the normalizer's job rather than
 * something downstream maths should have to filter.
 */
export const HistoricalPricePointSchema = z.strictObject({
  timestamp: IsoTimestampSchema,
  /** Direction is fixed by whoever assembled the series; state it alongside. */
  price: PositivePriceSchema,
});

export type HistoricalPricePoint = z.infer<typeof HistoricalPricePointSchema>;
