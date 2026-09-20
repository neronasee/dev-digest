import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { PrCommentInput, PrDetail, PrMeta, PrReviewComment } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { PullsService } from './service.js';

/**
 * F1 — pulls module. Transport layer only (B1): parses requests, maps status
 * codes, and delegates all business logic to PullsService.
 *   GET  /repos/:id/pulls     → PR list — a PURE DB read + rollup (latest
 *                               review score, latest successful round's
 *                               cost/findings). GitHub syncing moved OFF this
 *                               path (B11): a `pulls-sync` job is
 *                               opportunistically enqueued in the background
 *                               when the repo is stale; no token/offline just
 *                               serves the persisted PRs.
 *   GET  /pulls/:id           → full PR detail (diff/files, commits, body);
 *                               refreshes from GitHub when possible, persists,
 *                               falls back to the stored rows offline.
 *   GET  /pulls/:id/comments  → inline review comments (proxied to GitHub)
 *   POST /pulls/:id/comments  → create one inline comment / reply
 *
 * Import is idempotent (unique repo_id+number). Review trigger is MANUAL
 * and owned by A2 — this module only imports/reads.
 */
export default async function pullsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new PullsService(app.container);

  // Register the background-sync job handler once.
  service.registerSyncJobHandler();

  app.get(
    '/repos/:id/pulls',
    { schema: { params: IdParams, response: { 200: z.array(PrMeta) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.list(workspaceId, req.params.id, req.log);
    },
  );

  app.get('/pulls/:id', { schema: { params: IdParams, response: { 200: PrDetail } } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.detail(workspaceId, req.params.id, req.log);
  });

  // ---- Inline review comments (Files changed tab) -------------------------
  // Proxied live to GitHub (no local persistence): GET reflects existing PR
  // comments; POST creates one immediately. Keeps the tab in lock-step with
  // GitHub and avoids a stale local mirror.

  app.get(
    '/pulls/:id/comments',
    { schema: { params: IdParams, response: { 200: z.array(PrReviewComment) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.listComments(workspaceId, req.params.id, req.log);
    },
  );

  app.post(
    '/pulls/:id/comments',
    {
      schema: { params: IdParams, body: PrCommentInput, response: { 200: PrReviewComment } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.createComment(workspaceId, req.params.id, req.body, req.log);
    },
  );
}
