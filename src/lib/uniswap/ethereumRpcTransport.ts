import type { DataFailureReason } from "../../schemas";
import type { FetchLike } from "./v3SubgraphTransport";

/*
 * Minimal JSON-RPC transport for read-only `eth_call`s.
 *
 * Separate from the subgraph transport because the credential lives somewhere
 * completely different: The Graph takes a bearer token in a header, while most
 * Ethereum providers embed the key in the URL itself
 * (https://…/v2/<KEY>). That single fact drives the rules below — the endpoint is
 * treated as a secret in its own right and never appears in a message, a warning
 * or a thrown error.
 *
 * Read-only by construction: this module can issue `eth_call` and nothing else.
 * There is no signing, no `eth_sendTransaction`, no account access.
 */

export const DEFAULT_RPC_TIMEOUT_MS = 10_000;

export type RpcTransportResult =
  | { readonly ok: true; readonly payload: unknown }
  | { readonly ok: false; readonly reason: DataFailureReason; readonly message: string };

const failure = (reason: DataFailureReason, message: string): RpcTransportResult => ({
  ok: false,
  reason,
  message,
});

/*
 * Fixed messages, written here in full. Nothing from the wire reaches the caller:
 * no provider error text, no response body, and above all no endpoint URL, which
 * would leak the provider key on most services.
 */
const TIMED_OUT = "The on-chain data request timed out.";
const UNREACHABLE = "The on-chain data source could not be reached.";
const REJECTED_CREDENTIALS = "The on-chain data source rejected the configured credentials.";
const RATE_LIMITED = "The on-chain data source rate limit was exceeded.";
const UNREADABLE = "The on-chain data source returned an unreadable response.";

const classifyStatus = (status: number): RpcTransportResult | null => {
  if (status === 200) return null;
  if (status === 401 || status === 403) return failure("configuration-error", REJECTED_CREDENTIALS);
  if (status === 429) return failure("rate-limited", RATE_LIMITED);
  if (status >= 500) return failure("network-error", UNREACHABLE);
  return failure("invalid-response", UNREADABLE);
};

export type EthCallRequest = {
  /** Full provider endpoint. Treated as a credential; never logged or returned. */
  readonly rpcUrl: string;
  /** Contract being called. */
  readonly to: string;
  /** ABI-encoded calldata, `0x`-prefixed. */
  readonly data: string;
  readonly fetchImpl: FetchLike;
  readonly timeoutMs: number;
};

/**
 * Performs one `eth_call` against the latest block and returns the decoded JSON
 * body, or a domain failure. Interpreting that body is the adapter's job.
 *
 * Pinned to `"latest"` rather than a specific block: the only thing read through
 * here is a pool's immutable configuration, which is identical at every block
 * after deployment.
 */
export const postEthCall = async ({
  rpcUrl,
  to,
  data,
  fetchImpl,
  timeoutMs,
}: EthCallRequest): Promise<RpcTransportResult> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // A contract read is a point-in-time question; a cached body would answer a
      // different one.
      cache: "no-store",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to, data }, "latest"],
      }),
      signal: controller.signal,
    });

    const statusFailure = classifyStatus(response.status);
    if (statusFailure !== null) return statusFailure;

    try {
      return { ok: true, payload: await response.json() };
    } catch {
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
