import { z } from "zod";

/**
 * Where a piece of normalized data came from.
 *
 * Identity only. Endpoint URLs, API keys and transport settings belong to the
 * service layer — putting them here would drag credentials into values that are
 * serialized to the client.
 */
export const DataSourceSchema = z.enum([
  "uniswap-v3-subgraph",
  "uniswap-v4-subgraph",
  "hook-registry",
  /** Computed by this application from other sources rather than fetched. */
  "derived-analytics",
]);

export type DataSource = z.infer<typeof DataSourceSchema>;
