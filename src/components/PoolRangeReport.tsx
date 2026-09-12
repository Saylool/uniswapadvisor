import type {
  PoolRangeAnalysisResult,
  PoolRangeAnalysisStep,
} from "../lib/advisor/poolRangeAnalysis";
import {
  formatFeePpm,
  formatPercent,
  formatPrice,
  formatTick,
  formatUsd,
  formatUtcDate,
  formatUtcMinute,
  formatWhole,
} from "../lib/format/displayFormats";

/**
 * Renders one pool's tick-range analysis.
 *
 * Presentational only: it fetches nothing, computes nothing, and holds no
 * credential. Every figure comes from the result it is handed, and every figure
 * it cannot show is shown as absent rather than as a zero.
 */

/** Says which stage stopped, in the reader's terms rather than the pipeline's. */
const STEP_LABELS: Record<PoolRangeAnalysisStep, string> = {
  pool: "reading the pool's configuration",
  snapshot: "reading the pool's current market state",
  history: "reading the pool's daily price history",
  volatility: "measuring historical volatility",
  band: "building the price band",
  range: "aligning the band onto the pool's tick grid",
};

function Figure({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string | undefined;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs uppercase tracking-widest text-muted">{label}</dt>
      <dd className="font-mono text-sm">{value}</dd>
      {note === undefined ? null : <p className="text-xs leading-relaxed text-muted">{note}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
      <h2 className="text-sm font-semibold uppercase tracking-widest text-muted">{title}</h2>
      <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{children}</dl>
    </section>
  );
}

export function PoolRangeReport({
  result,
  poolAddress,
}: {
  result: PoolRangeAnalysisResult;
  poolAddress: string;
}) {
  if (result.status === "unavailable") {
    return (
      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted">
          No range for this pool
        </h2>
        <p className="text-sm leading-relaxed">
          This stopped while {STEP_LABELS[result.step]}.
        </p>
        <p className="text-sm leading-relaxed text-muted">{result.message}</p>
        <p className="font-mono text-xs text-muted">
          {poolAddress} · {result.reason}
        </p>
      </section>
    );
  }

  const { pool, snapshot, volatility, band, range, parameters } = result.data;
  const warnings = result.status === "partial" ? result.warnings : [];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          {pool.token0.symbol} / {pool.token1.symbol}
        </h1>
        <p className="font-mono text-xs text-muted">{pool.id}</p>
        <p className="text-sm leading-relaxed text-muted">
          Uniswap v3 on Ethereum mainnet · {formatFeePpm(pool.feePpm)} fee tier · tick spacing{" "}
          {formatWhole(pool.tickSpacing)}
        </p>
      </header>

      {warnings.length === 0 ? null : (
        <aside
          aria-label="Caveats"
          className="rounded-lg border border-warning-border bg-warning-surface px-4 py-3 text-sm text-warning-foreground"
        >
          <p className="font-medium">
            {warnings.length === 1 ? "One caveat" : `${warnings.length} caveats`} apply to these
            figures.
          </p>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
            {warnings.map((warning) => (
              <li key={warning} className="leading-relaxed">
                {warning}
              </li>
            ))}
          </ul>
        </aside>
      )}

      <Section title="Suggested tick range">
        <Figure
          label="Lower tick"
          value={formatTick(range.lowerTick)}
          note={`Price ${formatPrice(range.lowerPrice)} ${pool.token1.symbol} per ${pool.token0.symbol}`}
        />
        <Figure
          label="Upper tick"
          value={formatTick(range.upperTick)}
          note={`Price ${formatPrice(range.upperPrice)} ${pool.token1.symbol} per ${pool.token0.symbol}`}
        />
        <Figure
          label="Width"
          value={`${formatWhole(range.upperTick - range.lowerTick)} ticks`}
          note={`${formatWhole((range.upperTick - range.lowerTick) / pool.tickSpacing)} spacings of ${formatWhole(pool.tickSpacing)}`}
        />
        <Figure
          label="Currently in range"
          value={range.containsCurrentPrice ? "Yes" : "No"}
          note={
            range.containsCurrentPrice
              ? "The pool's current tick sits inside these bounds."
              : "A position here would hold a single token and earn nothing until price returns."
          }
        />
        <Figure
          label="Lower edge"
          value={range.lowerBoundTruncated ? "Truncated" : "As asked"}
          {...(range.lowerBoundTruncated
            ? { note: "Stopped at the lowest tick this pool accepts." }
            : {})}
        />
        <Figure
          label="Upper edge"
          value={range.upperBoundTruncated ? "Truncated" : "As asked"}
          {...(range.upperBoundTruncated
            ? { note: "Stopped at the highest tick this pool accepts." }
            : {})}
        />
      </Section>

      <Section title="Current state">
        <Figure
          label={`${pool.token0.symbol} price`}
          value={formatPrice(band.currentPrice)}
          note={`${pool.token1.symbol} per ${pool.token0.symbol}`}
        />
        <Figure
          label="Current tick"
          value={formatTick(range.currentTick)}
          note={
            range.chainReportedTick === null
              ? "The source reported no tick of its own, so this conversion is unverified."
              : `Source reported ${formatTick(range.chainReportedTick)}.`
          }
        />
        <Figure label="Total value locked" value={formatUsd(snapshot.tvlUsd)} />
        <Figure
          label="Source block"
          value={snapshot.sourceBlockNumber ?? "—"}
          note={
            snapshot.sourceBlockTimestamp === null
              ? "No block time reported."
              : formatUtcMinute(snapshot.sourceBlockTimestamp)
          }
        />
        <Figure
          label="Fetched at"
          value={formatUtcMinute(snapshot.fetchedAt)}
          note="When the response arrived, not what it describes."
        />
      </Section>

      <Section title="Historical volatility">
        <Figure
          label="Annualised"
          value={formatPercent(volatility.annualizedVolatility)}
          note="Sample standard deviation of daily log returns, scaled by sqrt(365)."
        />
        <Figure label="Daily" value={formatPercent(volatility.dailyVolatility)} />
        <Figure
          label="Window"
          value={`${formatUtcDate(volatility.rangeStart)} → ${formatUtcDate(volatility.rangeEndExclusive)}`}
          note={`${formatWhole(volatility.usableReturnCount)} usable daily returns.`}
        />
        <Figure
          label="Coverage"
          value={formatPercent(volatility.returnCoverageRatio)}
          note="How much of the window had consecutive daily prices behind it."
        />
      </Section>

      <Section title="Price band this range came from">
        <Figure
          label="Horizon"
          value={`${formatWhole(parameters.horizonDays)} days`}
          note="How far ahead the band is scaled."
        />
        <Figure
          label="Multiplier"
          value={`${parameters.standardDeviationMultiplier}σ`}
          note="Horizon standard deviations, not a confidence level."
        />
        <Figure label="Lower bound" value={formatPrice(band.lowerPrice)} />
        <Figure label="Upper bound" value={formatPrice(band.upperPrice)} />
        <Figure
          label="Downside"
          value={formatPercent(band.downsideDistanceRatio)}
          note="Distance from the current price to the lower bound."
        />
        <Figure
          label="Upside"
          value={formatPercent(band.upsideDistanceRatio)}
          note="Distance from the current price to the upper bound."
        />
      </Section>

      <p className="text-sm leading-relaxed text-muted">
        The band is symmetric in log space, which makes it deliberately asymmetric in percentage
        terms: a move down to half price and a move up to double price are the same distance in
        logs, and only one of them is &ldquo;50%&rdquo;. It assumes no expected return, describes
        how far price has moved historically, and is not a forecast. The multiplier is not a
        confidence level. Nothing here sizes a position or says how much of either token to
        deposit.
      </p>
    </div>
  );
}
