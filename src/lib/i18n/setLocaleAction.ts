"use server";

import { cookies } from "next/headers";

import { isLocale, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE_SECONDS } from "./locales";

/**
 * Remembers an explicit language choice.
 *
 * A Server Action driven by a plain `<form>`, so switching language works with
 * JavaScript disabled — the same reason the pool address form is plain HTML.
 *
 * The submitted value arrives from the network and is checked against the
 * published languages before it is stored. Without that, anything at all could
 * be written into the cookie; it would be rejected on the way back out, but a
 * cookie is a poor place to keep arbitrary text from a stranger.
 *
 * Switching language re-renders the current route, which on a pool page means
 * reading the pool again. That is inherent to rendering language on the server,
 * and the alternative — correcting the language after hydration — shows the
 * wrong one first.
 */
export const setLocale = async (formData: FormData): Promise<void> => {
  const requested = formData.get("locale");
  if (!isLocale(requested)) return;

  const store = await cookies();

  store.set({
    name: LOCALE_COOKIE,
    value: requested,
    maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS,
    path: "/",
    // Nothing in the browser reads this, so keep it out of reach of scripts.
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
};
