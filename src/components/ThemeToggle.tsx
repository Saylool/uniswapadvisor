"use client";

import { useSyncExternalStore } from "react";

import { THEMES, type Theme } from "../lib/theme/theme";
import {
  chooseTheme,
  readServerTheme,
  readTheme,
  subscribeToTheme,
} from "../lib/theme/themeStore";

/*
 * The application's only Client Component.
 *
 * It exists because switching theme must not reach the server: re-rendering the
 * pool page means reading a subgraph and making an `eth_call`, so a
 * server-driven toggle would spend API quota and a rate-limit slot to change a
 * colour. Everything else here stays server-rendered.
 *
 * The stored choice is an external store, so it is read through
 * `useSyncExternalStore` rather than copied into state inside an effect. That is
 * what makes server and browser agree on the first frame — the server renders
 * the default, React re-renders with the real value straight after hydration —
 * and it also means a change made in one tab follows into every other.
 *
 * None of this is what stops the page flashing. The theme is already on the
 * document before anything paints, applied by the boot script in the layout;
 * this component only keeps the control's own state honest.
 */

export function ThemeToggle({
  label,
  optionLabels,
}: {
  label: string;
  optionLabels: Record<Theme, string>;
}) {
  const theme = useSyncExternalStore(subscribeToTheme, readTheme, readServerTheme);

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs uppercase tracking-widest text-muted">{label}</span>
      <div role="group" aria-label={label} className="flex rounded-md border border-border">
        {THEMES.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              chooseTheme(option, document.documentElement);
            }}
            aria-pressed={theme === option}
            className={`px-2 py-1 text-xs first:rounded-l-md last:rounded-r-md ${
              theme === option ? "bg-surface font-medium text-foreground" : "text-muted"
            }`}
          >
            {optionLabels[option]}
          </button>
        ))}
      </div>
    </div>
  );
}
