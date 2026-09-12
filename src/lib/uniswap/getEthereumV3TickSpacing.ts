import "server-only";

import type { DataResult } from "../../schemas";
import { loggingFetch, logUnavailable } from "../observability/serverDiagnostics";
import { fetchEthereumV3TickSpacing } from "./ethereumV3TickSpacing";

/** Identifies this reader in server-side diagnostics. */
const LABEL = "v3-tick-spacing";

/*
 * The server-only boundary for on-chain reads.
 *
 * `ETHEREUM_RPC_URL` is a credential in a way the other variables are not: most
 * providers embed the API key in the URL itself, so the endpoint string *is* the
 * secret. `import "server-only"` makes importing this module from a Client
 * Component a build-time error, and the module is absent from every barrel, so
 * the URL cannot be pulled into a browser bundle by accident.
 */

/**
 * Reads one Ethereum mainnet Uniswap v3 pool's tick spacing from its contract.
 *
 * Environment variables are read per call rather than captured at module load, so
 * configuration changes take effect without a restart and no stale credential is
 * held in a closure.
 */
export const getEthereumV3TickSpacing = async (
  poolAddress: string,
): Promise<DataResult<number>> =>
  logUnavailable(
    LABEL,
    await fetchEthereumV3TickSpacing({
      poolAddress,
      rpcUrl: process.env.ETHEREUM_RPC_URL,
      fetchImpl: loggingFetch(LABEL),
    }),
  );
