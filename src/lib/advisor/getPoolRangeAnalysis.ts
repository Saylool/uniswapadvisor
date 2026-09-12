import "server-only";

import type { PriceBandParameters } from "../../schemas";
import { getEthereumV3DailyPriceHistory } from "../uniswap/getEthereumV3DailyPriceHistory";
import { getEthereumV3Pool } from "../uniswap/getEthereumV3Pool";
import { getEthereumV3PoolMarketSnapshot } from "../uniswap/getEthereumV3PoolMarketSnapshot";
import {
  analysePoolRange,
  DEFAULT_PRICE_BAND_PARAMETERS,
  type PoolRangeAnalysisResult,
} from "./poolRangeAnalysis";

/*
 * The server-only boundary for the whole advisor pipeline.
 *
 * `import "server-only"` makes importing this from a Client Component a build
 * error, which is what keeps `THE_GRAPH_API_KEY` and the RPC endpoint out of a
 * browser bundle. It is deliberately absent from every barrel file.
 *
 * It holds no logic of its own: the three reads happen here because they need
 * credentials, and everything downstream of them is the pure module next door.
 */

/**
 * Reads one Ethereum mainnet Uniswap v3 pool and works it through to a tick
 * range.
 *
 * The three reads run concurrently because none depends on another's result, so
 * the page waits for the slowest rather than the sum. Each returns its own
 * `DataResult`, and a failure in one is reported by the stage that needed it
 * rather than collapsing the whole call into a single opaque error.
 */
export const getPoolRangeAnalysis = async (
  poolAddress: string,
  parameters: PriceBandParameters = DEFAULT_PRICE_BAND_PARAMETERS,
): Promise<PoolRangeAnalysisResult> => {
  const [pool, snapshot, history] = await Promise.all([
    getEthereumV3Pool(poolAddress),
    getEthereumV3PoolMarketSnapshot(poolAddress),
    getEthereumV3DailyPriceHistory(poolAddress),
  ]);

  return analysePoolRange({ pool, snapshot, history, parameters });
};
