import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';

/** B7 — wire contract for the overview (no shared contract exists yet). */
const WorkspaceRepoSummary = z.object({
  id: z.string(),
  full_name: z.string(),
  clone_path: z.string().nullable(),
  last_polled_at: z.string().nullable(),
  cloned: z.boolean(),
});
const WorkspaceSummary = z.object({
  workspaceId: z.string(),
  cloneDir: z.string(),
  repos: z.array(WorkspaceRepoSummary),
});

/**
 * F1 — workspace manager: where clones live + a summary of cloned repos.
 *   GET /workspace        → workspace info + cloneDir + cloned repos summary
 *
 * Transport layer only: the summary query lives in WorkspaceRepository; this
 * maps rows onto the wire shape. Cleanup/re-pull of individual repos is
 * handled by the repos module (refresh/delete); this surface gives the UI an
 * overview.
 */
export default async function workspaceRoutes(app: FastifyInstance) {
  const { container } = app;

  app.get('/workspace', { schema: { response: { 200: WorkspaceSummary } } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const repos = await container.workspaceRepo.listRepoSummaries(workspaceId);
    return {
      workspaceId,
      cloneDir: container.config.cloneDir,
      repos: repos.map((r) => ({
        id: r.id,
        full_name: r.fullName,
        clone_path: r.clonePath,
        last_polled_at: r.lastPolledAt?.toISOString() ?? null,
        cloned: Boolean(r.clonePath),
      })),
    };
  });
}
