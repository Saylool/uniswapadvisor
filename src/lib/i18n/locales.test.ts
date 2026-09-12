import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCALE,
  isLocale,
  LOCALES,
  negotiateLocale,
  resolveLocale,
} from "./locales";

describe("LOCALES", () => {
  it("publishes English and Turkish, with English as the fallback", () => {
    expect(LOCALES).toEqual(["en", "tr"]);
    expect(DEFAULT_LOCALE).toBe("en");
  });
});

describe("isLocale", () => {
  it("accepts only a language this interface is published in", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("tr")).toBe(true);
    expect(isLocale("de")).toBe(false);
    expect(isLocale("TR")).toBe(false);
    expect(isLocale("")).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale(1)).toBe(false);
  });
});

describe("negotiateLocale", () => {
  it("reads a plain single-language header", () => {
    expect(negotiateLocale("tr")).toBe("tr");
    expect(negotiateLocale("en")).toBe("en");
  });

  it("matches on the primary subtag, so a regional variant still counts", () => {
    // Turkish as spoken in Cyprus is better served Turkish than English.
    expect(negotiateLocale("tr-CY")).toBe("tr");
    expect(negotiateLocale("en-GB")).toBe("en");
  });

  it("honours the quality weights rather than the written order", () => {
    expect(negotiateLocale("en;q=0.5,tr;q=0.9")).toBe("tr");
    expect(negotiateLocale("tr;q=0.2,en;q=0.8")).toBe("en");
  });

  it("keeps the client's own order when weights tie", () => {
    expect(negotiateLocale("tr,en")).toBe("tr");
    expect(negotiateLocale("en,tr")).toBe("en");
    expect(negotiateLocale("tr;q=0.8,en;q=0.8")).toBe("tr");
  });

  it("treats a missing q as the strongest preference", () => {
    // An entry with no weight means 1, which outranks an explicit 0.9.
    expect(negotiateLocale("en;q=0.9,tr")).toBe("tr");
  });

  it("skips a language it does not publish", () => {
    expect(negotiateLocale("de-DE,fr;q=0.9,tr;q=0.8")).toBe("tr");
  });

  it("drops an entry the client explicitly refused", () => {
    // `q=0` means "not this one", so it must not simply rank last.
    expect(negotiateLocale("tr;q=0,en;q=0.5")).toBe("en");
    expect(negotiateLocale("tr;q=0")).toBeNull();
  });

  it("ignores a wildcard, which asks for nothing in particular", () => {
    expect(negotiateLocale("*")).toBeNull();
    expect(negotiateLocale("de,*;q=0.5")).toBeNull();
  });

  it("says nothing rather than guessing when no language matches", () => {
    // `null` lets the caller tell "no preference" from "preferred English".
    expect(negotiateLocale("de-DE,fr")).toBeNull();
    expect(negotiateLocale("")).toBeNull();
    expect(negotiateLocale(null)).toBeNull();
    expect(negotiateLocale(undefined)).toBeNull();
  });

  it("tolerates the spacing and casing real browsers send", () => {
    expect(negotiateLocale("tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7")).toBe("tr");
    // Weights kept explicit on both sides: a bare `en` would carry q=1 and win,
    // which is correct but would make this a test about weights, not spacing.
    expect(negotiateLocale("  TR-tr ;q=0.9 ,  en ;q=0.8 ")).toBe("tr");
  });

  it("does not fail on a header that makes no sense", () => {
    // Arriving from the network, so the answer to nonsense is "no preference".
    for (const header of [";;;", "q=1", "tr;q=abc", "tr;q=5", ",,", "   "]) {
      expect(() => negotiateLocale(header)).not.toThrow();
    }
    expect(negotiateLocale("tr;q=abc")).toBeNull();
    expect(negotiateLocale("tr;q=5")).toBeNull();
  });
});

describe("resolveLocale", () => {
  it("lets an explicit choice win over the browser's preference", () => {
    // Someone who switched to English on a Turkish browser meant it.
    expect(resolveLocale({ cookieValue: "en", acceptLanguage: "tr-TR,tr;q=0.9" })).toBe("en");
    expect(resolveLocale({ cookieValue: "tr", acceptLanguage: "en-US" })).toBe("tr");
  });

  it("falls back to the browser when no choice has been made", () => {
    expect(resolveLocale({ cookieValue: null, acceptLanguage: "tr-TR" })).toBe("tr");
    expect(resolveLocale({ cookieValue: undefined, acceptLanguage: "tr" })).toBe("tr");
  });

  it("ignores a cookie value that is not a published language", () => {
    // A stale or tampered cookie must not take the reader out of the interface.
    expect(resolveLocale({ cookieValue: "de", acceptLanguage: "tr" })).toBe("tr");
    expect(resolveLocale({ cookieValue: "", acceptLanguage: "tr" })).toBe("tr");
  });

  it("falls back to the default when neither says anything usable", () => {
    expect(resolveLocale({ cookieValue: null, acceptLanguage: null })).toBe(DEFAULT_LOCALE);
    expect(resolveLocale({ cookieValue: "de", acceptLanguage: "fr" })).toBe(DEFAULT_LOCALE);
  });
});
