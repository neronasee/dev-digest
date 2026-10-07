/* hooks/onboarding.ts — React Query hooks for the Repository Onboarding Tour.
   Reading the page costs zero model calls (a plain GET); generating costs one,
   so generation is a mutation and its response seeds the read cache. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { OnboardingTourResponse } from "@devdigest/shared";

export function useOnboardingTour(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["onboarding", repoId],
    queryFn: () => api.get<OnboardingTourResponse>(`/repos/${repoId}/onboarding`),
    enabled: !!repoId,
  });
}

/**
 * Generate (or regenerate) the tour. Costs a model call, so it is a mutation,
 * never a query — it must not re-run on a refocus. The response already IS the
 * new read model (`OnboardingTourResponse`), so it seeds the tour cache
 * directly instead of triggering a refetch.
 */
export function useGenerateOnboardingTour() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) =>
      api.post<OnboardingTourResponse>(`/repos/${repoId}/onboarding/generate`),
    onSuccess: (data, repoId) => {
      qc.setQueryData(["onboarding", repoId], data);
    },
  });
}
