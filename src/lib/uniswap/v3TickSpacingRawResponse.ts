import { z } from "zod";

/*
 * The untrusted edge of an `eth_call` response. JSON-RPC field names stop here.
 *
 * Non-strict, like the subgraph boundaries: providers add fields, and an extra
 * key must not break a read.
 */
export const EthCallResponseSchema = z.object({
  /**
   * ABI-encoded return data as a hex string. Absent when the node reports an
   * error instead.
   */
  result: z.string().nullish(),
  /**
   * Read only for presence. Provider error text is never inspected or forwarded —
   * some nodes echo the request URL, which would leak the key embedded in it.
   */
  error: z.unknown().nullish(),
});

export type EthCallResponse = z.infer<typeof EthCallResponseSchema>;
