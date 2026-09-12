import "server-only";

import { cookies, headers } from "next/headers";

import { getDictionary, type Dictionary } from "./dictionaries";
import { LOCALE_COOKIE, type Locale, resolveLocale } from "./locales";

/*
 * The language for the request being rendered.
 *
 * Reading a cookie and a header makes a route dynamic, which is why the landing
 * page is no longer statically prerendered. That is the price of rendering in
 * the reader's language on the first paint rather than correcting it afterwards
 * — and a page whose whole job is to be read is worth rendering correctly the
 * first time.
 */

export const getRequestLocale = async (): Promise<Locale> => {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);

  return resolveLocale({
    cookieValue: cookieStore.get(LOCALE_COOKIE)?.value,
    acceptLanguage: headerList.get("accept-language"),
  });
};

/** The language and its strings together, which is what every page needs. */
export const getRequestDictionary = async (): Promise<{
  readonly locale: Locale;
  readonly t: Dictionary;
}> => {
  const locale = await getRequestLocale();

  return { locale, t: getDictionary(locale) };
};
