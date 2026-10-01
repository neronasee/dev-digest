/**
 * tools — the two workflow tools over the in-process SDK handler: the
 * resolver chain and request bodies run-agent-on-pr issues, its wait-then-report
 * result (per-run status + findings summary, run-id scoping, failed-run errors,
 * the wait-timeout fallback note), ResolveError/429 surfacing, and get-findings'
 * client-side filtering, ordering, limit/truncation, and rationale/suggestion
 * trimming. Hermetic (route stub).
 */
import { describe, expect, it } from 'vitest';
import { createMcpHandler } from '@modelcontextprotocol/server';
import type { McpHttpHandler } from '@modelcontextprotocol/server';
import { createServer } from '../src/index.js';
import type {
  AgentSummary,
  FindingRecord,
  PrMeta,
  Repo,
  ReviewRecord,
  ReviewRunResponse,
  RunSummary,
  Severity,
} from '@devdigest/shared';

const HANDLER_URL = 'http://127.0.0.1:1/mcp';
let nextId = 0;

interface CallResult {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content?: Array<{ type: string; text: string }>;
}

async function rpc<T>(handler: McpHttpHandler, method: string, params?: unknown): Promise<{ result?: T; error?: unknown }> {
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
    return JSON.parse((dataLine ?? 'data:{}').slice('data:'.length).trim()) as { result?: T; error?: unknown };
  }
  return (await res.json()) as { result?: T; error?: unknown };
}

/** Route-table stub that records method+path and every POST body.
 *  A route value may be a function — it is re-evaluated per call, so stateful
 *  routes (e.g. /runs flipping running → done across polls) stay expressible. */
function stubFetch(routes: Record<string, unknown>) {
  const calls: string[] = [];
  const posts: Array<{ path: string; body: unknown }> = [];
  const fetchImpl: typeof fetch = (input, init) => {
    const path = new URL(String(input)).pathname;
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    if (init?.method === 'POST') posts.push({ path, body: JSON.parse(String(init.body)) });
    const route = routes[path];
    const body = typeof route === 'function' ? (route as () => unknown)() : route;
    if (body === undefined) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: `no stub for ${path}` } }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    return Promise.resolve(new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }));
  };
  return { calls, posts, fetchImpl };
}

function mkAgent(name: string): AgentSummary {
  return {
    id: `agent-${name.toLowerCase()}`,
    name,
    description: 'd',
    provider: 'openai',
    model: 'gpt-4.1',
    system_prompt: 'p',
    output_schema: null,
    enabled: true,
    version: 1,
    strategy: 'single-pass',
    ci_fail_on: 'critical',
    repo_intel: true,
    skill_count: 0,
  };
}

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

const pull: PrMeta = {
  id: 'pr-482',
  number: 482,
  title: 'feat: smart diff',
  author: 'a',
  branch: 'feat/smart-diff',
  base: 'main',
  head_sha: 'sha',
  additions: 10,
  deletions: 2,
  files_count: 3,
  status: 'open',
  opened_at: null,
  updated_at: null,
};

function mkFinding(id: string, severity: Severity, confidence: number, rationale: string): FindingRecord {
  return {
    id,
    severity,
    category: 'bug',
    title: `finding ${id}`,
    file: `src/${id}.ts`,
    start_line: 1,
    end_line: 2,
    rationale,
    suggestion: `**Fix ${id}**: do the thing`,
    confidence,
    kind: 'finding',
    trifecta_components: null,
    evidence: null,
    review_id: 'rev-x',
    accepted_at: null,
    dismissed_at: null,
  };
}

function mkReview(id: string, runId: string, agentName: string, findings: FindingRecord[]): ReviewRecord {
  return {
    id,
    pr_id: 'pr-482',
    agent_id: `agent-${agentName.toLowerCase()}`,
    run_id: runId,
    agent_name: agentName,
    kind: 'review',
    verdict: 'comment',
    summary: 's',
    score: 70,
    model: 'gpt-4.1',
    grounding: null,
    grounding_dropped: 0,
    blockers: 0,
    created_at: '2026-09-26T00:00:00Z',
    findings,
  };
}

function mkRun(
  runId: string,
  agentName: string,
  status: RunSummary['status'],
  extra?: Partial<RunSummary>,
): RunSummary {
  return {
    run_id: runId,
    agent_id: `agent-${agentName.toLowerCase()}`,
    agent_name: agentName,
    provider: 'openai',
    model: 'gpt-4.1',
    status,
    error: null,
    duration_ms: 1_000,
    tokens_in: 10,
    tokens_out: 20,
    cost_usd: 0.001,
    findings_count: 0,
    grounding: null,
    grounding_dropped: 0,
    ran_at: null,
    started_at: null,
    score: null,
    blockers: null,
    verdict: null,
    ...extra,
  };
}

