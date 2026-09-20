/* error.tsx — root route error boundary (App Router convention). Any render
   error inside a route segment lands here with a Try-again (reset) instead of
   Next's default crash page. The root layout — including the next-intl
   provider and the UI kit's CSS variables — still renders around this
   fallback, so translations and the vendored kit are safe to use here
   (unlike global-error.tsx, which replaces the layout entirely). */
"use client";

import { useTranslations } from "next-intl";
import { ErrorState } from "@devdigest/ui";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("common");
  // Next passes an Error with an optional server-side digest. Access it
  // defensively — this boundary must never throw on an unexpected shape.
  const digest = error instanceof Error ? error.digest : undefined;
  return (
    <ErrorState
      title={t("states.error")}
      body={
        <>
          {t("states.errorBody")}
          {digest ? ` ${t("states.errorDigest", { digest })}` : null}
        </>
      }
      onRetry={reset}
      fullScreen
    />
  );
}
