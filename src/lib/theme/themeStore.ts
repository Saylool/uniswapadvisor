import { applyTheme, DEFAULT_THEME, isTheme, THEME_STORAGE_KEY, type Theme } from "./theme";

/*
 * The stored theme, as an external store React can subscribe to.
 *
 * Separate from the component for two reasons. It is the part with actual
 * behaviour — a fallback for blocked storage, and cross-tab propagation — so it
 * is worth testing on its own. And a React component may not reassign a
 * module-level variable, which the blocked-storage fallback has to do; behind a
 * function call that is an ordinary store update rather than a side effect
 * during render.
 */

const listeners = new Set<() => void>();

/**
 * Used only when `localStorage` is unavailable — a private window, or a browser
 * set to block site data. Without it the toggle would recolour the page while
 * still showing the previous option as selected.
 */
let sessionTheme: Theme = DEFAULT_THEME;

/**
 * Subscribes to changes.
 *
 * `storage` fires only in *other* tabs, which is exactly the case worth
 * covering: choosing dark in one tab should not leave the next one light.
 */
export const subscribeToTheme = (onStoreChange: () => void): (() => void) => {
  listeners.add(onStoreChange);
  window.addEventListener("storage", onStoreChange);

  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
};

/** The current choice. A stored value that is not a theme is ignored. */
export const readTheme = (): Theme => {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : DEFAULT_THEME;
  } catch {
    return sessionTheme;
  }
};

/**
 * What the server renders. It cannot see a browser's storage, so it renders the
 * default and React corrects the control right after hydration — by which point
 * the page itself is already the right colour, because the boot script ran
 * before anything painted.
 */
export const readServerTheme = (): Theme => DEFAULT_THEME;

/** Applies a choice, remembers it, and tells every subscriber. */
export const chooseTheme = (
  next: Theme,
  root: { dataset: { theme?: string } },
): void => {
  applyTheme(next, root);

  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Applies now, forgotten on reload. Better than refusing to switch at all.
    sessionTheme = next;
  }

  for (const listener of listeners) listener();
};
