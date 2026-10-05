/* hooks/brief.ts — PR Brief queries (the PR Brief feature's client).
   Reading the card costs zero model calls (a plain GET of the cached row);
   generating costs exactly one, so generation is a mutation and its response
   seeds the read cache — the same read/write split as the onboarding tour. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { PrBriefResponse } from "@devdigest/shared";

/** GET /pulls/:id/brief → the cached brief (or the explicit none-state). */
export function usePrBrief(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["brief", prId],
    queryFn: () => api.get<PrBriefResponse>(`/pulls/${prId}/brief`),
    enabled: !!prId,
  });
}

/**
 * Generate (or refresh) the brief. Costs a model call, so it is a mutation,
 * never a query — it must not re-run on a refocus. The response already IS the
 * new read model (`PrBriefResponse`), so it seeds the brief cache directly
 * instead of triggering a refetch. PrId is fixed at hook construction, which
 * also single-flights the client side of concurrent generation (edge 7).
 */
export function useGenerateBrief(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<PrBriefResponse>(`/pulls/${prId}/brief`),
    onSuccess: (data) => {
      qc.setQueryData(["brief", prId], data);
    },
  });
}
