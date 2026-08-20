import "server-only";

import type { DataResult, PoolDailyPriceHistory } from "../../schemas";
import { fetchEthereumV3DailyPriceHistory } from "./ethereumV3DailyPriceHistory";

/*
 * The server-only boundary for daily price history.
 *
 * `import "server-only"` makes importing this module from a Client Component a
 * build-time error, which is the guarantee that `THE_GRAPH_API_KEY` cannot be
 * pulled into a browser bundle. Next.js resolves the specifier itself, so no
 * package needs installing.
 *
 * Deliberately absent from every barrel file: a barrel that re-exported it would
 * let client code reach the credential path by accident.
 *
 * It holds no logic — only the two impure things the pure layer cannot own:
 * reading the environment and reading the clock.
 */

/**
 * Fetches the previous 31 completed UTC days of closing prices for one Ethereum
 * mainnet Uniswap v3 pool.
 *
 * Environment variables are read per call rather than captured at module load, so
 * configuration changes take effect without a restart and no stale credential is
 * held in a closure.
 */
export const getEthereumV3DailyPriceHistory = async (
  poolAddress: string,
): Promise<DataResult<PoolDailyPriceHistory>> =>
  fetchEthereumV3DailyPriceHistory({
    poolAddress,
    apiKey: process.env.THE_GRAPH_API_KEY,
    subgraphId: process.env.UNISWAP_V3_ETHEREUM_SUBGRAPH_ID,
    fetchImpl: fetch,
    now: () => new Date(),
  });
