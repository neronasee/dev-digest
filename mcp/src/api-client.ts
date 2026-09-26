/* api-client.ts — typed fetch client for the local DevDigest Fastify API
   (default http://127.0.0.1:3001). Modeled on client/src/lib/api.ts: the
   fetch implementation is injectable so MCP tool tests stay hermetic, and
   every failure is normalized to ApiClientError so tool handlers can return
   actionable `isError` text instead of throwing through the MCP layer.

   Contract types come from '@devdigest/shared' as TYPE-ONLY imports — the
   vendored Zod schemas never execute here; responses are trusted casts. */

import type {
  AgentSummary,
  ConventionCandidate,
  PrMeta,
  Repo,
  ReviewRecord,
  ReviewRunResponse,
  RunRequest,
} from '@devdigest/shared';

export class ApiClientError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface ApiClientConfig {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

export interface ApiClient {
  listAgents(): Promise<AgentSummary[]>; // GET /agents
  listRepos(): Promise<Repo[]>; // GET /repos
  listPulls(repoId: string): Promise<PrMeta[]>; // GET /repos/:repoId/pulls
  runReview(prId: string, body: RunRequest): Promise<ReviewRunResponse>; // POST /pulls/:prId/review
  listReviews(prId: string): Promise<ReviewRecord[]>; // GET /pulls/:prId/reviews
  listConventions(repoId: string): Promise<ConventionCandidate[]>; // GET /repos/:repoId/conventions
}

/** The structured API error envelope (see @devdigest/shared ApiErrorBody). */
interface ApiErrorEnvelope {
  error: { code: string; message?: string; details?: unknown };
}

function isErrorEnvelope(body: unknown): body is ApiErrorEnvelope {
  if (typeof body !== 'object' || body === null || !('error' in body)) return false;
  const error = (body as { error: unknown }).error;
  if (typeof error !== 'object' || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return typeof code === 'string' && (message === undefined || typeof message === 'string');
}

/**
 * Single request chokepoint. Exported (like client/src/lib/api.ts's apiFetch)
 * so the header discipline — `content-type: application/json` ONLY when a
 * body is sent — is directly testable with a body-less POST.
 */
export async function apiRequest<T>(
  config: ApiClientConfig,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const fetchImpl = config.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(`${config.baseUrl}${path}`, {
      ...init,
      headers: {
        // Only declare a JSON body when one is actually sent — a body-less
        // POST with content-type application/json trips Fastify 5's
        // "Body cannot be empty" rejection.
        ...(init?.body != null ? { 'content-type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch (e) {
    throw new ApiClientError(
      `Cannot reach the DevDigest API at ${config.baseUrl}. Is ./scripts/dev.sh running?`,
      0,
      'network_error',
      e,
    );
  }

  if (!res.ok) {
    let code: string | undefined;
    let message = `${res.status} ${res.statusText}`;
    let details: unknown;
    try {
      const body: unknown = await res.json();
      if (isErrorEnvelope(body)) {
        code = body.error.code;
        message = body.error.message ?? message;
        details = body.error.details;
      }
    } catch {
      /* non-JSON error body — keep the status fallback */
    }
    throw new ApiClientError(message, res.status, code, details);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  const get = <T>(path: string) => apiRequest<T>(config, path);
  const post = <T>(path: string, body?: unknown) =>
    apiRequest<T>(config, path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  return {
    listAgents: () => get<AgentSummary[]>('/agents'),
    listRepos: () => get<Repo[]>('/repos'),
    listPulls: (repoId) => get<PrMeta[]>(`/repos/${repoId}/pulls`),
    runReview: (prId, body) => post<ReviewRunResponse>(`/pulls/${prId}/review`, body),
    listReviews: (prId) => get<ReviewRecord[]>(`/pulls/${prId}/reviews`),
    listConventions: (repoId) => get<ConventionCandidate[]>(`/repos/${repoId}/conventions`),
  };
}
