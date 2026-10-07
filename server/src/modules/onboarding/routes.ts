import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { OnboardingTourResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { OnboardingService } from './service.js';

/**
 * Onboarding Tour — transport layer only: validate, resolve the tenancy
 * context, delegate to the service.
 *
 *   GET   /repos/:id/onboarding           → stored tour (or null) + repo facts
 *   POST  /repos/:id/onboarding/generate  → run the generation loop
 *
 * The generate route is a POST because it costs exactly one model call, and it
 * carries a tighter rate limit than the global 120/min (AC-23): three
 * generations per minute per client is plenty for something this expensive.
 */

const RepoParams = z.object({ id: z.string().uuid() });

export default async function onboardingRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new OnboardingService(container);

  app.get(
    '/repos/:id/onboarding',
    { schema: { params: RepoParams, response: { 200: OnboardingTourResponse } } },
    async (req): Promise<OnboardingTourResponse> => {
      const { workspaceId } = await getContext(container, req);
      return service.get(workspaceId, req.params.id, req.log);
    },
  );

  app.post(
    '/repos/:id/onboarding/generate',
    {
      schema: { params: RepoParams, response: { 200: OnboardingTourResponse } },
      config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
    },
    async (req): Promise<OnboardingTourResponse> => {
      const { workspaceId } = await getContext(container, req);
      return service.generate(workspaceId, req.params.id);
    },
  );
}
