import "server-only";

import type { DataResult, V3PoolMetadata } from "../../schemas";
import { fetchEthereumV3PoolMetadata } from "./ethereumV3PoolMetadata";

/*
 * The server-only boundary for pool metadata.
 *
 * `import "server-only"` makes importing this module from a Client Component a
 * build-time error, which is the guarantee that `THE_GRAPH_API_KEY` cannot be
 * pulled into a browser bundle. Next.js resolves the specifier itself, so no
 * package needs installing.
 *
 * Deliberately absent from every barrel file: a barrel that re-exported it would
 * let client code reach the credential path by accident.
 *
 * It holds no logic — only the impure thing the pure layer cannot own: reading
 * the environment. There is no clock to read, because pool metadata is fixed at
 * deployment and carries no observation time.
 */

/**
 * Fetches the token ordering, token decimals and fee tier for one Ethereum
 * mainnet Uniswap v3 pool.
 *
 * Environment variables are read per call rather than captured at module load, so
 * configuration changes take effect without a restart and no stale credential is
 * held in a closure.
 */
export const getEthereumV3PoolMetadata = async (
  poolAddress: string,
): Promise<DataResult<V3PoolMetadata>> =>
  fetchEthereumV3PoolMetadata({
    poolAddress,
    apiKey: process.env.THE_GRAPH_API_KEY,
    subgraphId: process.env.UNISWAP_V3_ETHEREUM_SUBGRAPH_ID,
    fetchImpl: fetch,
  });
