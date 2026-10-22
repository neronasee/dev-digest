/* hooks/evals.ts — React Query hooks for the L06 eval pipeline: eval-case CRUD
   + execution (draft-run / single-case run / gold-set sweep), sweep history,
   and the /eval dashboard aggregates. Mirrors the reviews.ts/agents.ts
   patterns; every path below is pinned by server/src/modules/evals/routes.ts. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Agent, AgentVersion } from "@devdigest/shared";
import type {
  EvalCase,
  EvalCaseWriteBody,
  EvalDashboard,
  EvalDraftRunResult,
  EvalOwnerKind,
  EvalOwnerSummary,
  EvalRunResult,
  EvalSweep,
} from "@devdigest/shared";

/** Owner scope for the owner-filtered dashboard (`agent` only in this feature). */
export interface EvalOwnerFilter {
  kind: EvalOwnerKind;
  id: string;
}

const OWNER_SCOPED = ["eval-owners", "eval-dashboard"] as const;

// ---- Eval cases (per agent) -----------------------------------------------

/** An agent's gold set: every eval case owned by it. */
export function useEvalCases(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-cases", agentId],
    queryFn: () => api.get<EvalCase[]>(`/agents/${agentId}/eval-cases`),
    enabled: !!agentId,
  });
}

function useInvalidateEvalReads(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return () => {
    if (agentId) {
      qc.invalidateQueries({ queryKey: ["eval-cases", agentId] });
      qc.invalidateQueries({ queryKey: ["eval-sweeps", agentId] });
    }
    for (const key of OWNER_SCOPED) qc.invalidateQueries({ queryKey: [key] });
  };
}

export function useCreateEvalCase(agentId: string | null | undefined) {
  const invalidate = useInvalidateEvalReads(agentId);
  return useMutation({
    mutationFn: (body: EvalCaseWriteBody) =>
      api.post<EvalCase>(`/agents/${agentId}/eval-cases`, body),
    onSuccess: invalidate,
  });
}

export function useUpdateEvalCase(agentId: string | null | undefined) {
  const invalidate = useInvalidateEvalReads(agentId);
  return useMutation({
    mutationFn: ({ caseId, body }: { caseId: string; body: EvalCaseWriteBody }) =>
      api.put<EvalCase>(`/agents/${agentId}/eval-cases/${caseId}`, body),
    onSuccess: invalidate,
  });
}

/** Deleting a case cascades its eval_runs (server-side) — history refreshes too. */
export function useDeleteEvalCase(agentId: string | null | undefined) {
  const invalidate = useInvalidateEvalReads(agentId);
  return useMutation({
    mutationFn: (caseId: string) =>
      api.del<{ ok: boolean }>(`/agents/${agentId}/eval-cases/${caseId}`),
    onSuccess: invalidate,
  });
}

// ---- Execution ------------------------------------------------------------

/**
 * Draft-run an UNSAVED case body — executes + scores but persists NOTHING
 * (the response type strips trace-only fields; findings/error ride inside
 * `per_trace[0].actual` and are read defensively by callers).
 */
export function useEvalDraftRun(agentId: string | null | undefined) {
  return useMutation({
    mutationFn: (body: EvalCaseWriteBody) =>
      api.post<EvalDraftRunResult>(`/agents/${agentId}/eval-cases/draft-run`, body),
  });
}

/** Run ONE persisted case — persists a single-run row, so history refreshes. */
export function useRunEvalCase(agentId: string | null | undefined) {
  const invalidate = useInvalidateEvalReads(agentId);
  return useMutation({
    mutationFn: (caseId: string) =>
      api.post<EvalRunResult>(`/agents/${agentId}/eval-cases/${caseId}/run`),
    onSuccess: invalidate,
  });
}

/** Run the agent's whole gold set (one sweep; one row per case, same sweep_id). */
export function useRunEvalSweep(agentId: string | null | undefined) {
  const invalidate = useInvalidateEvalReads(agentId);
  return useMutation({
    mutationFn: () => api.post<EvalSweep>(`/agents/${agentId}/eval-runs`),
    onSuccess: invalidate,
  });
}

// ---- Reads ----------------------------------------------------------------

/** Sweep history for one agent, newest-first. */
export function useEvalSweeps(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-sweeps", agentId],
    queryFn: () => api.get<EvalSweep[]>(`/agents/${agentId}/eval-runs`),
    enabled: !!agentId,
  });
}

/** Agents with ≥1 reachable case, each with its latest sweep + trend. */
export function useEvalOwners() {
  return useQuery({
    queryKey: ["eval-owners"],
    queryFn: () => api.get<EvalOwnerSummary[]>("/eval/owners"),
  });
}

/**
 * The eval dashboard aggregate — owner-scoped when `owner` is given,
 * workspace-wide otherwise. `alert` is a comma-joined list of raw metric
 * names (or null).
 */
export function useEvalDashboard(owner?: EvalOwnerFilter) {
  const key = owner ? `${owner.kind}:${owner.id}` : "workspace";
  return useQuery({
    queryKey: ["eval-dashboard", key],
    queryFn: () =>
      api.get<EvalDashboard>(
        owner
          ? `/eval/dashboard?owner_kind=${encodeURIComponent(owner.kind)}&owner_id=${encodeURIComponent(owner.id)}`
          : "/eval/dashboard",
      ),
  });
}

// ---- Agent version snapshots (compare-modal prompt diff + Promote) ---------

/** One config snapshot (`GET /agents/:id/versions/:version`). */
export function useAgentVersion(agentId: string | null | undefined, version: number | null) {
  return useQuery({
    queryKey: ["agent-version", agentId, version],
    queryFn: () => api.get<AgentVersion>(`/agents/${agentId}/versions/${version}`),
    enabled: !!agentId && version != null,
  });
}

/**
 * Promote an old config snapshot back onto the live agent (append-only: the
 * server bumps the version afterwards). Refreshes the agent, its version
 * history, and every eval read (the next sweep records the new version).
 */
export function usePromoteAgentVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, version }: { agentId: string; version: number }) =>
      api.post<Agent>(`/agents/${agentId}/versions/${version}/promote`),
    onSuccess: (agent) => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.invalidateQueries({ queryKey: ["agent", agent.id] });
      qc.invalidateQueries({ queryKey: ["agent-version", agent.id] });
      qc.invalidateQueries({ queryKey: ["eval-sweeps", agent.id] });
      for (const key of OWNER_SCOPED) qc.invalidateQueries({ queryKey: [key] });
    },
  });
}
