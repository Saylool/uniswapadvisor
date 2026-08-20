import {
  type DataResult,
  type EvmAddress,
  EvmAddressSchema,
  type PoolMarketSnapshot,
  PoolMarketSnapshotSchema,
  TickSchema,
  Uint128StringSchema,
} from "../../schemas";
import {
  convertNonNegativeDecimal,
  convertSafeInteger,
  V3PoolQueryResponseSchema,
} from "./v3SubgraphRawResponse";

/** This adapter reads Ethereum mainnet only; multi-chain support is not modelled yet. */
export const ETHEREUM_MAINNET_CHAIN_ID = 1;

/** The largest instant a JS `Date` can represent, in milliseconds. */
const MAX_DATE_MS = 8.64e15;

/**
 * How far behind the chain a source block may be before its figures stop being
 * usable. Fifteen minutes is roughly 75 Ethereum blocks: long enough to ride out
 * ordinary indexer lag, short enough that a price or tick has not usually moved
 * to somewhere a liquidity decision would be made differently.
 */
export const MAX_SOURCE_LAG_MS = 15 * 60 * 1000;

/**
 * How far *ahead* of our own clock a source block may appear before the response
 * is treated as contradictory rather than merely skewed.
 *
 * A block cannot genuinely be mined in our future, so anything beyond a small
 * allowance for clock drift between this server and the indexer means one of the
 * two timestamps is wrong — and a negative lag would otherwise sail through the
 * staleness check untouched.
 */
export const MAX_SOURCE_CLOCK_SKEW_MS = 2 * 60 * 1000;

const MALFORMED = "The market data source returned a response this application cannot verify.";
const STALE =
  "The market data source is too far behind the chain for these figures to be treated as current.";
const FUTURE_BLOCK_TIME =
  "The market data source reported a block time ahead of this server's clock, so its figures cannot be verified.";
const INDEXING_ERRORS =
  "The market data source reported indexing errors, so its figures cannot be treated as verified.";
const NOT_FOUND = "No Uniswap v3 pool was found for this address on Ethereum mainnet.";

const unavailable = (
  reason: "invalid-response" | "not-found" | "stale-data",
  message: string,
): DataResult<PoolMarketSnapshot> => ({ status: "unavailable", reason, message });

/**
 * Rolling windows are not derivable from this query. The pool entity exposes a
 * lifetime cumulative `volumeUSD`, which is not a 24h/7d/30d figure, and treating
 * it as one would overstate recent activity by orders of magnitude. The fields
 * stay null and are declared missing instead.
 */
const ROLLING_VOLUME_WARNING =
  "Rolling 24h/7d/30d volume is not available from this data source yet; those fields are null rather than estimated.";

/**
 * Raised when the source reports no block time. Silence would let an unverifiable
 * snapshot read exactly like a verified-fresh one, and `fetchedAt` must never be
 * substituted for the missing value — it records when we asked, not what the
 * answer describes.
 */
const FRESHNESS_UNVERIFIED_WARNING =
  "The data source did not report a block time, so how current these figures are could not be verified.";

/**
 * Fields that may legitimately be null in a snapshot built from this source,
 * listed in the order the domain schema declares them.
 *
 * Iterating a fixed list is what makes `missingFields` deterministic: the same
 * response always produces the same array, in the same order, regardless of key
 * insertion or iteration order elsewhere.
 */
const NULLABLE_SNAPSHOT_FIELDS = [
  "sourceBlockNumber",
  "sourceBlockTimestamp",
  "volume24hUsd",
  "volume7dUsd",
  "volume30dUsd",
  "tick",
] as const satisfies readonly (keyof PoolMarketSnapshot & string)[];

/** Converts a Unix second count to fixed-millisecond UTC, or null if unrepresentable. */
const unixSecondsToIso = (seconds: number): string | null => {
  const milliseconds = seconds * 1000;
  if (!Number.isFinite(milliseconds) || Math.abs(milliseconds) > MAX_DATE_MS) return null;
  return new Date(milliseconds).toISOString();
};

export type NormalizeV3PoolSnapshotInput = {
  /** The decoded JSON body, still untrusted. */
  readonly payload: unknown;
  /** The caller's pool address, already validated and lower-cased. */
  readonly poolAddress: EvmAddress;
  /** When the response arrived, from an injected clock. */
  readonly fetchedAt: string;
};

/**
 * Turns one raw subgraph payload into a domain snapshot, or into an explicit
 * failure. Pure: no clock, no network, no environment — the same input always
 * produces the same result.
 */
