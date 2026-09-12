import "server-only";

import type { DataResult, V3Pool } from "../../schemas";
import { loggingFetch, logUnavailable } from "../observability/serverDiagnostics";
import { fetchEthereumV3Pool } from "./ethereumV3Pool";

/** Identifies this reader in server-side diagnostics. */
const LABEL = "v3-pool";

/*
 * The server-only boundary for a complete pool description.
 *
 * Touches both credentials — the Graph key and the RPC endpoint — so it is the
 * single most sensitive module in this directory. `import "server-only"` and the
 * absence of any barrel export are what keep both out of a browser bundle.
 */

/**
 * Fetches everything needed to describe one Ethereum mainnet Uniswap v3 pool:
 * token ordering, token decimals and fee tier from the subgraph, tick spacing
 * from the pool contract.
 *
 * Environment variables are read per call rather than captured at module load.
 */
export const getEthereumV3Pool = async (poolAddress: string): Promise<DataResult<V3Pool>> =>
  logUnavailable(
    LABEL,
    await fetchEthereumV3Pool({
      poolAddress,
      apiKey: process.env.THE_GRAPH_API_KEY,
      subgraphId: process.env.UNISWAP_V3_ETHEREUM_SUBGRAPH_ID,
      rpcUrl: process.env.ETHEREUM_RPC_URL,
      fetchImpl: loggingFetch(LABEL),
    }),
  );
