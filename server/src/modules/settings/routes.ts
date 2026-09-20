import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  Settings,
  SettingsUpdate,
  ConnTestRequest,
  ConnTestResult,
  SecretsStatus,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { GITHUB_PROVIDER, SECRET_KEY_BY_PROVIDER } from './constants.js';
import { SettingsService } from './service.js';

/**
 * F1 — settings module. Transport layer only: parses requests and delegates
 * the pref reads/writes to SettingsService.
 *   GET  /settings                 → current non-secret prefs
 *   PUT  /settings                 → upsert prefs (key/value rows)
 *   POST /settings/test-connection → test a provider key (OpenAI/Anthropic/GitHub)
 *
 * Secrets are NOT stored here — only non-secret prefs. test-connection reads
 * the key via SecretsProvider and does a cheap live call (listModels / GET user).
 */
export default async function settingsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new SettingsService(container);

  app.get('/settings', { schema: { response: { 200: Settings } } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.get(workspaceId);
  });

  // Which provider keys are configured (booleans only — the values are NEVER
  // returned). Drives the "Configured / Not set" badges in the API Keys panel.
  app.get(
    '/settings/secrets-status',
    { schema: { response: { 200: SecretsStatus } } },
    async (req): Promise<SecretsStatus> => {
      await getContext(container, req);
      const entries = await Promise.all(
        (Object.entries(SECRET_KEY_BY_PROVIDER) as [keyof SecretsStatus, string][]).map(
          async ([provider, key]) => [provider, Boolean(await container.secrets.get(key))] as const,
        ),
      );
      return Object.fromEntries(entries) as SecretsStatus;
    },
  );

  app.put(
    '/settings',
    { schema: { body: SettingsUpdate, response: { 200: Settings } } },
    async (req) => {
      const { workspaceId, userId } = await getContext(container, req);
      return service.update(workspaceId, userId, req.body);
    },
  );

  app.post(
    '/settings/test-connection',
    {
      schema: { body: ConnTestRequest, response: { 200: ConnTestResult } },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req): Promise<ConnTestResult> => {
    const { provider, key } = req.body;
    try {
      // If the UI supplied a key, persist it (BYO key) before testing so the
      // test reflects — and the rest of the app can use — the new value.
      if (key) {
        if (!container.secrets.set) {
          return { provider, ok: false, message: 'Secrets backend is read-only' };
        }
        await container.secrets.set(SECRET_KEY_BY_PROVIDER[provider], key);
        container.invalidateSecretCaches();
      }
      if (provider === GITHUB_PROVIDER) {
        const gh = await container.github();
        const login = await gh.currentLogin();
        return { provider, ok: true, message: `Connected as @${login}` };
      }
      const llm = await container.llm(provider);
      const models = await llm.listModels();
      return { provider, ok: true, message: `OK — ${models.length} models available` };
    } catch (err) {
      return { provider, ok: false, message: (err as Error).message };
    }
  });
}
