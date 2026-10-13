import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  EvalCase,
  EvalCaseWriteBody,
  EvalDashboard,
  EvalDraftRunResult,
  EvalOwnerKind,
  EvalOwnerSummary,
  EvalRunResult,
  EvalSweep,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { EvalsService } from './service.js';
import { EVAL_RUN_RATE_LIMIT } from './constants.js';

/**
 * evals module — Transport layer ONLY: zod params/body/response schemas from
 * the shared Task-1 contracts, getContext scoping, then one service call.
 * No SQL (repository.ts) and no adapter access (runner via service) here.
 *
 *   GET    /agents/:id/eval-cases               → EvalCase[]
 *   POST   /agents/:id/eval-cases               → 201 EvalCase
 *   PUT    /agents/:id/eval-cases/:caseId       → EvalCase
 *   DELETE /agents/:id/eval-cases/:caseId       → { ok }
 *   POST   /agents/:id/eval-cases/draft-run     → EvalDraftRunResult  (LLM; rate-limited)
 *   POST   /agents/:id/eval-cases/:caseId/run   → EvalRunResult       (LLM; rate-limited)
 *   POST   /agents/:id/eval-runs                → EvalSweep           (LLM; rate-limited)
 *   GET    /agents/:id/eval-runs                → EvalSweep[]
 *   GET    /eval/owners                         → EvalOwnerSummary[]
 *   GET    /eval/dashboard                      → EvalDashboard
 */

/** `/agents/:id/eval-cases/:caseId` — both uuids. */
const CaseParams = IdParams.extend({ caseId: z.string().uuid() });

/** `{ ok }` delete ack — module-local (no fitting shared contract). */
const DeleteCaseResponse = z.object({ ok: z.boolean() });

/** owner_kind/owner_id must arrive together (both = owner-scoped, neither = workspace). */
const DashboardQuery = z
  .object({
    owner_kind: EvalOwnerKind.optional(),
    owner_id: z.string().uuid().optional(),
  })
  .refine((q) => (q.owner_id === undefined) === (q.owner_kind === undefined), {
    message: 'owner_kind and owner_id must be provided together',
  });

export default async function evalsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new EvalsService(app.container);

  // ---- case CRUD -----------------------------------------------------------

  app.get(
    '/agents/:id/eval-cases',
    { schema: { params: IdParams, response: { 200: z.array(EvalCase) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.listCases(workspaceId, req.params.id);
    },
  );

  app.post(
    '/agents/:id/eval-cases',
    { schema: { params: IdParams, body: EvalCaseWriteBody, response: { 201: EvalCase } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const created = await service.createCase(workspaceId, req.params.id, req.body);
      reply.status(201);
      return created;
    },
  );

  app.put(
    '/agents/:id/eval-cases/:caseId',
    { schema: { params: CaseParams, body: EvalCaseWriteBody, response: { 200: EvalCase } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.updateCase(workspaceId, req.params.id, req.params.caseId, req.body);
    },
  );

  app.delete(
    '/agents/:id/eval-cases/:caseId',
    { schema: { params: CaseParams, response: { 200: DeleteCaseResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const ok = await service.deleteCase(workspaceId, req.params.id, req.params.caseId);
      return { ok };
    },
  );

  // ---- execution (LLM-backed) ----------------------------------------------

  // Draft-run an unsaved body — tight per-route limit: each call is a full LLM
  // review (same discipline as POST /pulls/:id/review).
  app.post(
    '/agents/:id/eval-cases/draft-run',
    {
      schema: { params: IdParams, body: EvalCaseWriteBody, response: { 200: EvalDraftRunResult } },
      config: { rateLimit: EVAL_RUN_RATE_LIMIT },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.draftRun(workspaceId, req.params.id, req.body);
    },
  );

  // Run a saved case — same tight per-route limit: each call is a full LLM
  // review (same discipline as draft-run and POST /pulls/:id/review).
  app.post(
    '/agents/:id/eval-cases/:caseId/run',
    {
      schema: { params: CaseParams, response: { 200: EvalRunResult } },
      config: { rateLimit: EVAL_RUN_RATE_LIMIT },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.runCase(workspaceId, req.params.id, req.params.caseId);
    },
  );

  // The course-mandated gold-set sweep — same tight limit as draft-run.
  app.post(
    '/agents/:id/eval-runs',
    {
      schema: { params: IdParams, response: { 200: EvalSweep } },
      config: { rateLimit: EVAL_RUN_RATE_LIMIT },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.runSweep(workspaceId, req.params.id);
    },
  );

  // ---- reads ---------------------------------------------------------------

  app.get(
    '/agents/:id/eval-runs',
    { schema: { params: IdParams, response: { 200: z.array(EvalSweep) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.listSweeps(workspaceId, req.params.id);
    },
  );

  app.get(
    '/eval/owners',
    { schema: { response: { 200: z.array(EvalOwnerSummary) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.owners(workspaceId);
    },
  );

  app.get(
    '/eval/dashboard',
    { schema: { querystring: DashboardQuery, response: { 200: EvalDashboard } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const { owner_kind: kind, owner_id: id } = req.query;
      return service.dashboard(workspaceId, kind && id ? { kind, id } : undefined);
    },
  );
}
