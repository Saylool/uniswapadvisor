import type { Locale } from "../i18n/locales";

/*
 * Deterministic formatting for the figures this advisor displays.
 *
 * Every formatter names its locale explicitly and defaults to English. `Intl`
 * with no locale follows the *host's*, which would make server-rendered output
 * depend on the machine that rendered it — the same page reading "0.000333" in
 * one deployment and "0,000333" in another. Varying by the reader's chosen
 * language is the opposite: a stated, reproducible choice, and the reason a
 * Turkish reader sees "%0,30" rather than "0.30%".
 *
 * The magnitudes here are extreme by nature: a USDC/WETH price is ~3e-4, a
 * truncated band edge can be 1e31, and both must stay readable. So each
 * formatter switches to scientific notation outside the range where ordinary
 * notation is still legible, rather than rendering forty digits or rounding a
 * real price to "0.00".
 *
 * Nothing here is allowed to invent precision: a value is shown to a fixed
 * number of significant digits and never padded out to look more exact.
 */

/** Shown wherever a figure is absent or not representable. Never "0". */
export const ABSENT = "—";

/**
 * Builds one formatter per published language, once, at module load.
 *
 * `Intl.NumberFormat` is expensive to construct and these are used on every
 * render, so they are made ahead rather than per call. The `Record<Locale, T>`
 * return type is what makes adding a language a compile error here rather than a
 * silently English figure in a translated page.
 */
const byLocale = <T,>(build: (tag: string) => T): Record<Locale, T> => ({
  en: build("en-US"),
  tr: build("tr-TR"),
});

const standardPrice = byLocale(
  (tag) => new Intl.NumberFormat(tag, { maximumSignificantDigits: 6 }),
);
const scientificPrice = byLocale(
  (tag) =>
    new Intl.NumberFormat(tag, { notation: "scientific", maximumSignificantDigits: 5 }),
);

const standardPercent = byLocale(
  (tag) =>
    new Intl.NumberFormat(tag, {
      style: "percent",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
);
const scientificPercent = byLocale(
  (tag) =>
    new Intl.NumberFormat(tag, {
      style: "percent",
      notation: "scientific",
      maximumSignificantDigits: 4,
    }),
);

const wholeNumber = byLocale((tag) => new Intl.NumberFormat(tag, { maximumFractionDigits: 0 }));

const feePercent = byLocale(
  (tag) =>
    new Intl.NumberFormat(tag, {
      style: "percent",
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }),
);

const wholeUsd = byLocale(
  (tag) =>
    new Intl.NumberFormat(tag, { style: "currency", currency: "USD", maximumFractionDigits: 0 }),
);
const preciseUsd = byLocale(
  (tag) =>
    new Intl.NumberFormat(tag, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
);

/** English unless a page states otherwise, so a bare call is never host-dependent. */
const DEFAULT_FORMAT_LOCALE: Locale = "en";

/**
 * Where ordinary notation stops being readable for a price. Below 1e-6 the
 * leading zeros outnumber the digits; at 1e9 the grouping runs off the line.
 */
const PRICE_STANDARD_MIN = 1e-6;
const PRICE_STANDARD_MAX = 1e9;

/** 1000 as a ratio is 100,000% — past that, percent notation stops informing. */
const PERCENT_STANDARD_MAX = 1000;

/**
 * A token price. Zero is formatted as-is rather than as absent: a schema-valid
 * price is never zero, so a zero here is a real value worth seeing.
 */
export const formatPrice = (value: number, locale: Locale = DEFAULT_FORMAT_LOCALE): string => {
  if (!Number.isFinite(value)) return ABSENT;

  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude < PRICE_STANDARD_MIN || magnitude >= PRICE_STANDARD_MAX)) {
    return scientificPrice[locale].format(value);
  }

  return standardPrice[locale].format(value);
};

/** A decimal ratio shown as a percentage: 0.0545 becomes "5.45%". */
export const formatPercent = (ratio: number, locale: Locale = DEFAULT_FORMAT_LOCALE): string => {
  if (!Number.isFinite(ratio)) return ABSENT;

  return Math.abs(ratio) >= PERCENT_STANDARD_MAX
    ? scientificPercent[locale].format(ratio)
    : standardPercent[locale].format(ratio);
};

/** A plain count, grouped. Rounds nothing away: every caller passes an integer. */
export const formatWhole = (value: number, locale: Locale = DEFAULT_FORMAT_LOCALE): string =>
  Number.isFinite(value) ? wholeNumber[locale].format(value) : ABSENT;

/**
 * A tick index. Identical to {@link formatWhole} today, but named separately
 * because a tick is a coordinate rather than a quantity, and a reader scanning
 * the markup should be able to tell which one a figure is.
 */
export const formatTick = (tick: number, locale: Locale = DEFAULT_FORMAT_LOCALE): string =>
  formatWhole(tick, locale);

/**
 * A swap fee held in parts-per-million, shown the way Uniswap labels its tiers:
 * 3000 ppm is the 0.30% tier.
 */
export const formatFeePpm = (feePpm: number, locale: Locale = DEFAULT_FORMAT_LOCALE): string =>
  Number.isFinite(feePpm) ? feePercent[locale].format(feePpm / 1_000_000) : ABSENT;

/** Below this, dropping the cents would round a real figure away. */
const USD_WHOLE_MIN = 1000;

/**
 * A USD figure such as pool TVL. `null` is an unreported figure and is shown as
 * absent — never as `$0`, which would claim the pool holds nothing.
 */
export const formatUsd = (
  value: number | null,
  locale: Locale = DEFAULT_FORMAT_LOCALE,
): string => {
  if (value === null || !Number.isFinite(value)) return ABSENT;

  return Math.abs(value) >= USD_WHOLE_MIN
    ? wholeUsd[locale].format(value)
    : preciseUsd[locale].format(value);
};

/** The exact width {@link IsoTimestampSchema} guarantees, and nothing else. */
const ISO_MILLISECOND_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * An instant as "2026-08-21 09:15 UTC".
 *
 * Sliced from the ISO string rather than parsed and reformatted, so no timezone
 * is applied and the output cannot drift with the renderer's clock settings. The
 * zone is spelled out because a bare time with no zone invites the reader to
 * assume their own.
 */
export const formatUtcMinute = (timestamp: string): string =>
  ISO_MILLISECOND_UTC.test(timestamp)
    ? `${timestamp.slice(0, 10)} ${timestamp.slice(11, 16)} UTC`
    : ABSENT;

/** The date alone, for a window boundary where the time of day is always midnight. */
export const formatUtcDate = (timestamp: string): string =>
  ISO_MILLISECOND_UTC.test(timestamp) ? timestamp.slice(0, 10) : ABSENT;
