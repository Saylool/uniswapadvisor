import "server-only";

import type { DataResult, PoolMarketSnapshot } from "../../schemas";
import { fetchEthereumV3PoolMarketSnapshot } from "./ethereumV3PoolMarketSnapshot";

/*
 * The server-only boundary.
 *
 * `import "server-only"` makes importing this module from a Client Component a
 * build-time error, which is the guarantee that `THE_GRAPH_API_KEY` cannot be
 * pulled into a browser bundle. Next.js resolves the specifier itself, so no
 * package needs installing.
 *
 * This module is deliberately absent from any barrel file: a barrel that
 * re-exported it would let client code import the credential path by accident
 * while looking for something unrelated.
 *
 * It holds no logic — only the two impure things the pure layer cannot own:
 * reading the environment and reading the clock.
 */

/**
 * Fetches a verified market snapshot for one Ethereum mainnet Uniswap v3 pool.
 *
 * Environment variables are read per call rather than captured at module load, so
 * configuration changes take effect without a restart and no stale credential is
 * held in a closure.
 */
export const getEthereumV3PoolMarketSnapshot = async (
  poolAddress: string,
): Promise<DataResult<PoolMarketSnapshot>> =>
  fetchEthereumV3PoolMarketSnapshot({
    poolAddress,
    apiKey: process.env.THE_GRAPH_API_KEY,
    subgraphId: process.env.UNISWAP_V3_ETHEREUM_SUBGRAPH_ID,
    fetchImpl: fetch,
    now: () => new Date(),
  });
