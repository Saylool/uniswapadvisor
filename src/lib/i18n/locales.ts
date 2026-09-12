/*
 * Which languages the interface is published in, and how one is chosen.
 *
 * Pure: no cookies, no headers, no request. The server-only module next door
 * supplies those and calls in here to decide.
 *
 * Scope is deliberately the interface only. Warnings and failure messages are
 * produced deep in the data layer as fixed sentences — that fixedness is what
 * makes identical input warn identically — so translating them means turning
 * them into codes the interface resolves, which is a change to a layer this
 * project has verified line by line. Until that happens those sentences stay in
 * English, and the interface around them speaks the reader's language.
 */

export const LOCALES = ["en", "tr"] as const;

export type Locale = (typeof LOCALES)[number];

/** Used when nothing identifies a preference. */
export const DEFAULT_LOCALE: Locale = "en";

/** Name of the cookie that remembers an explicit choice. */
export const LOCALE_COOKIE = "locale";

/**
 * How long a chosen language is remembered. A year: a language preference does
 * not go stale, and asking again every session would be worse than wrong.
 */
export const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (LOCALES as readonly string[]).includes(value);

/** One entry of an `Accept-Language` header, after its quality has been read. */
type LanguageRange = { readonly tag: string; readonly quality: number };

/**
 * Parses `Accept-Language` into ranges ordered by the client's preference.
 *
 * The header is a comma-separated list where each entry may carry a `q` weight
 * between 0 and 1, defaulting to 1: `tr-TR,tr;q=0.9,en;q=0.8`. An entry with
 * `q=0` means "explicitly not this one" and is dropped rather than ranked last.
 *
 * Malformed entries are skipped rather than failing the whole header. This runs
 * on input from the network, and the sensible answer to a header that makes no
 * sense is the default language, not an error page.
 */
const parseAcceptLanguage = (header: string): readonly LanguageRange[] => {
  const ranges: LanguageRange[] = [];

  for (const entry of header.split(",")) {
    const [rawTag, ...parameters] = entry.trim().split(";");
    const tag = rawTag?.trim().toLowerCase() ?? "";
    if (tag.length === 0) continue;

    const qualityParameter = parameters
      .map((parameter) => parameter.trim())
      .find((parameter) => parameter.startsWith("q="));

    const quality = qualityParameter === undefined ? 1 : Number(qualityParameter.slice(2));

    /*
     * An absent `q` means 1. A present but unusable one drops the entry rather
     * than being given a guessed weight — that covers both a malformed number
     * and the explicit `q=0`, which says "not this one" and must not simply rank
     * last.
     */
    if (!Number.isFinite(quality) || quality <= 0 || quality > 1) continue;

    ranges.push({ tag, quality });
  }

  // Stable sort: equal weights keep the order the client wrote them in, which is
  // itself a statement of preference.
  return ranges.sort((left, right) => right.quality - left.quality);
};

/**
 * Picks the best supported language from an `Accept-Language` header.
 *
 * Matches the primary subtag, so `tr-TR` and `tr-CY` both select Turkish — a
 * reader asking for Turkish as spoken in Cyprus is better served Turkish than
 * English. `*` is ignored: it means "anything", which is what the default
 * already is.
 *
 * Returns `null` when the header names nothing this interface publishes, so the
 * caller can tell "no preference expressed" from "preferred the default".
 */
export const negotiateLocale = (acceptLanguage: string | null | undefined): Locale | null => {
  if (acceptLanguage === null || acceptLanguage === undefined) return null;

  for (const { tag } of parseAcceptLanguage(acceptLanguage)) {
    const primary = tag.split("-")[0];
    if (isLocale(primary)) return primary;
  }

  return null;
};

/**
 * The language to render in, given what the reader has chosen and what their
 * browser asked for.
 *
 * An explicit choice always wins: someone who switched to English on a Turkish
 * browser meant it, and second-guessing them on the next page load would make
 * the switch look broken.
 */
export const resolveLocale = (input: {
  readonly cookieValue: string | null | undefined;
  readonly acceptLanguage: string | null | undefined;
}): Locale => {
  if (isLocale(input.cookieValue)) return input.cookieValue;

  return negotiateLocale(input.acceptLanguage) ?? DEFAULT_LOCALE;
};
