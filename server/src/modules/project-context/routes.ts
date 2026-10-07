import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ContextAttachment,
  ProjectDocContent,
  ProjectDocList,
  ProjectDocUsage,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { ProjectContextService, type ContextOwnerKind } from './service.js';

/**
 * project-context module. Transport layer only: zod-validated params/body/
 * querystring, delegation to ProjectContextService, 404 mapping via
 * NotFoundError. No logic and no db access live here.
 *
 *   GET  /repos/:id/documents                 → discovered documents (AC-1/AC-3)
 *   POST /repos/:id/documents/rescan          → force a fresh scan (AC-25)
 *   GET  /repos/:id/documents/content?path=   → one document's raw markdown
 *   GET  /repos/:id/documents/usage           → per-path agent adoption counts
 *   GET  /agents/:id/context?repo_id=         → the agent's ordered set
 *   PUT  /agents/:id/context                  → replace the set (AC-4/AC-5/AC-6)
 *   GET  /skills/:id/context?repo_id=         → the skill's ordered set
 *   PUT  /skills/:id/context                  → replace the set (AC-8)
 */

/** `GET …/context` — which repo's attachment set to read. */
const ContextQuery = z.object({ repo_id: z.string().uuid() });

/** `PUT …/context` — whole-set replace with an ordered path list. */
const ContextUpdateBody = z.object({
  repo_id: z.string().uuid(),
  paths: z.array(z.string().min(1)),
});

/** `GET …/documents/content` — the document's repo-relative path. */
const ContentQuery = z.object({ path: z.string().min(1) });

export default async function projectContextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new ProjectContextService(container);

  app.get(
    '/repos/:id/documents',
    { schema: { params: IdParams, response: { 200: ProjectDocList } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.listDocuments(workspaceId, req.params.id);
    },
  );

  app.post(
    '/repos/:id/documents/rescan',
    { schema: { params: IdParams, response: { 200: ProjectDocList } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.rescan(workspaceId, req.params.id);
    },
  );

  app.get(
    '/repos/:id/documents/content',
    { schema: { params: IdParams, querystring: ContentQuery, response: { 200: ProjectDocContent } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.readDocument(workspaceId, req.params.id, req.query.path);
    },
  );

  app.get(
    '/repos/:id/documents/usage',
    { schema: { params: IdParams, response: { 200: z.array(ProjectDocUsage) } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.usage(workspaceId, req.params.id);
    },
  );

  // The same two attachment routes, mounted per owner kind (agent / skill).
  const contextRoutes = async (prefix: '/agents' | '/skills', ownerKind: ContextOwnerKind) => {
    app.get(
      `${prefix}/:id/context`,
      { schema: { params: IdParams, querystring: ContextQuery, response: { 200: ContextAttachment } } },
      async (req) => {
        const { workspaceId } = await getContext(container, req);
        return service.getAttachment(workspaceId, ownerKind, req.params.id, req.query.repo_id);
      },
    );

    app.put(
      `${prefix}/:id/context`,
      { schema: { params: IdParams, body: ContextUpdateBody, response: { 200: ContextAttachment } } },
      async (req) => {
        const { workspaceId } = await getContext(container, req);
        return service.setAttachment(
          workspaceId,
          ownerKind,
          req.params.id,
          req.body.repo_id,
          req.body.paths,
        );
      },
    );
  };
  await contextRoutes('/agents', 'agent');
  await contextRoutes('/skills', 'skill');
}
