/**
 * api-client — the fetch discipline and error normalization every MCP tool
 * leans on: content-type ONLY with a body, the `{ error: {...} }` envelope →
 * ApiClientError, and network rejection → the status-0 "is dev.sh running"
 * message. No sockets: fetch is always a stub.
 */
import { describe, expect, it } from 'vitest';
import { ApiClientError, apiRequest, createApiClient } from '../src/api-client.js';
import type { AgentSummary } from '@devdigest/shared';

const BASE = 'http://127.0.0.1:3999';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Stub fetch that records every (url, init) pair it receives. */
function recordingStub(respond: () => Response) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImpl: typeof fetch = (input, init) => {
    calls.push({ url: String(input), init });
    return Promise.resolve(respond());
  };
  return { calls, fetchImpl };
}

function headersOf(call: { init: RequestInit | undefined }): Record<string, string> {
  return (call.init?.headers ?? {}) as Record<string, string>;
}

describe('header discipline', () => {
  it('POST without a body sends NO content-type header', async () => {
    const { calls, fetchImpl } = recordingStub(() => jsonResponse({}));
    await apiRequest({ baseUrl: BASE, fetchImpl }, '/repos', { method: 'POST' });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.init?.method).toBe('POST');
    expect(calls[0]!.init?.body).toBeUndefined();
    expect('content-type' in headersOf(calls[0]!)).toBe(false);
  });

  it('POST with a body (runReview) declares content-type and sends the JSON body', async () => {
    const { calls, fetchImpl } = recordingStub(() =>
      jsonResponse({ pr_id: 'pr-1', runs: [], reviews: [] }),
    );
    const client = createApiClient({ baseUrl: BASE, fetchImpl });
    await client.runReview('pr-1', { agentId: 'agent-1' });

    expect(calls[0]!.url).toBe(`${BASE}/pulls/pr-1/review`);
    expect(headersOf(calls[0]!)['content-type']).toBe('application/json');
    expect(calls[0]!.init?.body).toBe(JSON.stringify({ agentId: 'agent-1' }));
  });

  it('GET requests send no content-type header', async () => {
    const { calls, fetchImpl } = recordingStub(() => jsonResponse([]));
    const client = createApiClient({ baseUrl: BASE, fetchImpl });
    await client.listRepos();

    expect(calls[0]!.url).toBe(`${BASE}/repos`);
    expect('content-type' in headersOf(calls[0]!)).toBe(false);
  });
});

describe('error normalization', () => {
  it('non-OK with the error envelope → ApiClientError carrying code/message', async () => {
    const { fetchImpl } = recordingStub(() =>
      jsonResponse({ error: { code: 'NOT_FOUND', message: 'Pull request not found' } }, 404),
    );
    const client = createApiClient({ baseUrl: BASE, fetchImpl });

    const err = await client.listReviews('pr-nope').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    const apiErr = err as ApiClientError;
    expect(apiErr.status).toBe(404);
    expect(apiErr.code).toBe('NOT_FOUND');
    expect(apiErr.message).toBe('Pull request not found');
  });

  it('non-OK with a non-JSON body → falls back to "status statusText"', async () => {
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(new Response('bad gateway', { status: 502, statusText: 'Bad Gateway' }));
    const client = createApiClient({ baseUrl: BASE, fetchImpl });

    const err = await client.listConventions('r-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect((err as ApiClientError).status).toBe(502);
    expect((err as ApiClientError).message).toBe('502 Bad Gateway');
  });

  it('fetch rejection → status 0 with the dev.sh hint', async () => {
    const fetchImpl: typeof fetch = () => Promise.reject(new Error('ECONNREFUSED'));
    const client = createApiClient({ baseUrl: BASE, fetchImpl });

    const err = await client.listAgents().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    const apiErr = err as ApiClientError;
    expect(apiErr.status).toBe(0);
    expect(apiErr.code).toBe('network_error');
    expect(apiErr.message).toBe(
      `Cannot reach the DevDigest API at ${BASE}. Is ./scripts/dev.sh running?`,
    );
  });
});

describe('happy paths', () => {
  it('listAgents → GET /agents, typed payload through', async () => {
    const agent: AgentSummary = {
      id: 'a-1',
      name: 'General',
      description: 'general reviewer',
      provider: 'openai',
      model: 'gpt-4.1',
      system_prompt: 'you review',
      output_schema: null,
      enabled: true,
      version: 1,
      strategy: 'single-pass',
      ci_fail_on: 'critical',
      repo_intel: true,
      skill_count: 2,
    };
    const { calls, fetchImpl } = recordingStub(() => jsonResponse([agent]));
    const client = createApiClient({ baseUrl: BASE, fetchImpl });

    const agents = await client.listAgents();
    expect(calls[0]!.url).toBe(`${BASE}/agents`);
    expect(agents).toEqual([agent]);
  });
});
