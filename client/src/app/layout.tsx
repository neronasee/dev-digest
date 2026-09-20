import type { Metadata } from "next";
import { Suspense } from "react";
import { Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";
import { Providers } from "../lib/providers";
import { themeNoFlashScript } from "../lib/theme";

// Inter is loaded (self-hosted at build time) via next/font and exposed as the
// --font-inter CSS variable; globals.css puts it in front of the system-font
// fallback stack. This replaces a dead `src: local("Inter")` @font-face that
// only resolved when the visitor happened to have Inter installed.
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "DevDigest",
  description: "Local-first AI PR review tool",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale} data-theme="dark" data-density="regular" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* set theme before paint to avoid FOUC */}
        <script dangerouslySetInnerHTML={{ __html: themeNoFlashScript }} />
      </head>
      {/* suppressHydrationWarning: browser extensions (Grammarly, translators, …)
          inject attributes like data-gr-ext-installed onto <body> before React
          hydrates. This suppresses ONLY this element's own attribute mismatch
          (one level deep) — real mismatches in descendants are still reported. */}
      <body suppressHydrationWarning>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Suspense fallback={null}>
            <Providers>{children}</Providers>
          </Suspense>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
