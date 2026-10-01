/* hooks/intent.ts — PR Intent queries/mutations (the Intent Layer's client).
   Absent intent is a LEGITIMATE state (404 until a review derives one), so the
   query never retries on 404 — the card renders its empty state instead. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import type { IntentFeedbackInput, PrIntentDetail } from "@/lib/types";

/** The stored derivation for a PR. 404 = "not derived yet" (an expected state). */
export function usePrIntent(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["intent", prId],
    queryFn: () => api.get<PrIntentDetail>(`/pulls/${prId}/intent`),
    enabled: !!prId,
    // 404-when-absent must not retry — it will never succeed until a review
    // (or the re-derive action) stores an intent. Transient failures (network,
    // 5xx) keep TanStack Query's default retry budget.
    retry: (_attempt: number, error: unknown) => !(error instanceof ApiError && error.status === 404),
  });
}

/** Manually (re-)derive the PR intent now; refreshes the stored record. */
export function useRederiveIntent(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<PrIntentDetail>(`/pulls/${prId}/intent`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["intent", prId] }),
  });
}

/** Record open feedback (correct/incorrect + optional note) on the intent. */
export function useIntentFeedback(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Pick<IntentFeedbackInput, "verdict"> & Partial<Pick<IntentFeedbackInput, "note">>) =>
      api.put<PrIntentDetail>(`/pulls/${prId}/intent/feedback`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["intent", prId] }),
  });
}