const runResponse: ReviewRunResponse = {
  pr_id: 'pr-482',
  runs: [{ run_id: 'run-9', agent_id: 'agent-general', agent_name: 'General' }],
  reviews: [],
};

const doneRun = mkRun('run-9', 'General', 'done', { score: 70, verdict: 'comment', findings_count: 2 });
const runReview = mkReview('rev-9', 'run-9', 'General', [
  mkFinding('f1', 'CRITICAL', 0.9, 'first line of the story\nsecond line never shown'),
  mkFinding('f2', 'WARNING', 0.7, 'plain warning'),
]);

const baseRoutes: Record<string, unknown> = {
  '/repos': [repo],
  '/repos/repo-1/pulls': [pull],
  '/agents': [mkAgent('General'), mkAgent('Security')],
  '/pulls/pr-482/review': runResponse,
  '/pulls/pr-482/runs': [doneRun],
  '/pulls/pr-482/reviews': [runReview],
};

function handlerWith(routes: Record<string, unknown>): { handler: McpHttpHandler; stub: ReturnType<typeof stubFetch> } {
  const stub = stubFetch(routes);
  return {
    handler: createMcpHandler(() => createServer({ fetchImpl: stub.fetchImpl, pollIntervalMs: 5 })),
    stub,
  };
}

async function callTool(handler: McpHttpHandler, name: string, args: Record<string, unknown>): Promise<CallResult> {
  const { result, error } = await rpc<CallResult>(handler, 'tools/call', { name, arguments: args });
  expect(error).toBeUndefined();
  return result!;
}

