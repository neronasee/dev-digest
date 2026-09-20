/* not-found.tsx — root 404 boundary (App Router convention): rendered for URLs
   that match no route. Wrapped in the app shell like every page and styled
   with the vendored EmptyState (same shape as RepoNotFound); "Try again"-style
   recovery is the dashboard CTA, consistent with the error boundaries. */
"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { EmptyState } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";

export default function NotFound() {
  const t = useTranslations("common");
  const router = useRouter();
  return (
    <AppShell crumb={[{ label: t("notFound.title") }]}>
      <EmptyState
        icon="Search"
        title={t("notFound.title")}
        body={t("notFound.body")}
        cta={t("notFound.cta")}
        onCta={() => router.push("/")}
      />
    </AppShell>
  );
}