export const normalizeV3PoolSnapshot = ({
  payload,
  poolAddress,
  fetchedAt,
}: NormalizeV3PoolSnapshotInput): DataResult<PoolMarketSnapshot> => {
  const parsed = V3PoolQueryResponseSchema.safeParse(payload);
  if (!parsed.success) return unavailable("invalid-response", MALFORMED);

  const { data, errors } = parsed.data;

  // Fail closed. A GraphQL response may carry partial data alongside errors; that
  // data is not verified, and this application does not present unverified figures.
  if (errors != null && errors.length > 0) {
    return unavailable("invalid-response", MALFORMED);
  }
  if (data == null) {
    return unavailable("invalid-response", MALFORMED);
  }
  if (data._meta?.hasIndexingErrors === true) {
    return unavailable("invalid-response", INDEXING_ERRORS);
  }
  if (data.pool === null) {
    return unavailable("not-found", NOT_FOUND);
  }

  const pool = data.pool;

  // The provider echoes the pool id it matched. A mismatch means the response
  // describes a different pool than the one asked about.
  const returnedId = EvmAddressSchema.safeParse(pool.id);
  if (!returnedId.success || returnedId.data !== poolAddress) {
    return unavailable("invalid-response", MALFORMED);
  }

  /*
   * The provider's price field names use the opposite perspective from ours:
   *
   *   subgraph token0Price = how much token0 one token1 buys -> token1PriceInToken0
   *   subgraph token1Price = how much token1 one token0 buys -> token0PriceInToken1
   *
   * Reversing this would invert every price the advisor reports while still
   * satisfying the domain schema's reciprocal check, so the mapping is spelled out
   * here and pinned by its own test.
   */
  const token1PriceInToken0 = convertNonNegativeDecimal(pool.token0Price, { allowZero: false });
  const token0PriceInToken1 = convertNonNegativeDecimal(pool.token1Price, { allowZero: false });
  // TVL of exactly zero is a real state for an empty pool, unlike a zero price.
  const tvlUsd = convertNonNegativeDecimal(pool.totalValueLockedUSD, { allowZero: true });

  if (!token1PriceInToken0.ok || !token0PriceInToken1.ok || !tvlUsd.ok) {
    return unavailable("invalid-response", MALFORMED);
  }

  const liquidity = Uint128StringSchema.safeParse(pool.liquidity);
  if (!liquidity.success) {
    return unavailable("invalid-response", MALFORMED);
  }

  let tick: number | null = null;
  if (pool.tick !== null) {
    const rawTick = convertSafeInteger(pool.tick);
    if (!rawTick.ok) return unavailable("invalid-response", MALFORMED);

    const validTick = TickSchema.safeParse(rawTick.value);
    if (!validTick.success) {
      return unavailable("invalid-response", MALFORMED);
    }
    tick = validTick.data;
  }

  const meta = data._meta;
  let sourceBlockTimestamp: string | null = null;
  if (meta != null && meta.block.timestamp !== null) {
    sourceBlockTimestamp = unixSecondsToIso(meta.block.timestamp);
    if (sourceBlockTimestamp === null) {
      return unavailable("invalid-response", MALFORMED);
    }
  }

  const candidate = {
    pool: {
      protocolVersion: "v3",
      chainId: ETHEREUM_MAINNET_CHAIN_ID,
      id: poolAddress,
    },
    fetchedAt,
    // Block numbers are exact on-chain integers, so they are carried as canonical
    // decimal strings rather than parsed into a JS number.
    sourceBlockNumber: meta == null ? null : String(meta.block.number),
    sourceBlockTimestamp,
    token0PriceInToken1: token0PriceInToken1.value,
    token1PriceInToken0: token1PriceInToken0.value,
    tvlUsd: tvlUsd.value,
    volume24hUsd: null,
    volume7dUsd: null,
    volume30dUsd: null,
    tick,
    liquidity: liquidity.data,
    source: "uniswap-v3-subgraph",
  };

  // The domain schema is the final authority. If normalization produced anything
  // it refuses — a non-canonical timestamp, prices that are not reciprocal — the
  // response is reported as unverifiable rather than published.
  const snapshot = PoolMarketSnapshotSchema.safeParse(candidate);
  if (!snapshot.success) {
    return unavailable("invalid-response", MALFORMED);
  }

  /*
   * Freshness is judged here, at the normalization boundary, because it is the one
   * place holding both clocks: `fetchedAt` from the injected clock and the source
   * block time from the response. Both have already passed the domain schema, so
   * both parse to finite instants.
   *
   * Preserving a timestamp nobody checks is how stale figures reach a caller
   * looking verified, so the check is a gate rather than a warning.
   */
  const blockTime = snapshot.data.sourceBlockTimestamp;
  if (blockTime !== null) {
    const lagMs = Date.parse(snapshot.data.fetchedAt) - Date.parse(blockTime);
    if (lagMs > MAX_SOURCE_LAG_MS) return unavailable("stale-data", STALE);
    if (lagMs < -MAX_SOURCE_CLOCK_SKEW_MS) {
      return unavailable("invalid-response", FUTURE_BLOCK_TIME);
    }
  }

  const missing = NULLABLE_SNAPSHOT_FIELDS.filter((field) => snapshot.data[field] === null);
  const [firstMissing, ...remainingMissing] = missing;
  if (firstMissing === undefined) {
    // Unreachable while the three rolling-volume fields are always null, but the
    // contract is honoured rather than asserted away.
    return { status: "success", data: snapshot.data };
  }

  // Built in a fixed order from a fixed set, so the same response always yields
  // the same warnings in the same positions.
  const warnings =
    blockTime === null
      ? [ROLLING_VOLUME_WARNING, FRESHNESS_UNVERIFIED_WARNING]
      : [ROLLING_VOLUME_WARNING];

  return {
    status: "partial",
    data: snapshot.data,
    missingFields: [firstMissing, ...remainingMissing],
    warnings,
  };
};
