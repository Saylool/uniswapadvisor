import { describe, expect, it } from "vitest";

import {
  applyTheme,
  DEFAULT_THEME,
  isTheme,
  THEME_BOOT_SCRIPT,
  THEME_STORAGE_KEY,
  THEMES,
} from "./theme";

describe("THEMES", () => {
  it("treats following the system as a choice, and as the default", () => {
    expect(THEMES).toEqual(["system", "light", "dark"]);
    expect(DEFAULT_THEME).toBe("system");
  });
});

describe("isTheme", () => {
  it("accepts only the three choices", () => {
    expect(isTheme("system")).toBe(true);
    expect(isTheme("light")).toBe(true);
    expect(isTheme("dark")).toBe(true);
    expect(isTheme("Dark")).toBe(false);
    expect(isTheme("")).toBe(false);
    expect(isTheme(null)).toBe(false);
  });
});

describe("applyTheme", () => {
  it("stamps an explicit choice on the root", () => {
    const root = { dataset: {} as { theme?: string } };

    applyTheme("dark", root);
    expect(root.dataset.theme).toBe("dark");

    applyTheme("light", root);
    expect(root.dataset.theme).toBe("light");
  });

  it("removes the attribute for system, rather than resolving it", () => {
    // Writing a resolved value would freeze the page at whatever the system was
    // at that moment, so it would stop following a later change.
    const root = { dataset: { theme: "dark" } as { theme?: string } };

    applyTheme("system", root);
    expect(root.dataset.theme).toBeUndefined();
    expect("theme" in root.dataset).toBe(false);
  });
});

/*
 * The boot script ships as a string, so nothing type-checks it. These tests run
 * it for real against stand-ins for the two globals it touches.
 */
describe("THEME_BOOT_SCRIPT", () => {
  const run = (storage: { getItem: (key: string) => string | null }) => {
    const documentElement = { dataset: {} as { theme?: string } };
    const script = new Function("localStorage", "document", THEME_BOOT_SCRIPT);

    script(storage, { documentElement });
    return documentElement.dataset;
  };

  const storing = (value: string | null) => ({
    getItem: (key: string) => (key === THEME_STORAGE_KEY ? value : null),
  });

  it("applies a stored explicit choice", () => {
    expect(run(storing("dark")).theme).toBe("dark");
    expect(run(storing("light")).theme).toBe("light");
  });

  it("leaves the root alone for system, so the media query decides", () => {
    expect(run(storing("system")).theme).toBeUndefined();
    expect(run(storing(null)).theme).toBeUndefined();
  });

  it("ignores a stored value that is not a theme", () => {
    // A stale or hand-edited entry must not put an arbitrary attribute on <html>.
    expect(run(storing("midnight")).theme).toBeUndefined();
    expect(run(storing("")).theme).toBeUndefined();
  });

  it("reads the same key the toggle writes", () => {
    // Interpolated from the constant, so this catches a rename on either side.
    expect(THEME_BOOT_SCRIPT).toContain(JSON.stringify(THEME_STORAGE_KEY));
  });

  it("survives a browser that blocks site data", () => {
    // `localStorage` throws rather than returning null when storage is blocked,
    // and a colour preference is never worth breaking a page over.
    const throwing = {
      getItem: () => {
        throw new Error("The operation is insecure.");
      },
    };

    expect(() => run(throwing)).not.toThrow();
    expect(run(throwing).theme).toBeUndefined();
  });
});
