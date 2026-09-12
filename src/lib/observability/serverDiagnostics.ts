import type { DataFailureReason, DataResult } from "../../schemas";
import type { FetchLike } from "../uniswap/v3SubgraphTransport";

/*
 * Server-side diagnostics for the data readers.
 *
 * `DataResult` promises that a failure message never carries an API key, a URL
 * containing one, a stack trace or a raw provider payload, and that "anything
 * needed for debugging is logged server-side instead". This module is that
 * server side; until it existed the promise had nowhere to land, and a failed
 * read left nothing behind but the sanitized sentence the user saw.
 *
 * What it may record is deliberately narrow, because the two facts most useful
 * for debugging a failed request are also the two most dangerous to write down:
 *
 *   - **The request URL is a credential.** `ETHEREUM_RPC_URL` embeds the
 *     provider's key in its path, so a logged URL is a logged key.
 *   - **The request headers carry one too**: `Authorization: Bearer <graph key>`.
 *
 * A thrown error can quote either — a `fetch` rejection often names the host, and
 * `error.cause` can carry more — so no error text and no stack is logged either.
 *
 * What remains is an HTTP status, an elapsed time, an error's name and the
 * failure category the reader settled on. That is enough to tell a wrong subgraph
 * id (404) from a rejected key (401) from a rate limit (429) from a slow indexer
 * (timeout), which is exactly what someone looking at a sanitized message cannot
 * otherwise work out.
 */

/**
 * How much attention a line deserves.
 *
 * `error` means something is wrong with this deployment or with a provider;
 * `warn` means the read simply had nothing to return. Keeping them apart is what
 * makes the channel worth reading: a log where an ordinary mistyped address looks
 * the same as an expired API key teaches its reader to skip it.
 */
export type DiagnosticLevel = "warn" | "error";

/** Where a diagnostic goes. Injected so tests observe it instead of printing. */
export type DiagnosticLog = (level: DiagnosticLevel, message: string) => void;

const consoleLog: DiagnosticLog = (level, message) => {
  if (level === "warn") console.warn(message);
  else console.error(message);
};

/**
 * Failures that are ordinary use rather than a defect: an address that is not a
 * pool, an input this application cannot accept, a pool too new to have enough
 * history. Every other category means the deployment or the provider needs
 * attention.
 */
const ORDINARY_OUTCOMES: ReadonlySet<DataFailureReason> = new Set([
  "invalid-input",
  "not-found",
  "insufficient-data",
]);

/**
 * An error's name only.
 *
 * `name` is a constructor label — `AbortError`, `TypeError` — and says the useful
 * part: a timeout aborted, or the connection never opened. `message` and `stack`
 * are excluded on purpose: both routinely quote the URL that failed.
 */
const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : typeof error;

/**
 * Wraps a `fetch` so failed responses leave a server-side trace.
 *
 * A successful response logs nothing. Every read this application makes succeeds
 * far more often than it fails, and a line per request would bury the one that
 * matters.
 *
 * Neither `input` nor `init` is ever read for logging — that is the whole point
 * of putting this at the edge rather than inside the transport, which would have
 * to be handed the same dangerous values to be useful.
 */
export const loggingFetch = (
  label: string,
  fetchImpl: FetchLike = fetch,
  log: DiagnosticLog = consoleLog,
): FetchLike => {
  return async (input, init) => {
    const startedAt = Date.now();

    try {
      const response = await fetchImpl(input, init);
      if (!response.ok) {
        // Always `error`: a provider answering with a failure status is never
        // ordinary use. An address that matches no pool comes back as a
        // perfectly successful 200 with an empty result.
        log("error", `[${label}] HTTP ${response.status} after ${Date.now() - startedAt}ms`);
      }
      return response;
    } catch (error) {
      log(
        "error",
        `[${label}] request threw ${errorName(error)} after ${Date.now() - startedAt}ms`,
      );
      throw error;
    }
  };
};

/**
 * Records a read that produced nothing, and hands the result straight back so it
 * can wrap a call expression without restructuring it.
 *
 * The message is safe to log precisely because `DataResult` already requires it
 * to be safe to *show*. Logging it here pairs the category with the wording the
 * user saw, so a support question and a server log line can be matched up.
 */
export const logUnavailable = <T,>(
  label: string,
  result: DataResult<T>,
  log: DiagnosticLog = consoleLog,
): DataResult<T> => {
  if (result.status === "unavailable") {
    const level: DiagnosticLevel = ORDINARY_OUTCOMES.has(result.reason) ? "warn" : "error";
    log(level, `[${label}] unavailable (${result.reason}): ${result.message}`);
  }

  return result;
};
