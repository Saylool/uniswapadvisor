import { LOCALES, type Locale } from "../lib/i18n/locales";
import { setLocale } from "../lib/i18n/setLocaleAction";

/**
 * Each language is named in itself, never translated.
 *
 * Someone looking for Turkish is looking for the word "Türkçe". Showing them
 * "Turkish" while the interface is in English asks them to already read the
 * language they are trying to switch away from.
 */
const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  tr: "Türkçe",
};

/**
 * One submit button per language, so a choice is a single click and needs no
 * JavaScript — the value rides along with the button rather than a separate
 * control the reader has to confirm.
 */
export function LocaleSwitcher({ current, label }: { current: Locale; label: string }) {
  return (
    <form action={setLocale} className="flex items-center gap-2">
      <span className="text-xs uppercase tracking-widest text-muted">{label}</span>
      <div role="group" aria-label={label} className="flex rounded-md border border-border">
        {LOCALES.map((locale) => (
          <button
            key={locale}
            type="submit"
            name="locale"
            value={locale}
            aria-pressed={locale === current}
            className={`px-2 py-1 text-xs first:rounded-l-md last:rounded-r-md ${
              locale === current ? "bg-surface font-medium text-foreground" : "text-muted"
            }`}
          >
            {LOCALE_NAMES[locale]}
          </button>
        ))}
      </div>
    </form>
  );
}
