import { type DataResult, nonZeroEvmAddress, type V3PoolMetadata } from "../../schemas";
import { normalizeV3PoolMetadata } from "./v3PoolMetadataAdapter";
import {
  DEFAULT_SUBGRAPH_TIMEOUT_MS,
  type FetchLike,
  postV3SubgraphQuery,
} from "./v3SubgraphTransport";

/**
 * Reads a pool's immutable configuration.
 *
 * Only one variable is needed: unlike the history query there is no
 * entity-reference filter, so the singular lookup's `ID!` is the whole story. The
 * address still travels as a variable rather than spliced into the text.
 *
 * `feeTier` and `decimals` are `BigInt!` in the official schema and arrive as
 * strings. Notably absent is `tickSpacing`, which no Uniswap subgraph exposes.
 */
export const V3_POOL_METADATA_QUERY = `query PoolMetadata($poolId: ID!) {
  pool(id: $poolId) {
    id
    feeTier
    token0 {
      id
      symbol
      name
      decimals
    }
    token1 {
      id
      symbol
      name
      decimals
    }
  }
  _meta {
    hasIndexingErrors
  }
}`;

const INVALID_ADDRESS =
  "The pool address must be 0x followed by 40 hexadecimal characters, and cannot be the zero address.";
const NOT_CONFIGURED =
  "Uniswap v3 market data is not configured on this server. Set THE_GRAPH_API_KEY and UNISWAP_V3_ETHEREUM_SUBGRAPH_ID.";

/** Shared with the other v3 readers: no v3 pool is ever deployed at address zero. */
const PoolAddressSchema = nonZeroEvmAddress(INVALID_ADDRESS);

export type EthereumV3PoolMetadataRequest = {
  readonly poolAddress: string;
  /** Raw environment values; validated here so the wrapper stays free of logic. */
  readonly apiKey: string | undefined;
  readonly subgraphId: string | undefined;
  readonly fetchImpl: FetchLike;
  readonly timeoutMs?: number;
};

/**
 * Reads the verified token ordering, token decimals and fee tier for one Ethereum
 * mainnet Uniswap v3 pool.
 *
 * This is the metadata that price work needs and the normalized snapshot does not
 * carry: which token is `token0`, and how many decimals each side has. It does
 * *not* complete a deployable position — that additionally needs the pool's tick
 * spacing, which is read on-chain rather than from a subgraph.
 *
 * No clock is injected, because nothing here is time-dependent: the answer
 * describes a pool's fixed configuration rather than a moment.
 *
 * Validation order matches the other readers: caller input first, then server
 * configuration, and neither reaches the network.
 */
export const fetchEthereumV3PoolMetadata = async (
  request: EthereumV3PoolMetadataRequest,
): Promise<DataResult<V3PoolMetadata>> => {
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
    query: V3_POOL_METADATA_QUERY,
    variables: { poolId: address.data },
    fetchImpl: request.fetchImpl,
    timeoutMs: request.timeoutMs ?? DEFAULT_SUBGRAPH_TIMEOUT_MS,
  });

  if (!transport.ok) {
    return { status: "unavailable", reason: transport.reason, message: transport.message };
  }

  return normalizeV3PoolMetadata({ payload: transport.payload, poolAddress: address.data });
};
