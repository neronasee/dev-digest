import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { BlastRadius, PrHistory } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BlastService } from './service.js';

/**
 * L04 — blast module. Transport layer only: parses requests, maps status
 * codes, and delegates all business logic to BlastService.
 *   GET /pulls/:id/blast   → the PR's blast radius mapped from one repo-intel
 *                            facade read + one index-state read (no LLM, no
 *                            clone access, no limits hardcoded here).
 *   GET /pulls/:id/history → prior merged PRs sharing this PR's files, from
 *                            the persisted pr_files overlap (a SEPARATE route
 *                            so both responses stay contract-valid).
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/pulls/:id/blast',
    { schema: { params: IdParams, response: { 200: BlastRadius } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return new BlastService(app.container).forPull(workspaceId, req.params.id, req.log);
    },
  );

  app.get(
    '/pulls/:id/history',
    { schema: { params: IdParams, response: { 200: PrHistory } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return new BlastService(app.container).historyForPull(workspaceId, req.params.id, req.log);
    },
  );
}
