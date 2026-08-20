import type { DataFailureReason } from "../../schemas";

/**
 * The Graph's decentralised gateway, queried by stable Subgraph ID.
 *
 * `/api/subgraphs/id/<SUBGRAPH_ID>` takes the Subgraph ID shown in The Graph
 * Explorer, and the gateway resolves it to whichever deployment indexers report
 * as sufficiently synced. The sibling `/api/deployments/id/` endpoint takes an
 * IPFS deployment hash instead and pins queries to one frozen version; this
 * adapter deliberately follows published upgrades rather than pinning.
 *
 * Only the Subgraph ID goes in the path. The API key travels solely in the
 * Authorization header, never in the URL, so it cannot leak through referrers,
 * proxy logs or error text.
 */
const GATEWAY_SUBGRAPH_BASE_URL = "https://gateway.thegraph.com/api/subgraphs/id";

export const DEFAULT_SUBGRAPH_TIMEOUT_MS = 10_000;

/**
 * The subset of `fetch` this module uses. Narrower than the global signature so a
 * test can supply a plain function without restating the whole DOM type.
 */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type SubgraphTransportResult =
  | { readonly ok: true; readonly payload: unknown }
  | { readonly ok: false; readonly reason: DataFailureReason; readonly message: string };

const failure = (reason: DataFailureReason, message: string): SubgraphTransportResult => ({
  ok: false,
  reason,
  message,
});

/*
 * Every message below is written here, in full, rather than derived from the
 * provider's response. Nothing from the wire reaches the caller: no gateway error
 * text, no response body, no request URL, no header. That is what keeps a
 * credential out of a message that may eventually be rendered to a user.
 */
const TIMED_OUT = "The market data request timed out.";
const UNREACHABLE = "The market data source could not be reached.";
const REJECTED_CREDENTIALS = "The market data source rejected the configured credentials.";
const RATE_LIMITED = "The market data source rate limit was exceeded.";
const UNREADABLE = "The market data source returned an unreadable response.";

/**
 * Maps an HTTP status onto a domain failure, or `null` when the response should
 * be read as a body.
 */
const classifyStatus = (status: number): SubgraphTransportResult | null => {
  if (status === 200) return null;
  if (status === 401 || status === 403) return failure("configuration-error", REJECTED_CREDENTIALS);
  if (status === 429) return failure("rate-limited", RATE_LIMITED);
  if (status >= 500) return failure("network-error", UNREACHABLE);
  return failure("invalid-response", UNREADABLE);
};

export type SubgraphQueryRequest = {
  readonly apiKey: string;
  readonly subgraphId: string;
  readonly query: string;
  /**
   * GraphQL variable values. Numbers are permitted because the subgraph's date
   * filters are `Int!`; every value is JSON-encoded into the body, never spliced
   * into the query text.
   */
  readonly variables: Readonly<Record<string, string | number>>;
  readonly fetchImpl: FetchLike;
  readonly timeoutMs: number;
};

/**
 * Posts one GraphQL operation and returns the decoded JSON body, or a domain
 * failure. Interpreting that body is the adapter's job — this layer knows about
 * transport only.
 */
export const postV3SubgraphQuery = async ({
  apiKey,
  subgraphId,
  query,
  variables,
  fetchImpl,
  timeoutMs,
}: SubgraphQueryRequest): Promise<SubgraphTransportResult> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetchImpl(`${GATEWAY_SUBGRAPH_BASE_URL}/${subgraphId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      // Market data is a point-in-time reading; a cached body would misreport how
      // fresh the figures are.
      cache: "no-store",
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });

    const statusFailure = classifyStatus(response.status);
    if (statusFailure !== null) return statusFailure;

    try {
      return { ok: true, payload: await response.json() };
    } catch {
      // The deadline can also expire midway through reading the body, in which
      // case this is a timeout rather than a malformed payload.
      return controller.signal.aborted
        ? failure("timeout", TIMED_OUT)
        : failure("invalid-response", UNREADABLE);
    }
  } catch {
    return controller.signal.aborted
      ? failure("timeout", TIMED_OUT)
      : failure("network-error", UNREACHABLE);
  } finally {
    clearTimeout(timeout);
  }
};
