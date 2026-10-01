/* hooks/blast.ts — Blast radius + prior-PR history queries (L04's client).
   Both endpoints are plain DB/facade reads; a missing map (empty arrays) is a
   legitimate state the cards render as-is, so the queries keep the default
   retry budget and no 404 special-casing (unlike intent's absent-record 404). */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { BlastRadius, PrHistory } from "@/lib/types";

/** GET /pulls/:id/blast → the grouped blast-radius map (contract shape). */
export function usePrBlastRadius(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["blast", prId],
    queryFn: () => api.get<BlastRadius>(`/pulls/${prId}/blast`),
    enabled: !!prId,
  });
}

/** GET /pulls/:id/history → prior merged PRs touching this PR's files. */
export function usePrHistory(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["pr-history", prId],
    queryFn: () => api.get<PrHistory>(`/pulls/${prId}/history`),
    enabled: !!prId,
  });
}
