import type { Metadata } from "next";
import Link from "next/link";

import { EducationalDisclaimer } from "@/components/EducationalDisclaimer";
import { PoolRangeReport } from "@/components/PoolRangeReport";
import { PreferenceBar } from "@/components/PreferenceBar";
import { getPoolRangeAnalysis } from "@/lib/advisor/getPoolRangeAnalysis";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/locales";
import { getRequestDictionary } from "@/lib/i18n/requestLocale";
import { EvmAddressSchema } from "@/schemas/primitives";

/*
 * The first surface that runs the whole pipeline against live data.
 *
 * A Server Component, so the credentials the readers need never enter a browser
 * bundle. The pool address arrives as a search parameter rather than a path
 * segment specifically so the form below can be plain HTML: a GET form can fill
 * a query string with no JavaScript at all, but cannot build a path.
 *
 * No pool address is hardcoded anywhere. Shipping one would mean asserting from
 * memory which contract a pair lives at, and an address this application cannot
 * verify has no place in its UI.
 */

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getRequestDictionary();

  return {
    title: t.metadata.poolTitle,
    description: t.metadata.poolDescription,
    /*
     * Every render of this page spends third-party API quota, and the result is
     * only meaningful for the moment it was fetched. Neither property suits a
     * search index.
     */
    robots: { index: false, follow: false },
  };
}

function Shell({
  locale,
  t,
  children,
}: {
  locale: Locale;
  t: Dictionary;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-12 sm:py-16">
      <PreferenceBar locale={locale} t={t} />
      <Link href="/" className="w-fit font-mono text-xs uppercase tracking-widest text-muted">
        {t.pool.back}
      </Link>
      <EducationalDisclaimer t={t} />
      {children}
    </main>
  );
}

function AddressForm({ t, value }: { t: Dictionary; value?: string | undefined }) {
  return (
    <form
      method="get"
      action="/pool"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5"
    >
      <label htmlFor="address" className="text-sm font-medium">
        {t.pool.addressLabel}
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          id="address"
          name="address"
          type="text"
          required
          spellCheck={false}
          autoComplete="off"
          /* Mirrors EvmAddressSchema, so an obvious typo is caught before a request. */
          pattern="0x[0-9a-fA-F]{40}"
          placeholder="0x0000000000000000000000000000000000000000"
          defaultValue={value ?? ""}
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
        />
        <button
          type="submit"
          className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium"
        >
          {t.pool.analyse}
        </button>
      </div>
      <p className="text-xs leading-relaxed text-muted">{t.pool.addressHelp}</p>
    </form>
  );
}

export default async function PoolRangePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { locale, t } = await getRequestDictionary();
  const requested = (await searchParams).address;
  // A repeated parameter arrives as an array; only a single value is an address.
  const parsed = EvmAddressSchema.safeParse(typeof requested === "string" ? requested : undefined);

  if (!parsed.success) {
    return (
      <Shell locale={locale} t={t}>
        <AddressForm t={t} />
        {requested === undefined ? null : (
          /* Deliberately does not echo what was typed: it is unvalidated input. */
          <p className="text-sm leading-relaxed text-muted">{t.pool.invalidAddress}</p>
        )}
      </Shell>
    );
  }

  const result = await getPoolRangeAnalysis(parsed.data);

  return (
    <Shell locale={locale} t={t}>
      <AddressForm t={t} value={parsed.data} />
      <PoolRangeReport result={result} poolAddress={parsed.data} t={t} locale={locale} />
    </Shell>
  );
}
