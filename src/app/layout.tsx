import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

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

export const metadata: Metadata = {
  title: "Uniswap Strategy Advisor",
  description:
    "An educational AI-assisted advisor for Uniswap v3 and v4 liquidity strategies. Guidance only — not financial advice.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
