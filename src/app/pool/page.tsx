import type { Metadata } from "next";
import Link from "next/link";

import { EducationalDisclaimer } from "@/components/EducationalDisclaimer";
import { PoolRangeReport } from "@/components/PoolRangeReport";
import { getPoolRangeAnalysis } from "@/lib/advisor/getPoolRangeAnalysis";
import { EvmAddressSchema } from "@/schemas";

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

export const metadata: Metadata = {
  title: "Pool range analysis · Uniswap Strategy Advisor",
  description:
    "Historical-volatility price band for one Ethereum mainnet Uniswap v3 pool, aligned onto the pool's tick grid.",
  /*
   * Every render of this page spends third-party API quota, and the result is
   * only meaningful for the moment it was fetched. Neither property suits a
   * search index.
   */
  robots: { index: false, follow: false },
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-12 sm:py-16">
      <Link href="/" className="w-fit font-mono text-xs uppercase tracking-widest text-muted">
        ← Uniswap Strategy Advisor
      </Link>
      <EducationalDisclaimer />
      {children}
    </main>
  );
}

function AddressForm({ value }: { value?: string | undefined }) {
  return (
    <form
      method="get"
      action="/pool"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5"
    >
      <label htmlFor="address" className="text-sm font-medium">
        Ethereum mainnet Uniswap v3 pool address
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
          Analyse
        </button>
      </div>
      <p className="text-xs leading-relaxed text-muted">
        The address of the pool contract itself, not a token. Read-only: this application never
        connects a wallet and never sends a transaction.
      </p>
    </form>
  );
}

export default async function PoolRangePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const requested = (await searchParams).address;
  // A repeated parameter arrives as an array; only a single value is an address.
  const parsed = EvmAddressSchema.safeParse(typeof requested === "string" ? requested : undefined);

  if (!parsed.success) {
    return (
      <Shell>
        <AddressForm />
        {requested === undefined ? null : (
          /* Deliberately does not echo what was typed: it is unvalidated input. */
          <p className="text-sm leading-relaxed text-muted">
            That is not an Ethereum address. An address is <code>0x</code> followed by exactly 40
            hexadecimal characters.
          </p>
        )}
      </Shell>
    );
  }

  const result = await getPoolRangeAnalysis(parsed.data);

  return (
    <Shell>
      <AddressForm value={parsed.data} />
      <PoolRangeReport result={result} poolAddress={parsed.data} />
    </Shell>
  );
}
