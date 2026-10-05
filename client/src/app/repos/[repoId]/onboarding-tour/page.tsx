/* Route: /repos/:repoId/onboarding-tour — the Repository Onboarding Tour.
   Renders the repo's single persisted five-section tour (zero model calls on
   read), with TOC/scroll-spy, session-local reading state, Regenerate (an
   explicit model call, rate-limited server-side) and Share link. No collision
   with the repo-less first-run `/onboarding` wizard. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useGenerateOnboardingTour, useOnboardingTour } from "@/lib/hooks";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { useToast } from "@/lib/toast";
import { NO_SECTIONS, SECTION_IDS, SECTION_TITLE_KEYS, SKELETON_CARDS } from "./constants";
import { useScrollSpy } from "./use-scroll-spy";
import { s } from "./styles";
import { TourHeader } from "./_components/TourHeader";
import { TourToc } from "./_components/TourToc";
import { TourSectionCard } from "./_components/TourSectionCard";

export default function OnboardingTourPage() {
  const t = useTranslations("onboarding");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const toast = useToast();

  const tourQuery = useOnboardingTour(repoId);
  const generate = useGenerateOnboardingTour();

  const response = tourQuery.data;
  const tour = response?.tour ?? null;
  const spy = useScrollSpy(tour ? SECTION_IDS : NO_SECTIONS);

  const jumpTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  /** One explicit model call per activation; failure leaves the old tour rendered. */
  const runGenerate = () => {
    generate.mutate(repoId, { onError: () => toast.error(t("actions.regenerateFailed")) });
  };

  const crumb = [{ label: t("crumb") }];
  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        {tourQuery.isLoading && (
          <div style={s.skeletonList}>
            {Array.from({ length: SKELETON_CARDS }, (_, i) => (
              <Skeleton key={i} height={150} />
            ))}
          </div>
        )}

        {tourQuery.isError && (
          <ErrorState title={t("loadError.title")} onRetry={() => tourQuery.refetch()} />
        )}

        {!tourQuery.isLoading && !tourQuery.isError && !tour && (
          <EmptyState
            icon="Map"
            title={t("empty.title")}
            body={t("empty.body")}
            cta={t("empty.cta")}
            onCta={runGenerate}
            ctaLoading={generate.isPending}
          />
        )}

        {tour && response && (
          <>
            <TourHeader
              facts={response.facts}
              generatedAt={response.generated_at}
              generation={tour.generation}
              onRegenerate={runGenerate}
              regenerating={generate.isPending}
            />
            <div style={s.columns}>
              <div style={s.main}>
                {SECTION_IDS.map((id) => (
                  <TourSectionCard
                    key={id}
                    id={id}
                    tour={tour}
                    repoFullName={activeRepo?.full_name}
                    branch={activeRepo?.default_branch}
                  />
                ))}
              </div>
              <aside style={s.rail}>
                <TourToc
                  entries={SECTION_IDS.map((id) => ({ id, title: t(SECTION_TITLE_KEYS[id]) }))}
                  activeId={spy.activeId}
                  readIds={spy.readIds}
                  onJump={jumpTo}
                />
              </aside>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
