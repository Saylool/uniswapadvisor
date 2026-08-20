/*
 * Source-freshness policy, shared by every v3 reader.
 *
 * Extracted so the snapshot and history adapters cannot drift apart: two copies
 * of a staleness threshold eventually disagree, and the disagreement would be
 * invisible — both would still return well-formed results, just with different
 * ideas of what "current" means.
 */

/**
 * How far behind the chain a source block may be before its figures stop being
 * usable. Fifteen minutes is roughly 75 Ethereum blocks: long enough to ride out
 * ordinary indexer lag, short enough that a price or tick has not usually moved
 * to somewhere a liquidity decision would be made differently.
 */
export const MAX_SOURCE_LAG_MS = 15 * 60 * 1000;

/**
 * How far *ahead* of our own clock a source block may appear before the response
 * is treated as contradictory rather than merely skewed.
 *
 * A block cannot genuinely be mined in our future, so anything beyond a small
 * allowance for clock drift between this server and the indexer means one of the
 * two timestamps is wrong — and a negative lag would otherwise sail through the
 * staleness check untouched.
 */
export const MAX_SOURCE_CLOCK_SKEW_MS = 2 * 60 * 1000;

export const STALE_SOURCE_MESSAGE =
  "The market data source is too far behind the chain for these figures to be treated as current.";

export const FUTURE_BLOCK_TIME_MESSAGE =
  "The market data source reported a block time ahead of this server's clock, so its figures cannot be verified.";

/**
 * Raised when the source reports no block time. Silence would let an unverifiable
 * result read exactly like a verified-fresh one, and `fetchedAt` must never be
 * substituted for the missing value — it records when we asked, not what the
 * answer describes.
 */
export const FRESHNESS_UNVERIFIED_WARNING =
  "The data source did not report a block time, so how current these figures are could not be verified.";

export type SourceFreshnessVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "stale-data" | "invalid-response";
      readonly message: string;
    };

/**
 * Judges a source block time against the moment the response arrived.
 *
 * A `null` block time is not a failure here — the caller reports it as an
 * unverified-freshness warning instead. What this must never do is treat absence
 * as freshness.
 *
 * Both arguments are canonical UTC timestamps that have already passed the domain
 * schema, so `Date.parse` yields finite instants.
 */
export const evaluateSourceFreshness = ({
  fetchedAt,
  sourceBlockTimestamp,
}: {
  readonly fetchedAt: string;
  readonly sourceBlockTimestamp: string | null;
}): SourceFreshnessVerdict => {
  if (sourceBlockTimestamp === null) return { ok: true };

  const lagMs = Date.parse(fetchedAt) - Date.parse(sourceBlockTimestamp);
  if (lagMs > MAX_SOURCE_LAG_MS) {
    return { ok: false, reason: "stale-data", message: STALE_SOURCE_MESSAGE };
  }
  if (lagMs < -MAX_SOURCE_CLOCK_SKEW_MS) {
    return { ok: false, reason: "invalid-response", message: FUTURE_BLOCK_TIME_MESSAGE };
  }
  return { ok: true };
};
