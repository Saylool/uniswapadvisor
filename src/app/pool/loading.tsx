import { getRequestDictionary } from "@/lib/i18n/requestLocale";

/**
 * Shown while the page's reads are in flight.
 *
 * The analysis needs three concurrent subgraph reads and one `eth_call`, so the
 * page is genuinely blocked for a moment. Without this the browser shows the
 * previous screen with no sign that anything is happening.
 */
export default async function Loading() {
  const { t } = await getRequestDictionary();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-12 sm:py-16">
      <p className="font-mono text-xs uppercase tracking-widest text-muted">{t.pool.loading}</p>
      <div className="flex flex-col gap-4" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="h-28 animate-pulse rounded-lg border border-border bg-surface"
          />
        ))}
      </div>
    </main>
  );
}
