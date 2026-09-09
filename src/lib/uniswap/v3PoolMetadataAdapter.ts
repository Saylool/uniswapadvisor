import {
  type DataResult,
  type EvmAddress,
  EvmAddressSchema,
  type V3PoolMetadata,
  V3PoolMetadataSchema,
} from "../../schemas";
import { V3PoolMetadataResponseSchema } from "./v3PoolMetadataRawResponse";
import { convertSafeInteger } from "./v3SubgraphRawResponse";

/** This adapter reads Ethereum mainnet only; multi-chain support is not modelled yet. */
export const ETHEREUM_MAINNET_CHAIN_ID = 1;

const MALFORMED = "The market data source returned a response this application cannot verify.";
const INDEXING_ERRORS =
  "The market data source reported indexing errors, so its figures cannot be treated as verified.";
const NOT_FOUND = "No Uniswap v3 pool was found for this address on Ethereum mainnet.";

const unavailable = (
  reason: "invalid-response" | "not-found",
  message: string,
): DataResult<V3PoolMetadata> => ({ status: "unavailable", reason, message });

type RawToken = {
  readonly id: string;
  readonly symbol: string;
  readonly name: string;
  readonly decimals: string;
};

type NormalizedToken = {
  readonly chainId: number;
  readonly address: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly name?: string;
};

/**
 * Turns one raw `Token` entity into the domain shape, or `null` if it cannot be
 * trusted.
 *
 * `name` is dropped when the provider reports an empty string. The domain treats
 * a name as optional, and an empty string is not a name — carrying it through
 * would turn "this token has no name on-chain" into a token literally called "".
 * `symbol` gets no such leniency: it is required, so an empty one fails the
 * schema and the whole response with it.
 */
const normalizeToken = (raw: RawToken): NormalizedToken | null => {
  const decimals = convertSafeInteger(raw.decimals);
  if (!decimals.ok) return null;

  const address = EvmAddressSchema.safeParse(raw.id);
  if (!address.success) return null;

  return {
    chainId: ETHEREUM_MAINNET_CHAIN_ID,
    address: address.data,
    symbol: raw.symbol,
    decimals: decimals.value,
    ...(raw.name === "" ? {} : { name: raw.name }),
  };
};

export type NormalizeV3PoolMetadataInput = {
  /** The decoded JSON body, still untrusted. */
  readonly payload: unknown;
  /** The caller's pool address, already validated and lower-cased. */
  readonly poolAddress: EvmAddress;
};

/**
 * Turns one raw pool-metadata payload into the domain type, or into an explicit
 * failure. Pure: no clock, no network, no environment.
 *
 * There is no `partial` outcome. Every field here is required for the metadata to
 * mean anything — a pool with unknown token decimals cannot be used for price
 * work at all — so the result is either complete or unavailable.
 *
 * No freshness gate either, unlike the snapshot and history readers. Those gate
 * on staleness because their values move; a pool's tokens and fee tier are fixed
 * at deployment, so a reading taken from a lagging indexer is exactly as correct
 * as a fresh one. Rejecting it would discard good data for no gain.
 */
export const normalizeV3PoolMetadata = ({
  payload,
  poolAddress,
}: NormalizeV3PoolMetadataInput): DataResult<V3PoolMetadata> => {
  const parsed = V3PoolMetadataResponseSchema.safeParse(payload);
  if (!parsed.success) return unavailable("invalid-response", MALFORMED);

  const { data, errors } = parsed.data;

  // Fail closed: a GraphQL response may carry data beside errors, and that data
  // is not verified.
  if (errors != null && errors.length > 0) return unavailable("invalid-response", MALFORMED);
  if (data == null) return unavailable("invalid-response", MALFORMED);
  if (data._meta?.hasIndexingErrors === true) {
    return unavailable("invalid-response", INDEXING_ERRORS);
  }
  if (data.pool === null) return unavailable("not-found", NOT_FOUND);

  // The provider echoes the pool id it matched; a mismatch means the response
  // describes a different pool than the one asked about.
  const returnedId = EvmAddressSchema.safeParse(data.pool.id);
  if (!returnedId.success || returnedId.data !== poolAddress) {
    return unavailable("invalid-response", MALFORMED);
  }

  const feePpm = convertSafeInteger(data.pool.feeTier);
  if (!feePpm.ok) return unavailable("invalid-response", MALFORMED);

  const token0 = normalizeToken(data.pool.token0);
  const token1 = normalizeToken(data.pool.token1);
  if (token0 === null || token1 === null) return unavailable("invalid-response", MALFORMED);

  const candidate = {
    protocolVersion: "v3",
    chainId: ETHEREUM_MAINNET_CHAIN_ID,
    id: poolAddress,
    token0,
    token1,
    feePpm: feePpm.value,
  };

  /*
   * The domain schema is the final authority. It re-checks the fee bound, the
   * uint8 decimals range, the non-zero token addresses, and — the reason this
   * adapter exists — that token0 sorts before token1. A provider returning the
   * pair the wrong way round would otherwise invert every price derived from
   * these decimals, silently.
   */
  const metadata = V3PoolMetadataSchema.safeParse(candidate);
  if (!metadata.success) return unavailable("invalid-response", MALFORMED);

  return { status: "success", data: metadata.data };
};
