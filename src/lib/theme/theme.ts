/*
 * The colour theme: what the choices are, where the choice is kept, and the
 * script that applies it before the page paints.
 *
 * "system" is a real choice, not the absence of one. It sets no attribute, which
 * hands the decision back to `prefers-color-scheme` — so a reader who switches
 * their machine to dark at sunset sees this page follow, without touching it.
 */

export const THEMES = ["system", "light", "dark"] as const;

export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = "system";

/**
 * Where the choice is kept.
 *
 * `localStorage` rather than a cookie, because switching theme must not cost a
 * request: on the pool page a re-render means re-reading a subgraph and an
 * `eth_call`, so a cookie would make changing a colour spend API quota and a
 * rate-limit slot.
 */
export const THEME_STORAGE_KEY = "theme";

export const isTheme = (value: unknown): value is Theme =>
  typeof value === "string" && (THEMES as readonly string[]).includes(value);

/**
 * Applies a theme to the document root.
 *
 * "system" removes the attribute rather than writing a resolved value, so the
 * media query is what decides and keeps deciding.
 */
export const applyTheme = (theme: Theme, root: { dataset: { theme?: string } }): void => {
  if (theme === "system") {
    delete root.dataset.theme;
    return;
  }

  root.dataset.theme = theme;
};

/**
 * Runs before the first paint, from the top of `<body>`.
 *
 * Without it the page always paints in the system palette first and corrects
 * itself once React hydrates, which is a white flash for anyone who chose dark.
 * It is deliberately tiny and synchronous for the same reason.
 *
 * Wrapped in try/catch because reading `localStorage` *throws* rather than
 * returning null when a browser blocks site data — and a theme preference is
 * never worth breaking a page over.
 *
 * The key is interpolated from the constant above so the script and the toggle
 * cannot drift apart.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==="dark"||t==="light"){document.documentElement.dataset.theme=t}}catch(e){}})();`;
