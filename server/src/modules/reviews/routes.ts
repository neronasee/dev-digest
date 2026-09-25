import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  FindingRecord,
  ActiveRunSummary,
  IntentFeedbackInput,
  PrIntentDetail,
  ReviewRecord,
  ReviewRunResponse,
  RunRequest,
  RunSummary,
  RunTrace,
} from '@devdigest/shared';
import type { RunEvent } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ReviewService } from './service.js';

/** RunRequest as a route body schema: every field optional, absent body OK.
 *  Fastify validates an absent request body as `null` (not `undefined`), so
 *  `?? {}` keeps "no body" identical to "empty body" (agentId/all undefined →
 *  resolveTargets decides), matching the old in-handler `req.body ?? {}`. */
const RunRequestBody = z.preprocess((v) => (v ?? {}), RunRequest);

// ---- B7 response schemas (shared contracts where they exist, module-local
// zod otherwise — same precedent as the B5 modules) --------------------------

/** { ok } — the uniform body of the delete/cancel actions (no shared contract). */
const OkResponse = z.object({ ok: z.boolean() });

/** In-flight run row served by GET /pulls/:id/runs/active (no shared contract:
 *  a slim slice of RunSummary without the completion stats). */
/** GET /pulls/:id/reviews — persisted reviews + findings (shared ReviewRecord). */
const ReviewsResponse = z.array(ReviewRecord);

/** POST /findings/:id/(accept|dismiss) — the acted-on finding (shared FindingRecord). */
const FindingActionResponse = z.object({ finding: FindingRecord });

/** GET/POST /pulls/:id/intent, PUT …/intent/feedback — the shared PrIntentDetail. */
const IntentResponse = PrIntentDetail;
/** Handler DTO derived from the SAME schema as `response` (INSIGHTS 2026-09-20). */
type IntentDto = z.infer<typeof IntentResponse>;

/**
 * reviews module.
 *   POST   /pulls/:id/review  {agentId} | {all:true}  → run review(s); returns runs
 *   GET    /runs/:id/events                            → SSE stream of RunEvent (replay-first)
 *   GET    /runs/:id/trace                             → the single-document RunTrace
 *   GET    /pulls/:id/reviews                          → persisted reviews + findings for a PR
 *   POST   /findings/:id/(accept|dismiss)              → finding actions
 *   GET    /pulls/:id/intent                           → the stored PR intent (404 until derived)
 *   POST   /pulls/:id/intent                           → (re-)derive the PR intent now
 *   PUT    /pulls/:id/intent/feedback                  → record correct/incorrect + note
 */
