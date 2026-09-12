import { createFixedWindowRateLimiter } from "./fixedWindowLimiter";

/*
 * The limiter guarding the one page that spends third-party API quota.
 *
 * A module-level singleton, so the count lives as long as the process rather
 * than resetting per request.
 */

/**
 * Requests per window per client.
 *
 * Each analysed pool costs four upstream calls — three subgraph queries and one
 * `eth_call` — so ten requests a minute is forty. Generous for someone reading a
 * page and comparing a few pools, and far below what an unattended script would
 * want. It is a cost control, not a product rule.
 */
export const POOL_ANALYSIS_REQUEST_LIMIT = 10;

/** Window length. Short enough that a refused visitor is not shut out for long. */
export const POOL_ANALYSIS_WINDOW_MS = 60_000;

/**
 * Ceiling on tracked clients. Ten thousand windows is a few hundred kilobytes,
 * and reaching it needs ten thousand distinct addresses inside one minute.
 */
const MAX_TRACKED_CLIENTS = 10_000;

export const poolAnalysisRateLimiter = createFixedWindowRateLimiter({
  limit: POOL_ANALYSIS_REQUEST_LIMIT,
  windowMs: POOL_ANALYSIS_WINDOW_MS,
  maxTrackedKeys: MAX_TRACKED_CLIENTS,
  now: () => Date.now(),
});
