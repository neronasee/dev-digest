import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Repo, RepoInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { RepoService } from './service.js';

/** B7 — wire contracts for the refresh/delete acks (no shared contract exists
 *  yet; the client hand-rolls both shapes locally in lib/hooks/core.ts). */
const RefreshAck = z.object({ status: z.literal('refreshing') });
const DeleteAck = z.object({ deleted: z.string() });

/**
 * F1 — repos module. Transport layer only: parses requests, maps status
 * codes, and delegates all business logic to RepoService.
 *   POST   /repos              → add repo (parse URL, persist, enqueue real clone)
 *   GET    /repos              → list repos (workspace-scoped)
 *   POST   /repos/:id/refresh  → re-fetch clone + bump last_polled_at
 *   DELETE /repos/:id          → remove repo
 *
 * The clone runs as a JobRunner job (kind 'clone') — real `git clone` via the
 * GitClient adapter into <cloneDir>/<owner>/<repo>.
 */
export default async function reposRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new RepoService(app.container);

  // Register the clone job handler once.
  service.registerCloneJobHandler();

  app.post(
    '/repos',
    { schema: { body: RepoInput, response: { 200: Repo, 201: Repo } } },
    async (req, reply) => {
      const { workspaceId, userId } = await getContext(app.container, req);
      const { repo, created } = await service.add(workspaceId, userId, req.body.url);
      reply.status(created ? 201 : 200);
      return repo;
    },
  );

  app.get('/repos', { schema: { response: { 200: z.array(Repo) } } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.post(
    '/repos/:id/refresh',
    { schema: { params: IdParams, response: { 200: RefreshAck } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.refresh(workspaceId, req.params.id);
    },
  );

  app.delete(
    '/repos/:id',
    { schema: { params: IdParams, response: { 200: DeleteAck } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      await service.remove(workspaceId, req.params.id);
      return { deleted: req.params.id };
    },
  );
}
