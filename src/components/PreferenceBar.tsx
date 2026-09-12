import type { Dictionary } from "../lib/i18n/dictionaries";
import type { Locale } from "../lib/i18n/locales";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { ThemeToggle } from "./ThemeToggle";

/** Language and theme controls, shown on every page. */
export function PreferenceBar({ locale, t }: { locale: Locale; t: Dictionary }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-3">
      <LocaleSwitcher current={locale} label={t.preferences.languageLabel} />
      <ThemeToggle
        label={t.preferences.themeLabel}
        optionLabels={{
          system: t.preferences.themeSystem,
          light: t.preferences.themeLight,
          dark: t.preferences.themeDark,
        }}
      />
    </div>
  );
}
