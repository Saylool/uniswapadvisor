import type {
  PoolRangeAnalysisResult,
  PoolRangeAnalysisStep,
} from "../lib/advisor/poolRangeAnalysis";
import {
  ABSENT,
  formatFeePpm,
  formatPercent,
  formatPrice,
  formatTick,
  formatUsd,
  formatUtcDate,
  formatUtcMinute,
  formatWhole,
} from "../lib/format/displayFormats";
import type { Dictionary } from "../lib/i18n/dictionaries";
import type { Locale } from "../lib/i18n/locales";

/**
 * Renders one pool's tick-range analysis.
 *
 * Presentational only: it fetches nothing, computes nothing, and holds no
 * credential. Every figure comes from the result it is handed, and every figure
 * it cannot show is shown as absent rather than as a zero.
 *
 * Both the words and the numbers follow the reader's language — a translated
 * page that still writes "0.30%" to a Turkish reader is only half translated.
 *
 * The warnings are the exception. They arrive from the data layer as fixed
 * sentences and are rendered as they come, in English, because making them
 * translatable means turning them into codes down there rather than text up
 * here.
 */

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
  t,
  locale,
}: {
  result: PoolRangeAnalysisResult;
  poolAddress: string;
  t: Dictionary;
  locale: Locale;
}) {
  if (result.status === "unavailable") {
    const step: PoolRangeAnalysisStep = result.step;

    return (
      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted">
          {t.report.noRangeHeading}
        </h2>
        <p className="text-sm leading-relaxed">{t.report.stoppedWhile(t.report.steps[step])}</p>
        <p className="text-sm leading-relaxed text-muted">{result.message}</p>
        <p className="font-mono text-xs text-muted">
          {poolAddress} · {result.reason}
        </p>
      </section>
    );
  }

  const { pool, snapshot, volatility, band, range, parameters } = result.data;
  const warnings = result.status === "partial" ? result.warnings : [];

  const base = pool.token0.symbol;
  const quote = pool.token1.symbol;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          {base} / {quote}
        </h1>
        <p className="font-mono text-xs text-muted">{pool.id}</p>
        <p className="text-sm leading-relaxed text-muted">
          {t.report.poolSummary(
            formatFeePpm(pool.feePpm, locale),
            formatWhole(pool.tickSpacing, locale),
          )}
        </p>
      </header>

      {warnings.length === 0 ? null : (
        <aside
          aria-label={t.report.caveatsAriaLabel}
          className="rounded-lg border border-warning-border bg-warning-surface px-4 py-3 text-sm text-warning-foreground"
        >
          <p className="font-medium">{t.report.caveatsHeading(warnings.length)}</p>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
            {warnings.map((warning) => (
              <li key={warning} className="leading-relaxed">
                {warning}
              </li>
            ))}
          </ul>
        </aside>
      )}

      <Section title={t.report.rangeHeading}>
        <Figure
          label={t.report.lowerTick}
          value={formatTick(range.lowerTick, locale)}
          note={t.report.priceAt(formatPrice(range.lowerPrice, locale), quote, base)}
        />
        <Figure
          label={t.report.upperTick}
          value={formatTick(range.upperTick, locale)}
          note={t.report.priceAt(formatPrice(range.upperPrice, locale), quote, base)}
        />
        <Figure
          label={t.report.width}
          value={t.report.widthValue(formatWhole(range.upperTick - range.lowerTick, locale))}
          note={t.report.widthNote(
            formatWhole((range.upperTick - range.lowerTick) / pool.tickSpacing, locale),
            formatWhole(pool.tickSpacing, locale),
          )}
        />
        <Figure
          label={t.report.inRange}
          value={range.containsCurrentPrice ? t.report.yes : t.report.no}
          note={range.containsCurrentPrice ? t.report.inRangeNote : t.report.outOfRangeNote}
        />
        <Figure
          label={t.report.lowerEdge}
          value={range.lowerBoundTruncated ? t.report.truncated : t.report.asAsked}
          {...(range.lowerBoundTruncated ? { note: t.report.lowerTruncatedNote } : {})}
        />
        <Figure
          label={t.report.upperEdge}
          value={range.upperBoundTruncated ? t.report.truncated : t.report.asAsked}
          {...(range.upperBoundTruncated ? { note: t.report.upperTruncatedNote } : {})}
        />
      </Section>

      <Section title={t.report.currentStateHeading}>
        <Figure
          label={t.report.tokenPrice(base)}
          value={formatPrice(band.currentPrice, locale)}
          note={t.report.quotePerBase(quote, base)}
        />
        <Figure
          label={t.report.currentTick}
          value={formatTick(range.currentTick, locale)}
          note={
            range.chainReportedTick === null
              ? t.report.noSourceTick
              : t.report.sourceReportedTick(formatTick(range.chainReportedTick, locale))
          }
        />
        <Figure label={t.report.tvl} value={formatUsd(snapshot.tvlUsd, locale)} />
        <Figure
          label={t.report.sourceBlock}
          value={snapshot.sourceBlockNumber ?? ABSENT}
          note={
            snapshot.sourceBlockTimestamp === null
              ? t.report.noBlockTime
              : formatUtcMinute(snapshot.sourceBlockTimestamp)
          }
        />
        <Figure
          label={t.report.fetchedAt}
          value={formatUtcMinute(snapshot.fetchedAt)}
          note={t.report.fetchedAtNote}
        />
      </Section>

      <Section title={t.report.volatilityHeading}>
        <Figure
          label={t.report.annualised}
          value={formatPercent(volatility.annualizedVolatility, locale)}
          note={t.report.annualisedNote}
        />
        <Figure
          label={t.report.daily}
          value={formatPercent(volatility.dailyVolatility, locale)}
        />
        <Figure
          label={t.report.window}
          value={`${formatUtcDate(volatility.rangeStart)} → ${formatUtcDate(volatility.rangeEndExclusive)}`}
          note={t.report.windowNote(formatWhole(volatility.usableReturnCount, locale))}
        />
        <Figure
          label={t.report.coverage}
          value={formatPercent(volatility.returnCoverageRatio, locale)}
          note={t.report.coverageNote}
        />
      </Section>

      <Section title={t.report.bandHeading}>
        <Figure
          label={t.report.horizon}
          value={t.report.horizonValue(formatWhole(parameters.horizonDays, locale))}
          note={t.report.horizonNote}
        />
        <Figure
          label={t.report.multiplier}
          value={`${formatWhole(parameters.standardDeviationMultiplier, locale)}σ`}
          note={t.report.multiplierNote}
        />
        <Figure label={t.report.lowerBound} value={formatPrice(band.lowerPrice, locale)} />
        <Figure label={t.report.upperBound} value={formatPrice(band.upperPrice, locale)} />
        <Figure
          label={t.report.downside}
          value={formatPercent(band.downsideDistanceRatio, locale)}
          note={t.report.downsideNote}
        />
        <Figure
          label={t.report.upside}
          value={formatPercent(band.upsideDistanceRatio, locale)}
          note={t.report.upsideNote}
        />
      </Section>

      <p className="text-sm leading-relaxed text-muted">{t.report.epilogue}</p>
    </div>
  );
}
