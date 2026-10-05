/* hooks/project-context.ts — React Query hooks for the Project Context folder:
   discovered repo documents (list/content/usage/rescan) and the ordered
   per-(agent|skill, repo) attachment sets. Mirrors hooks/agents.ts conventions:
   attachment saves are whole-set replaces (paths only — never document text). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  ContextAttachment,
  ProjectDocContent,
  ProjectDocList,
  ProjectDocUsage,
} from "@devdigest/shared";

// ---- discovered documents (GET /repos/:id/documents, …/content, …/usage) ----

export function useProjectDocuments(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["project-docs", repoId],
    queryFn: () => api.get<ProjectDocList>(`/repos/${repoId}/documents`),
    enabled: repoId != null,
  });
}

/** One document's raw markdown (preview modal + reader pane). */
export function useProjectDocument(repoId: string | null | undefined, path: string | null) {
  return useQuery({
    queryKey: ["project-doc", repoId, path],
    queryFn: () =>
      api.get<ProjectDocContent>(
        `/repos/${repoId}/documents/content?path=${encodeURIComponent(path!)}`,
      ),
    enabled: repoId != null && path != null,
  });
}

/** Re-scan the repo's clone; the response IS the fresh list (AC-25). */
export function useRescanDocuments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) => api.post<ProjectDocList>(`/repos/${repoId}/documents/rescan`),
    onSuccess: (data) => qc.setQueryData(["project-docs", data.repo_id], data),
  });
}

/** Per-document adoption: how many agents have each path attached for the repo. */
export function useDocumentUsage(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["project-doc-usage", repoId],
    queryFn: () => api.get<ProjectDocUsage[]>(`/repos/${repoId}/documents/usage`),
    enabled: repoId != null,
  });
}

// ---- attachments (GET|PUT /agents/:id/context, /skills/:id/context) ----

export function useAgentContextSet(
  agentId: string | null | undefined,
  repoId: string | null | undefined,
) {
  return useQuery({
    queryKey: ["agent-context", agentId, repoId],
    queryFn: () =>
      api.get<ContextAttachment>(`/agents/${agentId}/context?repo_id=${repoId}`),
    enabled: agentId != null && repoId != null,
  });
}

export function useSkillContextSet(
  skillId: string | null | undefined,
  repoId: string | null | undefined,
) {
  return useQuery({
    queryKey: ["skill-context", skillId, repoId],
    queryFn: () =>
      api.get<ContextAttachment>(`/skills/${skillId}/context?repo_id=${repoId}`),
    enabled: skillId != null && repoId != null,
  });
}

export interface SetContextInput {
  ownerId: string;
  repoId: string;
  /** The FULL ordered path list — whole-set replace (last save wins). */
  paths: string[];
}

export function useSetAgentContext() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ownerId, repoId, paths }: SetContextInput) =>
      api.put<ContextAttachment>(`/agents/${ownerId}/context`, { repo_id: repoId, paths }),
    onSuccess: (data, { ownerId }) => {
      qc.setQueryData(["agent-context", ownerId, data.repo_id], data);
      // The agent's config version was bumped server-side (AC-6) — the list
      // summaries and the editor header both show it.
      qc.invalidateQueries({ queryKey: ["agent-context", ownerId] });
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.invalidateQueries({ queryKey: ["agent", ownerId] });
    },
  });
}

export function useSetSkillContext() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ownerId, repoId, paths }: SetContextInput) =>
      api.put<ContextAttachment>(`/skills/${ownerId}/context`, { repo_id: repoId, paths }),
    onSuccess: (data, { ownerId }) => {
      qc.setQueryData(["skill-context", ownerId, data.repo_id], data);
      // A context change bumps the skill's version and appends a history row
      // server-side (same consequence as a body change).
      qc.invalidateQueries({ queryKey: ["skill-context", ownerId] });
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.invalidateQueries({ queryKey: ["skill", ownerId] });
      qc.invalidateQueries({ queryKey: ["skill-versions", ownerId] });
    },
  });
}
