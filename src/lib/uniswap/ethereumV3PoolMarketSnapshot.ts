import { type DataResult, nonZeroEvmAddress, type PoolMarketSnapshot } from "../../schemas";
import { normalizeV3PoolSnapshot } from "./v3PoolSnapshotAdapter";
import {
  DEFAULT_SUBGRAPH_TIMEOUT_MS,
  type FetchLike,
  postV3SubgraphQuery,
} from "./v3SubgraphTransport";

/**
 * The pool address travels as a GraphQL variable, never spliced into this string.
 * Interpolating caller input into a query is how injection and cache-key bugs
 * start, and it would also put the address in a position where escaping matters.
 *
 * Only the fields a snapshot needs are requested. Notably absent is `volumeUSD`:
 * it is a lifetime cumulative total, and no rolling window can be derived from it
 * in a single reading.
 */
export const V3_POOL_SNAPSHOT_QUERY = `query PoolMarketSnapshot($poolId: ID!) {
  pool(id: $poolId) {
    id
    token0Price
    token1Price
    totalValueLockedUSD
    liquidity
    tick
  }
  _meta {
    block {
      number
      timestamp
    }
    hasIndexingErrors
  }
}`;

const INVALID_ADDRESS =
  "The pool address must be 0x followed by 40 hexadecimal characters, and cannot be the zero address.";

/**
 * A pool address the caller supplied.
 *
 * The zero address is refused alongside malformed input: no Uniswap v3 pool is
 * ever deployed there, so it means a caller dropped a value rather than that the
 * pool is missing. Reusing the shared primitive keeps the one definition of
 * "not the zero address" in the schema layer.
 */
const PoolAddressSchema = nonZeroEvmAddress(INVALID_ADDRESS);
const NOT_CONFIGURED =
  "Uniswap v3 market data is not configured on this server. Set THE_GRAPH_API_KEY and UNISWAP_V3_ETHEREUM_SUBGRAPH_ID.";

export type EthereumV3PoolSnapshotRequest = {
  readonly poolAddress: string;
  /** Raw environment values; validated here so the wrapper stays free of logic. */
  readonly apiKey: string | undefined;
  readonly subgraphId: string | undefined;
  readonly fetchImpl: FetchLike;
  /** Injected clock. Its instant becomes `fetchedAt`. */
  readonly now: () => Date;
  readonly timeoutMs?: number;
};

/**
 * Reads one Ethereum mainnet Uniswap v3 pool and returns it as a domain snapshot.
 *
 * Every decision lives here rather than in the server-only wrapper, so the whole
 * flow — validation order, transport, normalization — is testable with an injected
 * fetch and clock and no environment at all.
 *
 * Caller input is checked before configuration: a malformed or zero address is the
 * caller's problem whatever the server's settings, and reporting it as a
 * configuration fault would send someone to inspect the wrong thing. Neither check
 * reaches the network.
 */
export const fetchEthereumV3PoolMarketSnapshot = async (
  request: EthereumV3PoolSnapshotRequest,
): Promise<DataResult<PoolMarketSnapshot>> => {
  const address = PoolAddressSchema.safeParse(request.poolAddress);
  if (!address.success) {
    return { status: "unavailable", reason: "invalid-input", message: INVALID_ADDRESS };
  }

  const apiKey = request.apiKey?.trim();
  const subgraphId = request.subgraphId?.trim();
  if (apiKey === undefined || apiKey === "" || subgraphId === undefined || subgraphId === "") {
    return { status: "unavailable", reason: "configuration-error", message: NOT_CONFIGURED };
  }

  const transport = await postV3SubgraphQuery({
    apiKey,
    subgraphId,
    query: V3_POOL_SNAPSHOT_QUERY,
    variables: { poolId: address.data },
    fetchImpl: request.fetchImpl,
    timeoutMs: request.timeoutMs ?? DEFAULT_SUBGRAPH_TIMEOUT_MS,
  });

  if (!transport.ok) {
    return { status: "unavailable", reason: transport.reason, message: transport.message };
  }

  return normalizeV3PoolSnapshot({
    payload: transport.payload,
    poolAddress: address.data,
    fetchedAt: request.now().toISOString(),
  });
};
