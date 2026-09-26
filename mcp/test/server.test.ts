/**
 * server — registration surface over the SDK's in-process handler
 * (`createMcpHandler(() => createServer({ fetchImpl: stub })`), driven by a
 * fetch-shaped JSON-RPC transport: every request is a `new Request(...)` fed
 * to `handler.fetch`. Asserts the five-tool surface, fixed order, read-only
 * hints, the two zero-arg tools, and get-conventions' client-side status/limit
 * filtering. Hermetic — the API is a route stub.
 */
import { describe, expect, it } from 'vitest';
import { createMcpHandler } from '@modelcontextprotocol/server';
import type { McpHttpHandler } from '@modelcontextprotocol/server';
import { createServer } from '../src/index.js';
import type { AgentSummary, ConventionCandidate, Repo } from '@devdigest/shared';

const HANDLER_URL = 'http://127.0.0.1:1/mcp';
let nextId = 0;

interface JsonRpcEnvelope<T> {
  result?: T;
  error?: { code: number; message: string };
}

interface ToolInfo {
  name: string;
  description?: string;
  annotations?: { readOnlyHint?: boolean };
}

interface CallResult {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content?: Array<{ type: string; text: string }>;
}

/** The in-process client transport: one JSON-RPC POST per request. */
async function rpc<T>(handler: McpHttpHandler, method: string, params?: unknown): Promise<JsonRpcEnvelope<T>> {
  const res = await handler.fetch(
    new Request(HANDLER_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++nextId, method, params }),
    }),
  );
  expect(res.status).toBe(200);
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('text/event-stream')) {
    const dataLine = (await res.text()).split('\n').find((l) => l.startsWith('data:'));
    return JSON.parse((dataLine ?? 'data:{}').slice('data:'.length).trim()) as JsonRpcEnvelope<T>;
  }
  return (await res.json()) as JsonRpcEnvelope<T>;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Route-table fetch stub: path → JSON body; unknown paths 404. */
function stubFetch(routes: Record<string, unknown>): typeof fetch {
  return (input) => {
    const path = new URL(String(input)).pathname;
    const body = routes[path];
    if (body === undefined) {
      return Promise.resolve(
        jsonResponse({ error: { code: 'NOT_FOUND', message: `no stub for ${path}` } }, 404),
      );
    }
    return Promise.resolve(jsonResponse(body));
  };
}

const agent: AgentSummary = {
  id: 'agent-1',
  name: 'General',
  description: 'general reviewer',
  provider: 'openai',
  model: 'gpt-4.1',
  system_prompt: 'SECRET SYSTEM PROMPT — must never leave the API',
  output_schema: null,
  enabled: true,
  version: 1,
  strategy: 'single-pass',
  ci_fail_on: 'critical',
  repo_intel: true,
  skill_count: 3,
};

const repo: Repo = {
  id: 'repo-1',
  workspace_id: 'ws-1',
  owner: 'acme',
  name: 'payments-api',
  full_name: 'acme/payments-api',
  default_branch: 'main',
  clone_path: null,
  last_polled_at: null,
  created_by: null,
};

const conventions: ConventionCandidate[] = [
  {
    id: 'c-1',
    repo_id: 'repo-1',
    category: 'naming',
    rule: 'Use kebab-case files',
    rationale: 'observed everywhere',
    evidence_path: 'src/repo-intel/index.ts',
    evidence_line: 1,
    evidence_snippet: 'export {}',
    confidence: 0.9,
    occurrences: 12,
    status: 'pending',
    created_at: '2026-09-01T00:00:00Z',
  },
  {
    id: 'c-2',
    repo_id: 'repo-1',
    category: 'errors',
    rule: 'Wrap route errors in the error envelope',
    rationale: null,
    evidence_path: 'src/platform/errors.ts',
    evidence_line: 3,
    evidence_snippet: 'export function',
    confidence: 0.7,
    occurrences: 5,
    status: 'accepted',
    created_at: '2026-09-02T00:00:00Z',
  },
];

const routes: Record<string, unknown> = {
  '/agents': [agent],
  '/repos': [repo],
  '/repos/repo-1/conventions': conventions,
};

function makeHandler(): McpHttpHandler {
  return createMcpHandler(() => createServer({ fetchImpl: stubFetch(routes) }));
}

