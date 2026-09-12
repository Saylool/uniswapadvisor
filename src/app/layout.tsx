import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

import { getRequestDictionary } from "@/lib/i18n/requestLocale";
import { THEME_BOOT_SCRIPT } from "@/lib/theme/theme";

/*
 * Self-hosted rather than fetched from Google Fonts at build time.
 *
 * `next/font/google` downloads the font during `next build`, which makes the
 * build fail outright on any machine or CI runner that cannot reach
 * fonts.googleapis.com — an offline laptop, a locked-down runner, a sandbox
 * behind a proxy the font fetcher does not honour. Committing the files removes
 * that network dependency from the build entirely, and the bytes are served from
 * our own origin at runtime instead of a third party's.
 *
 * These are the variable builds, so one file per family covers the whole
 * 100-900 weight range.
 */
const geistSans = localFont({
  src: "./fonts/Geist-Variable.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
  display: "swap",
});

const geistMono = localFont({
  src: "./fonts/GeistMono-Variable.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getRequestDictionary();

  return { title: t.metadata.title, description: t.metadata.description };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { locale } = await getRequestDictionary();

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      /*
       * The boot script below stamps `data-theme` on this element before React
       * hydrates, so the server's markup and the browser's DOM differ here by
       * design — and React reports that as a hydration error it cannot know is
       * intended. Suppressing it applies to this element's own attributes only,
       * not to anything inside, so nothing else is silenced.
       */
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        {/*
         * First thing in the body, and synchronous, so the stored theme is on
         * the root element before anything paints. Any later — including
         * anywhere React could put it — and a reader who chose dark gets a white
         * flash on every navigation.
         */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        {children}
      </body>
    </html>
  );
}
