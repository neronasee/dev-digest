import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { PrBriefResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BriefService } from './service.js';
import type { BriefResponseDto } from './helpers.js';

/**
 * brief — transport layer only: validate, resolve the tenancy context,
 * delegate to the service.
 *
 *   GET  /pulls/:id/brief  → the cached brief (or null) + staleness (no model)
 *   POST /pulls/:id/brief  → run the generation loop (exactly one model call)
 *
 * The POST is rate-limited tighter than the global 120/min (the
 * onboarding-generate precedent): three generations per minute per client is
 * plenty for something that costs a model call.
 */
export default async function briefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new BriefService(container);

  app.get(
    '/pulls/:id/brief',
    { schema: { params: IdParams, response: { 200: PrBriefResponse } } },
    async (req): Promise<BriefResponseDto> => {
      const { workspaceId } = await getContext(container, req);
      return service.get(workspaceId, req.params.id, req.log);
    },
  );

  app.post(
    '/pulls/:id/brief',
    {
      schema: { params: IdParams, response: { 200: PrBriefResponse } },
      config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
    },
    async (req): Promise<BriefResponseDto> => {
      const { workspaceId } = await getContext(container, req);
      return service.generate(workspaceId, req.params.id, req.log);
    },
  );
}