async function callTool(handler: McpHttpHandler, name: string, args: Record<string, unknown>) {
  const { result, error } = await rpc<CallResult>(handler, 'tools/call', { name, arguments: args });
  expect(error).toBeUndefined();
  return result!;
}

describe('tool registration surface', () => {
  it('registers exactly five tools, in the fixed order', async () => {
    const { result, error } = await rpc<{ tools: ToolInfo[] }>(makeHandler(), 'tools/list');
    expect(error).toBeUndefined();
    expect(result!.tools.map((t) => t.name)).toEqual([
      'list-agents',
      'run-agent-on-pr',
      'get-findings',
      'get-conventions',
      'get-blast-radius',
    ]);
  });

  it('sets readOnlyHint on the read/stub tools and leaves it absent on run-agent-on-pr', async () => {
    const { result } = await rpc<{ tools: ToolInfo[] }>(makeHandler(), 'tools/list');
    const byName = new Map(result!.tools.map((t) => [t.name, t]));
    for (const name of ['list-agents', 'get-findings', 'get-conventions', 'get-blast-radius']) {
      expect(byName.get(name)?.annotations?.readOnlyHint, name).toBe(true);
    }
    expect(byName.get('run-agent-on-pr')?.annotations?.readOnlyHint).toBeUndefined();
  });
});

describe('zero-arg and simple tools', () => {
  it('list-agents accepts {} and ships skill_count but never system_prompt', async () => {
    const result = await callTool(makeHandler(), 'list-agents', {});
    expect(result.isError).toBeFalsy();
    const agents = (result.structuredContent!.agents as Array<Record<string, unknown>>);
    expect(agents).toHaveLength(1);
    expect(agents[0]!.skill_count).toBe(3);
    expect(JSON.stringify(result.structuredContent)).not.toContain('system_prompt');
    expect(result.content![0]!.text).toBe(JSON.stringify(result.structuredContent));
  });

  it('get-blast-radius accepts {} and returns a non-error not_implemented stub', async () => {
    const result = await callTool(makeHandler(), 'get-blast-radius', {});
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent!.status).toBe('not_implemented');
    expect(String(result.structuredContent!.message)).toContain('L04');
  });

  it('get-conventions filters by triage status client-side', async () => {
    const result = await callTool(makeHandler(), 'get-conventions', {
      repo: 'acme/payments-api',
      status: 'accepted',
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent!.total).toBe(1);
    const rows = result.structuredContent!.conventions as Array<Record<string, unknown>>;
    expect(rows[0]!.rule).toBe('Wrap route errors in the error envelope');
    expect(rows[0]!.status).toBe('accepted');
  });

  it('get-conventions without status returns everything', async () => {
    const result = await callTool(makeHandler(), 'get-conventions', { repo: 'payments-api' });
    expect(result.structuredContent!.total).toBe(2);
    expect(result.structuredContent!.conventions).toHaveLength(2);
    expect(result.structuredContent!.truncated).toBe(false);
  });

  it('get-conventions default limit 10 caps a longer list and sets truncated', async () => {
    const many: ConventionCandidate[] = Array.from({ length: 12 }, (_, i) => ({
      ...conventions[0]!,
      id: `c-${i}`,
      rule: `Rule ${i}`,
    }));
    const handler = createMcpHandler(() =>
      createServer({ fetchImpl: stubFetch({ ...routes, '/repos/repo-1/conventions': many }) }),
    );
    const result = await callTool(handler, 'get-conventions', { repo: 'payments-api' });

    expect(result.structuredContent!.total).toBe(12);
    const rows = result.structuredContent!.conventions as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(10);
    expect(rows[0]).toMatchObject({ rule: 'Rule 0' });
    expect(result.structuredContent!.truncated).toBe(true);
  });

  it('get-conventions honors an explicit limit; truncated clears when all rows fit', async () => {
    const tight = await callTool(makeHandler(), 'get-conventions', { repo: 'payments-api', limit: 1 });
    expect(tight.structuredContent!.total).toBe(2);
    expect(tight.structuredContent!.conventions).toHaveLength(1);
    expect(tight.structuredContent!.truncated).toBe(true);

    const roomy = await callTool(makeHandler(), 'get-conventions', { repo: 'payments-api', limit: 50 });
    expect(roomy.structuredContent!.conventions).toHaveLength(2);
    expect(roomy.structuredContent!.truncated).toBe(false);
  });
});
