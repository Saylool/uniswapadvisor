import type { Dictionary } from "../lib/i18n/dictionaries";

/**
 * Single source of truth for the product-wide disclaimer.
 *
 * Every surface that renders a recommendation must show this. Keeping the
 * wording in one component prevents individual feature pages from drifting
 * into softer language than the product is allowed to use — and keeping it in
 * the dictionary keeps each translation of it in one place too.
 */
export function EducationalDisclaimer({ t }: { t: Dictionary }) {
  return (
    <aside
      aria-label={t.disclaimer.ariaLabel}
      className="rounded-lg border border-warning-border bg-warning-surface px-4 py-3 text-sm text-warning-foreground"
    >
      <p className="font-medium">{t.disclaimer.title}</p>
      <p className="mt-1 leading-relaxed">{t.disclaimer.body}</p>
    </aside>
  );
}