const FINDING_ACTIONS = ['accept', 'dismiss'] as const;
export default async function reviewsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new ReviewService(container);

  // ---- Run a review (manual trigger) -------------------------------
  // Tight per-route limit: each call can fan out to expensive LLM runs.
  app.post(
    '/pulls/:id/review',
    {
      schema: { params: IdParams, body: RunRequestBody, response: { 200: ReviewRunResponse } },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
    const { workspaceId } = await getContext(container, req);
    const targets = await service.resolveTargets(workspaceId, {
      ...(req.body.agentId !== undefined ? { agentId: req.body.agentId } : {}),
      ...(req.body.all !== undefined ? { all: req.body.all } : {}),
    });
    const { runs, reviews } = await service.runReview(
      workspaceId,
      req.params.id,
      targets,
      req.log,
    );
    return { pr_id: req.params.id, runs, reviews };
  });

  // ---- SSE: live run events (replay buffer first, then live; ends on done) -
  // No rate limit: SSE is one long-lived connection, not burst traffic. No
  // `response` schema either: the body is a raw event stream (frames are
  // RunEvent-typed in @devdigest/shared), not a serialized JSON payload.
  app.get(
    '/runs/:id/events',
    { schema: { params: IdParams }, config: { rateLimit: false } },
    async (req, reply) => {
    await getContext(container, req);
    const runId = req.params.id;

    reply.sse(
      (async function* () {
        // Bridge the in-memory RunBus to an async iterator the SSE plugin drains.
        const queue: RunEvent[] = [];
        let resolve: (() => void) | null = null;
        let done = false;

        const unsubscribe = container.runBus.subscribe(runId, (e) => {
          queue.push(e);
          resolve?.();
        });
        const offDone = container.runBus.onDone(runId, () => {
          done = true;
          resolve?.();
        });

        try {
          while (true) {
            if (queue.length === 0) {
              if (done) break;
              await new Promise<void>((r) => (resolve = r));
              resolve = null;
              continue;
            }
            const e = queue.shift()!;
            yield {
              id: String(e.seq),
              event: e.kind,
              data: JSON.stringify(e),
            };
          }
        } finally {
          unsubscribe();
          offDone();
        }
      })(),
    );
  });

  // ---- Active (in-flight) runs for a PR (server source of truth) ----------
  app.get(
    '/pulls/:id/runs/active',
    { schema: { params: IdParams, response: { 200: z.array(ActiveRunSummary) } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.activeRuns(workspaceId, req.params.id);
    },
  );

  // ---- All runs for a PR (any status; the run history, incl. failures) -----
  app.get(
    '/pulls/:id/runs',
    { schema: { params: IdParams, response: { 200: z.array(RunSummary) } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.listRuns(workspaceId, req.params.id);
    },
  );

  // ---- Delete one run from the history (+ its trace) ----------------------
  app.delete(
    '/runs/:id',
    { schema: { params: IdParams, response: { 200: OkResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const ok = await service.deleteRun(workspaceId, req.params.id);
      return { ok };
    },
  );

  // ---- Cancel an in-flight run --------------------------------------------
  // B12 — cancelRun resolves the run as (id, workspaceId) and 404s a foreign
  // run BEFORE any bus event / DB write, so one workspace can't inject a
  // "Cancellation requested" event into another's live stream.
  app.post(
    '/runs/:id/cancel',
    { schema: { params: IdParams, response: { 200: OkResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      await service.cancelRun(workspaceId, req.params.id);
      return { ok: true };
    },
  );

  // ---- Run trace (single document; A5 enriches with multi-agent/stats) ----
  app.get(
    '/runs/:id/trace',
    { schema: { params: IdParams, response: { 200: RunTrace } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const trace = await service.getRunTrace(workspaceId, req.params.id);
      if (!trace) throw new NotFoundError('Run trace not found');
      return trace;
    },
  );

  // ---- Reads --------------------------------------------------------------
  app.get(
    '/pulls/:id/reviews',
    { schema: { params: IdParams, response: { 200: ReviewsResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.reviewsForPull(workspaceId, req.params.id);
    },
  );

  // ---- PR intent (Intent Layer) --------------------------------------------
  // The stored derivation; 404 until a review round (or POST below) derives one.
  app.get(
    '/pulls/:id/intent',
    { schema: { params: IdParams, response: { 200: IntentResponse } } },
    async (req): Promise<IntentDto> => {
      const { workspaceId } = await getContext(container, req);
      return service.getIntent(workspaceId, req.params.id);
    },
  );

  // Manual (re-)derivation. Tight per-route limit: this triggers an LLM call
  // (same discipline as POST /pulls/:id/review; conventions precedent).
  app.post(
    '/pulls/:id/intent',
    {
      schema: { params: IdParams, response: { 200: IntentResponse } },
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (req): Promise<IntentDto> => {
      const { workspaceId } = await getContext(container, req);
      return service.rederiveIntent(workspaceId, req.params.id);
    },
  );

  // Open feedback on the stored classification (correct/incorrect + note).
  app.put(
    '/pulls/:id/intent/feedback',
    { schema: { params: IdParams, body: IntentFeedbackInput, response: { 200: IntentResponse } } },
    async (req): Promise<IntentDto> => {
      const { workspaceId } = await getContext(container, req);
      return service.setIntentFeedback(workspaceId, req.params.id, req.body.verdict, req.body.note);
    },
  );

  // ---- Delete a whole review run (one agent's pass) + its findings --------
  app.delete(
    '/reviews/:id',
    { schema: { params: IdParams, response: { 200: OkResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const ok = await service.deleteReview(workspaceId, req.params.id);
      if (!ok) throw new NotFoundError('Review not found');
      return { ok: true };
    },
  );

  // ---- Finding actions (accept / dismiss) ---------------------------------
  for (const action of FINDING_ACTIONS) {
    app.post(
      `/findings/:id/${action}`,
      { schema: { params: IdParams, response: { 200: FindingActionResponse } } },
      async (req) => {
        const { workspaceId } = await getContext(container, req);
        const result = await service.actOnFinding(workspaceId, req.params.id, action);
        return result;
      },
    );
  }
}
