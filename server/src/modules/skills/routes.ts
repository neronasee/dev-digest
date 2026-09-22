import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  SkillSource,
  SkillSummary,
  SkillType,
  SkillUrlImportPreview,
  SkillVersion,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { SkillsService } from './service.js';
import {
  MAX_SKILL_BODY_CHARS,
  MAX_SKILL_DESCRIPTION_CHARS,
  MAX_SKILL_NAME_CHARS,
} from './constants.js';

/**
 * B7 — every route declares `schema.response` from the shared contracts
 * (`Skill`/`SkillSummary`/`SkillVersion` in contracts/knowledge), so the zod
 * serializerCompiler is live: the handler's return value is safeParse'd and the
 * PARSED data is shipped. One exception has no fitting contract: the delete ack
 * body below stays module-local (mirrors the agents module).
 */
const DeleteSkillResponse = z.object({ ok: z.boolean() });

/**
 * Skills module (Skills Lab).
 *   GET    /skills                → list with agent_count (workspace-scoped)
 *   POST   /skills                → create (source defaults to manual)
 *   POST   /skills/import-url     → fetch + two-level-scan preview (never persists)
 *   GET    /skills/:id            → one skill
 *   PUT    /skills/:id            → update (a changed body creates a new version)
 *   DELETE /skills/:id            → delete (versions + agent links cascade)
 *   GET    /skills/:id/versions   → body history, newest first
 */

const CreateSkillBody = z.object({
  name: z.string().min(1).max(MAX_SKILL_NAME_CHARS),
  description: z.string().max(MAX_SKILL_DESCRIPTION_CHARS).optional(),
  type: SkillType,
  source: SkillSource.optional(),
  body: z.string().min(1).max(MAX_SKILL_BODY_CHARS),
  enabled: z.boolean().optional(),
  evidence_files: z.array(z.string()).optional(),
});

const UpdateSkillBody = z.object({
  name: z.string().min(1).max(MAX_SKILL_NAME_CHARS).optional(),
  description: z.string().max(MAX_SKILL_DESCRIPTION_CHARS).optional(),
  type: SkillType.optional(),
  body: z.string().min(1).max(MAX_SKILL_BODY_CHARS).optional(),
  enabled: z.boolean().optional(),
  evidence_files: z.array(z.string()).optional(),
});

/** Import-from-URL preview input — just the address to fetch and scan. */
const ImportSkillFromUrlBody = z.object({ url: z.string().url() });

export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SkillsService(app.container);

  app.get(
    '/skills',
    { schema: { response: { 200: z.array(SkillSummary) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.list(workspaceId);
    },
  );

  app.post(
    '/skills',
    { schema: { body: CreateSkillBody, response: { 201: SkillSummary } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const body = req.body;
      const skill = await service.create(workspaceId, {
        name: body.name,
        type: body.type,
        body: body.body,
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.source !== undefined ? { source: body.source } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.evidence_files !== undefined ? { evidence_files: body.evidence_files } : {}),
      });
      reply.status(201);
      // Fresh skill: zero links, count it once instead of re-querying.
      return { ...skill, agent_count: 0 };
    },
  );

  // URL-import preview: fetch through the guarded UrlFetcher + run the
  // two-level security scan; a dangerous body never reaches the client (422).
  // Nothing is persisted, so — like POST /settings/test-connection — there is
  // no getContext/workspace here; creation goes through POST /skills with the
  // previewed body (source 'imported_url'). Rate-limited tighter than CRUD:
  // each call is an outbound fetch plus, when a key exists, one LLM scan.
  app.post(
    '/skills/import-url',
    {
      schema: { body: ImportSkillFromUrlBody, response: { 200: SkillUrlImportPreview } },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req) => service.previewUrlImport(req.body.url),
  );

  app.get(
    '/skills/:id',
    { schema: { params: IdParams, response: { 200: SkillSummary } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.get(workspaceId, req.params.id);
      if (!skill) throw new NotFoundError('Skill not found');
      return skill;
    },
  );

  app.put(
    '/skills/:id',
    { schema: { params: IdParams, body: UpdateSkillBody, response: { 200: SkillSummary } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.update(workspaceId, req.params.id, req.body);
      if (!skill) throw new NotFoundError('Skill not found');
      return skill;
    },
  );

  app.delete(
    '/skills/:id',
    { schema: { params: IdParams, response: { 200: DeleteSkillResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const ok = await service.delete(workspaceId, req.params.id);
      if (!ok) throw new NotFoundError('Skill not found');
      return { ok: true };
    },
  );

  app.get(
    '/skills/:id/versions',
    { schema: { params: IdParams, response: { 200: z.array(SkillVersion) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const versions = await service.listVersions(workspaceId, req.params.id);
      if (!versions) throw new NotFoundError('Skill not found');
      return versions;
    },
  );
}