describe('run-agent-on-pr', () => {
  it('resolves repo → PR → agent, POSTs { agentId }, waits, and returns the run result', async () => {
    const { handler, stub } = handlerWith(baseRoutes);
    const result = await callTool(handler, 'run-agent-on-pr', {
      repo: 'acme/payments-api',
      pr_number: 482,
      agent: 'General',
    });

    expect(stub.calls).toEqual([
      'GET /repos',
      'GET /repos/repo-1/pulls',
      'GET /agents',
      'POST /pulls/pr-482/review',
      'GET /pulls/pr-482/runs',
      'GET /pulls/pr-482/reviews',
    ]);
    expect(stub.posts[0]).toEqual({ path: '/pulls/pr-482/review', body: { agentId: 'agent-general' } });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent!;
    expect(sc.repo).toBe('acme/payments-api');
    expect(sc.pr_number).toBe(482);
    const runs = sc.runs as Array<Record<string, unknown>>;
    expect(runs[0]).toEqual({
      run_id: 'run-9',
      agent_name: 'General',
      status: 'done',
      score: 70,
      verdict: 'comment',
      findings_count: 2,
    });
    expect(sc.summary).toEqual({ total: 2, CRITICAL: 1, WARNING: 1, SUGGESTION: 0 });
    const findings = sc.findings as Array<Record<string, unknown>>;
    expect(findings.map((f) => f.title)).toEqual(['finding f1', 'finding f2']);
  });

  it('omitted agent → { all: true } (no /agents call)', async () => {
    const { handler, stub } = handlerWith(baseRoutes);
    await callTool(handler, 'run-agent-on-pr', { repo: 'payments-api', pr_number: 482 });

    expect(stub.calls).toEqual([
      'GET /repos',
      'GET /repos/repo-1/pulls',
      'POST /pulls/pr-482/review',
      'GET /pulls/pr-482/runs',
      'GET /pulls/pr-482/reviews',
    ]);
    expect(stub.posts[0]!.body).toEqual({ all: true });
  });

  it('failed run → status failed with its error, empty findings', async () => {
    const routes = {
      ...baseRoutes,
      '/pulls/pr-482/runs': [mkRun('run-9', 'General', 'failed', { error: 'LLM provider timeout' })],
      '/pulls/pr-482/reviews': [],
    };
    const { handler } = handlerWith(routes);
    const result = await callTool(handler, 'run-agent-on-pr', {
      repo: 'acme/payments-api',
      pr_number: 482,
      agent: 'General',
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent!;
    const runs = sc.runs as Array<Record<string, unknown>>;
    expect(runs[0]).toMatchObject({ run_id: 'run-9', status: 'failed', error: 'LLM provider timeout' });
    expect(sc.summary).toEqual({ total: 0, CRITICAL: 0, WARNING: 0, SUGGESTION: 0 });
    expect(sc.findings).toEqual([]);
  });

  it('findings are scoped to this trigger\'s run ids (an older run\'s review is excluded)', async () => {
    const stale = mkReview('rev-old', 'run-1', 'Security', [mkFinding('f9', 'CRITICAL', 0.99, 'stale critical')]);
    const routes = { ...baseRoutes, '/pulls/pr-482/reviews': [stale, runReview] };
    const { handler } = handlerWith(routes);
    const result = await callTool(handler, 'run-agent-on-pr', {
      repo: 'acme/payments-api',
      pr_number: 482,
      agent: 'General',
    });

    const sc = result.structuredContent!;
    expect(sc.summary).toEqual({ total: 2, CRITICAL: 1, WARNING: 1, SUGGESTION: 0 });
    const findings = sc.findings as Array<Record<string, unknown>>;
    expect(findings.map((f) => f.title)).toEqual(['finding f1', 'finding f2']);
  });

  it('wait budget exceeded → fallback note to poll get-findings (no reviews fetch)', async () => {
    const { handler, stub } = handlerWith({
      ...baseRoutes,
      '/pulls/pr-482/runs': [mkRun('run-9', 'General', 'running')],
    });
    const result = await callTool(handler, 'run-agent-on-pr', {
      repo: 'acme/payments-api',
      pr_number: 482,
      agent: 'General',
      wait_seconds: 1,
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent!;
    const runs = sc.runs as Array<Record<string, unknown>>;
    expect(runs[0]).toEqual({ run_id: 'run-9', agent_name: 'General', status: 'running' });
    expect(sc.note).toBe(
      'Still running after 1s (runs are async). Poll get-findings with run_id for results.',
    );
    expect(stub.calls).not.toContain('GET /pulls/pr-482/reviews');
    expect(stub.calls.filter((c) => c === 'GET /pulls/pr-482/runs').length).toBeGreaterThanOrEqual(2);
  });

  it('returns started run IDs if polling fails after the review was triggered', async () => {
    const { handler, stub } = handlerWith({ ...baseRoutes, '/pulls/pr-482/runs': undefined });
    const result = await callTool(handler, 'run-agent-on-pr', {
      repo: 'acme/payments-api',
      pr_number: 482,
    });

    expect(result.structuredContent?.runs).toEqual(runResponse.runs);
    expect(result.structuredContent?.note).toContain('Poll get-findings with run_id');
    expect(stub.calls).toContain('POST /pulls/pr-482/review');
    expect(stub.calls).toContain('GET /pulls/pr-482/runs');
  });

  it('empty-string agent → schema rejection (never falls through to all-agents)', async () => {
    const { handler, stub } = handlerWith(baseRoutes);
    const { result, error } = await rpc<{ isError?: boolean }>(handler, 'tools/call', {
      name: 'run-agent-on-pr',
      arguments: { repo: 'acme/payments-api', pr_number: 482, agent: '' },
    });
    // Zod rejects at the protocol layer — the handler (and its POST) never runs:
    // the SDK answers with an errored tool result, never a successful all-run.
    expect(result?.isError ?? Boolean(error)).toBe(true);
    expect(stub.calls).toEqual([]);
  });

  it('unknown agent → isError listing candidate names', async () => {
    const { handler } = handlerWith(baseRoutes);
    const result = await callTool(handler, 'run-agent-on-pr', {
      repo: 'acme/payments-api',
      pr_number: 482,
      agent: 'Nope',
    });
    expect(result.isError).toBe(true);
    expect(result.content![0]!.text).toBe('Unknown agent "Nope". Available: General, Security');
  });

  it('429 → isError naming the retry action', async () => {
    const base = stubFetch(baseRoutes);
    const handler = createMcpHandler(() =>
      createServer({
        fetchImpl: (input, init) => {
          if (new URL(String(input)).pathname === '/pulls/pr-482/review') {
            return Promise.resolve(
              new Response(
                JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Too many review triggers' } }),
                { status: 429, headers: { 'content-type': 'application/json' } },
              ),
            );
          }
          return base.fetchImpl(input, init);
        },
      }),
    );
    const result = await callTool(handler, 'run-agent-on-pr', {
      repo: 'acme/payments-api',
      pr_number: 482,
      agent: 'General',
    });
    expect(result.isError).toBe(true);
    expect(result.content![0]!.text).toContain('rate limit: max 10 review triggers/minute — retry in ~1 minute');
    expect(result.content![0]!.text).toContain('Too many review triggers');
  });
});

describe('get-findings', () => {
  const f1 = mkFinding('f1', 'CRITICAL', 0.9, 'first line of the story\nsecond line never shown');
  const f2 = mkFinding('f2', 'WARNING', 0.7, 'plain warning');
  const f3 = mkFinding('f3', 'SUGGESTION', 0.5, 'a style nit');
  const f4 = mkFinding('f4', 'CRITICAL', 0.8, 'another critical');
  const reviewA = mkReview('rev-1', 'run-1', 'General', [f1, f2]);
  const reviewB = mkReview('rev-2', 'run-2', 'Security', [f3, f4]);
  const routes: Record<string, unknown> = {
    ...baseRoutes,
    '/pulls/pr-482/reviews': [reviewA, reviewB],
  };

  it('counts severities over the PR and orders CRITICAL > WARNING > SUGGESTION, confidence desc', async () => {
    const { handler } = handlerWith(routes);
    const result = await callTool(handler, 'get-findings', { repo: 'acme/payments-api', pr_number: 482 });

    expect(result.structuredContent!.summary).toEqual({ total: 4, CRITICAL: 2, WARNING: 1, SUGGESTION: 1 });
    const findings = result.structuredContent!.findings as Array<Record<string, unknown>>;
    expect(findings.map((f) => f.title)).toEqual(['finding f1', 'finding f4', 'finding f2', 'finding f3']);
    const reviews = result.structuredContent!.reviews as Array<Record<string, unknown>>;
    expect(reviews.map((r) => r.run_id)).toEqual(['run-1', 'run-2']);
  });

  it('run_id filter drops other runs', async () => {
    const { handler } = handlerWith(routes);
    const result = await callTool(handler, 'get-findings', {
      repo: 'acme/payments-api',
      pr_number: 482,
      run_id: 'run-1',
    });
    const summary = result.structuredContent!.summary as Record<string, unknown>;
    expect(summary.total).toBe(2);
    const findings = result.structuredContent!.findings as Array<Record<string, unknown>>;
    expect(findings.map((f) => f.title)).toEqual(['finding f1', 'finding f2']);
    const reviews = result.structuredContent!.reviews as Array<Record<string, unknown>>;
    expect(reviews.map((r) => r.run_id)).toEqual(['run-1']);
  });

  it('default limit 10 truncates a larger result set', async () => {
    const many = Array.from({ length: 12 }, (_, i) => mkFinding(`m${i}`, 'WARNING', 0.5, `nit ${i}`));
    const bigRoutes: Record<string, unknown> = {
      ...baseRoutes,
      '/pulls/pr-482/reviews': [mkReview('rev-big', 'run-big', 'General', many)],
    };
    const { handler } = handlerWith(bigRoutes);
    const result = await callTool(handler, 'get-findings', { repo: 'acme/payments-api', pr_number: 482 });

    const findings = result.structuredContent!.findings as unknown[];
    expect(findings).toHaveLength(10);
    expect(result.structuredContent!.truncated).toBe(true);
    expect((result.structuredContent!.summary as Record<string, unknown>).total).toBe(12);
  });

  it('non-verbose rationale: first line only, no newline, ≤ 200 chars; cut rationale sets truncated', async () => {
    const long = `${'a'.repeat(300)}\ntail`;
    const cutRoutes: Record<string, unknown> = {
      ...baseRoutes,
      '/pulls/pr-482/reviews': [mkReview('rev-3', 'run-3', 'General', [mkFinding('long', 'WARNING', 0.9, long)])],
    };
    const { handler } = handlerWith(cutRoutes);
    const result = await callTool(handler, 'get-findings', { repo: 'acme/payments-api', pr_number: 482 });

    const findings = result.structuredContent!.findings as Array<Record<string, unknown>>;
    const rationale = String(findings[0]!.rationale);
    expect(rationale).toBe('a'.repeat(200));
    expect(rationale).not.toContain('\n');
    expect(rationale.length).toBeLessThanOrEqual(200);
    expect(result.structuredContent!.truncated).toBe(true);
    expect('suggestion' in findings[0]!).toBe(false);
  });

  it('non-verbose drops suggestions → truncated flips even when the rationale fits one line', async () => {
    const mk = (suggestion: string | null) =>
      handlerWith({
        ...baseRoutes,
        '/pulls/pr-482/reviews': [
          mkReview('rev-s', 'run-s', 'General', [
            { ...mkFinding('s', 'WARNING', 0.9, 'fits on one line'), suggestion },
          ]),
        ],
      });

    const dropped = await callTool(mk('**Fix s**: do the thing').handler, 'get-findings', {
      repo: 'acme/payments-api',
      pr_number: 482,
    });
    const withSuggestion = dropped.structuredContent!.findings as Array<Record<string, unknown>>;
    expect(withSuggestion[0]!.rationale).toBe('fits on one line'); // rationale NOT cut…
    expect('suggestion' in withSuggestion[0]!).toBe(false); // …but the suggestion was dropped…
    expect(dropped.structuredContent!.truncated).toBe(true); // …so truncated must notice.

    const bare = await callTool(mk(null).handler, 'get-findings', {
      repo: 'acme/payments-api',
      pr_number: 482,
    });
    expect(bare.structuredContent!.truncated).toBe(false); // nothing dropped → not truncated
  });

  it('verbose includes full rationale and suggestion markdown, no cut', async () => {
    const { handler } = handlerWith(routes);
    const result = await callTool(handler, 'get-findings', {
      repo: 'acme/payments-api',
      pr_number: 482,
      verbose: true,
    });

    const findings = result.structuredContent!.findings as Array<Record<string, unknown>>;
    const first = findings[0]!;
    expect(first.rationale).toBe('first line of the story\nsecond line never shown');
    expect(first.suggestion).toBe('**Fix f1**: do the thing');
    expect(result.structuredContent!.truncated).toBe(false);
  });

  it('severity filter narrows the summary and findings', async () => {
    const { handler } = handlerWith(routes);
    const result = await callTool(handler, 'get-findings', {
      repo: 'acme/payments-api',
      pr_number: 482,
      severity: 'CRITICAL',
    });
    expect(result.structuredContent!.summary).toEqual({ total: 2, CRITICAL: 2, WARNING: 0, SUGGESTION: 0 });
    const findings = result.structuredContent!.findings as Array<Record<string, unknown>>;
    expect(findings.map((f) => f.title)).toEqual(['finding f1', 'finding f4']);
  });
});

describe('get-blast-radius', () => {
  const blast = {
    changed_symbols: [
      { name: 'refundPayment', file: 'src/payments/refund.ts', kind: 'function' },
    ],
    downstream: [
      {
        symbol: 'refundPayment',
        callers: [{ name: 'handleRefund', file: 'src/routes/orders.ts', line: 42 }],
        endpoints_affected: ['POST /orders/:id/refund'],
        crons_affected: [],
      },
    ],
    summary: '1 changed symbol(s), 1 downstream caller(s), 1 impacted endpoint(s), 0 impacted cron job(s)',
    degraded: true,
    reason: 'index_partial',
  };
  const routes: Record<string, unknown> = {
    ...baseRoutes,
    '/pulls/pr-482/blast': blast,
  };

  it('resolves repo → PR and passes the BlastRadius payload through unchanged (incl. degraded/reason)', async () => {
    const { handler, stub } = handlerWith(routes);
    const result = await callTool(handler, 'get-blast-radius', {
      repo: 'acme/payments-api',
      pr_number: 482,
    });

    expect(stub.calls).toEqual(['GET /repos', 'GET /repos/repo-1/pulls', 'GET /pulls/pr-482/blast']);
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent!;
    expect(sc.repo).toBe('acme/payments-api');
    expect(sc.pr_number).toBe(482);
    expect(sc.changed_symbols).toEqual(blast.changed_symbols);
    expect(sc.downstream).toEqual(blast.downstream);
    expect(sc.summary).toBe(blast.summary);
    expect(sc.degraded).toBe(true);
    expect(sc.reason).toBe('index_partial');
    // content mirrors structuredContent as JSON text (house pattern).
    expect(JSON.parse(result.content![0]!.text)).toEqual(sc);
  });

  it('unknown PR → isError listing candidates', async () => {
    const { handler } = handlerWith(routes);
    const result = await callTool(handler, 'get-blast-radius', {
      repo: 'acme/payments-api',
      pr_number: 999,
    });
    expect(result.isError).toBe(true);
    expect(result.content![0]!.text).toBe('Unknown PR #999. Available: #482');
  });
});
