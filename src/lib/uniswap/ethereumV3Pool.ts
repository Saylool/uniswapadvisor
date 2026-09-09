import { type DataResult, type V3Pool, V3PoolSchema } from "../../schemas";
import { fetchEthereumV3PoolMetadata } from "./ethereumV3PoolMetadata";
import { fetchEthereumV3TickSpacing } from "./ethereumV3TickSpacing";
import type { FetchLike } from "./v3SubgraphTransport";

const INCONSISTENT =
  "The pool configuration assembled from its two sources could not be verified.";

export type EthereumV3PoolRequest = {
  readonly poolAddress: string;
  /** The Graph credentials, for token ordering, decimals and the fee tier. */
  readonly apiKey: string | undefined;
  readonly subgraphId: string | undefined;
  /** Ethereum JSON-RPC endpoint, for the tick spacing. */
  readonly rpcUrl: string | undefined;
  readonly fetchImpl: FetchLike;
  readonly timeoutMs?: number;
};

/**
 * Assembles a complete `V3Pool` from the two sources that between them can verify
 * one.
 *
 * Neither source is sufficient alone. The subgraph knows the token ordering,
 * decimals and fee tier but has no `tickSpacing` field at all; the pool contract
 * knows its tick spacing but is an expensive place to read token metadata from.
 * This is the first point in the codebase where a pool is described completely
 * enough to align a position's bounds.
 *
 * The two reads run concurrently — they are independent, and a pool's
 * configuration is immutable, so there is no ordering or consistency window to
 * respect between them.
 *
 * Either failure is propagated as-is rather than flattened into a generic error,
 * so a caller can still tell a missing pool from a missing credential.
 */
export const fetchEthereumV3Pool = async (
  request: EthereumV3PoolRequest,
): Promise<DataResult<V3Pool>> => {
  const [metadata, tickSpacing] = await Promise.all([
    fetchEthereumV3PoolMetadata({
      poolAddress: request.poolAddress,
      apiKey: request.apiKey,
      subgraphId: request.subgraphId,
      fetchImpl: request.fetchImpl,
      ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
    }),
    fetchEthereumV3TickSpacing({
      poolAddress: request.poolAddress,
      rpcUrl: request.rpcUrl,
      fetchImpl: request.fetchImpl,
      ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
    }),
  ]);

  if (metadata.status === "unavailable") return metadata;
  if (tickSpacing.status === "unavailable") return tickSpacing;

  /*
   * Re-validated as a whole. The two halves were each checked against their own
   * source, but only here do they have to agree on being one pool — and the
   * schema re-derives every invariant rather than trusting that they do.
   */
  const pool = V3PoolSchema.safeParse({
    ...metadata.data,
    tickSpacing: tickSpacing.data,
  });
  if (!pool.success) {
    return { status: "unavailable", reason: "invalid-response", message: INCONSISTENT };
  }

  return { status: "success", data: pool.data };
};
