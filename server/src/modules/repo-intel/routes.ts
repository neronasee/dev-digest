/**
 * repo-intel HTTP module.
 *
 *   GET  /repos/:id/index-state  → IndexState (always works; degraded on missing data)
 *   POST /repos/:id/resync       → enqueues a RESYNC_JOB_KIND job (202 + job id):
 *                                  fetch latest from origin + incremental reindex.
 *
 * Both routes are tenancy-gated (B12): the repoId is verified against a
 * workspace-scoped `repos` lookup BEFORE the facade is touched — the facade
 * itself stays tenant-agnostic (its job payloads were authorized at enqueue
 * time), so ownership is asserted here, at the transport edge.
 *
 * Job-handler registration lives here: this plugin runs once at app boot and
 * calls `RepoIntelService.registerIndexJobHandlers()` so INDEX/REFRESH jobs
 * enqueued by `repos/service.ts` (after clone / on refresh) have a handler
 * to run against. Mirrors the `RepoService.registerCloneJobHandler()` shape.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { RepoIntelService } from './service.js';
import { RESYNC_JOB_KIND } from './constants.js';
import type { DegradedReason, IndexStatus } from './types.js';

// ---- B7 response schemas (module-local: the IndexState facade contract is a
// TS interface in ./types.ts, not a shared zod schema) ------------------------

/** `as const satisfies` keeps the literal tuples z.enum needs while pinning
 *  them to the facade's TS unions (drift fails the typecheck). */
const INDEX_STATUSES = [
  'full',
  'partial',
  'degraded',
  'failed',
] as const satisfies readonly IndexStatus[];
const DEGRADED_REASONS = [
  'flag_off',
  'index_failed',
  'index_partial',
  'repo_too_large',
  'no_data',
] as const satisfies readonly DegradedReason[];

const IndexStateResponse = z.object({
  repoId: z.string(),
  status: z.enum(INDEX_STATUSES),
  filesIndexed: z.number().int(),
  filesSkipped: z.number().int(),
  durationMs: z.number().int(),
  reason: z.string().optional(),
  lastIndexedSha: z.string(),
  indexerVersion: z.number().int(),
  /** Wire format is ISO — the handler maps the facade's Date before returning. */
  updatedAt: z.string(),
  degraded: z.boolean().optional(),
  degradedReason: z.enum(DEGRADED_REASONS).optional(),
});

/** 202 body: either the enqueued job id, or the degraded no-handler reply. */
const ResyncResponse = z.union([
  z.object({ status: z.literal('accepted'), jobId: z.string() }),
  z.object({
    status: z.literal('accepted'),
    degraded: z.literal(true),
    reason: z.literal('no_handler'),
  }),
]);

export default async function repoIntelRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  // Register the INDEX/REFRESH handlers exactly once at module load. Using a
  // local service here (instead of `container.repoIntel`) is fine — the
  // JobRunner stores the handler closure, not the service instance, and the
  // lazy `container.repoIntel` getter constructs its own service for read
  // calls. Both share the same DB, so behaviour is identical. The B12
  // tenancy gate also runs on this instance: it reads the real `repos` table
  // and must NOT be swappable via a mocked container.repoIntel.
  const service = new RepoIntelService(container);
  service.registerIndexJobHandlers();

  app.get(
    '/repos/:id/index-state',
    { schema: { params: IdParams, response: { 200: IndexStateResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      await service.assertRepoInWorkspace(workspaceId, req.params.id);
      const state = await container.repoIntel.getIndexState(req.params.id);
      return { ...state, updatedAt: state.updatedAt.toISOString() };
    },
  );

  app.post(
    '/repos/:id/resync',
    { schema: { params: IdParams, response: { 202: ResyncResponse } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      // B12 — only a repo of THIS workspace may be resynced.
      await service.assertRepoInWorkspace(workspaceId, req.params.id);
      // 202 even when enqueue fails (no handler / DB hiccup) so the UI can
      // still poll /index-state without an inline error path. The actual
      // outcome shows up in `repo_index_state` once the worker runs.
      let jobId: string | null = null;
      try {
        const job = await container.jobs.enqueue(workspaceId, RESYNC_JOB_KIND, {
          repoId: req.params.id,
        });
        jobId = job.id;
      } catch {
        // swallow — degraded path
      }
      reply.code(202);
      return jobId
        ? ({ status: 'accepted', jobId } as const)
        : ({ status: 'accepted', degraded: true, reason: 'no_handler' } as const);
    },
  );
}
