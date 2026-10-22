import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { LLMProvider, Finding, StructuredRequest, StructuredResult, CompletionRequest, CompletionResult, ModelInfo } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { EVAL_GOLD_CASES } from '../src/db/seed-eval.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import type { FastifyInstance } from 'fastify';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[evals] Docker not available — skipping integration tests.');
}

/**
 * Eval pipeline it-lane (AC-12/13/14/15/25/28/29/33/34/38/39/10/36/37).
 *
 * The LLM is mocked on the `overrides.llm.openrouter` slot — the provider the
 * REGISTRY default names and the SEEDED agents use (INSIGHT 2026-10-03), so an
 * unoverridden resolve would put a live billed call into the lane. The mock is
 * SCRIPTED BY PROMPT CONTENT: a rule list maps diff markers to findings, so
 * must_find cases pass, clean cases stay clean, and the flag toggles move the
 * metrics deterministically. Cost is always null (AC-33 passthrough).
 */

/** A minimal grounded Finding at (file, lines). */
function findingFixture(file: string, startLine: number, endLine: number): Finding {
  return {
    id: `mock-${file}-${startLine}`,
    severity: 'WARNING',
    category: 'security',
    title: `scripted finding at ${file}:${startLine}`,
    file,
    start_line: startLine,
    end_line: endLine,
    rationale: 'scripted by the eval it-suite mock',
    confidence: 0.95,
  };
}

/** [prompt regex, cited file, start, end] — regexes match the CASE DIFF text. */
const RULES: [RegExp, string, number, number][] = [
  [/sk_live_/, 'src/config.ts', 10, 12],
  [/console\.log\('issued session'/, 'src/auth/session.ts', 13, 14],
  [/WHERE email = '" \+ term \+ "'/, 'src/api/search.ts', 4, 4],
  [/axios\.post\(target/, 'src/integrations/webhook.ts', 6, 7],
  [/'\/debug\/env'/, 'src/api/admin.ts', 3, 5],
  [/createHash\('md5'\)/, 'src/auth/passwords.ts', 4, 5],
];

class ScriptedEvalLLM implements LLMProvider {
  public calls = 0;
  /** When true the model reports zero findings everywhere (metric mover). */
  public silent = false;
  /** When true the model re-flags the DISMISSED N+1 region (must_not_flag violation). */
  public flagDismissedN1 = false;

  async listModels(): Promise<ModelInfo[]> {
    return [];
  }

  async complete(_req: CompletionRequest): Promise<CompletionResult> {
    throw new Error('complete() not used by the eval pipeline');
  }

  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls++;
    if (req.schemaName !== 'Review') throw new Error(`unexpected schema ${req.schemaName}`);
    const prompt = req.messages.map((m) => m.content).join('\n');
    const findings: Finding[] = [];
    if (!this.silent) {
      for (const [re, file, start, end] of RULES) {
        if (re.test(prompt)) findings.push(findingFixture(file, start, end));
      }
      if (this.flagDismissedN1 && /maskEmail/.test(prompt)) {
        findings.push(findingFixture('src/api/users.ts', 45, 52));
      }
    }
    const review = { verdict: 'comment', summary: 'scripted review', score: 80, findings };
    return {
      data: review as T,
      model: req.model,
      tokensIn: 10,
      tokensOut: 5,
      costUsd: null, // AC-33: unpriced mock — null must pass through untouched
      raw: JSON.stringify(review),
      attempts: 1,
    };
  }
}

const gold = (name: string) => EVAL_GOLD_CASES.find((c) => c.name === name)!;

const PATCHLESS_DIFF = 'diff --git a/src/x.ts b/src/x.ts\n--- a/src/x.ts\n+++ b/src/x.ts\n';

d('eval pipeline (Testcontainers pg)', () => {
  let pg: PgFixture;
  let db: PgFixture['handle']['db'];
  let llm: ScriptedEvalLLM;
  let securityAgentId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    db = pg.handle.db;
    llm = new ScriptedEvalLLM();
    const workspaceId = await currentWorkspaceId();
    const [agent] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'Security Reviewer')));
    securityAgentId = agent!.id;
  });

  afterAll(async () => {
    await pg?.stop();
  });

  async function currentWorkspaceId(): Promise<string> {
    const [ws] = await db.select().from(t.workspaces).where(eq(t.workspaces.name, 'default'));
    return ws!.id;
  }

  async function makeApp(): Promise<FastifyInstance> {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        llm: { openrouter: llm },
        git: new MockGitClient(),
        github: new MockGitHubClient(),
      },
    });
  }

  /** Create a throwaway agent over HTTP and return its id. */
  async function createAgent(app: FastifyInstance, name: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name, provider: 'openrouter', model: 'test/model', system_prompt: 'Review the diff.' },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }

  async function createCase(app: FastifyInstance, agentId: string, body: object): Promise<Record<string, unknown>> {
    const res = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-cases`, payload: body });
    expect(res.statusCode).toBe(201);
    return res.json() as Record<string, unknown>;
  }

  function goldBody(name: string, over: Record<string, unknown> = {}): object {
    const g = gold(name);
    return {
      name: g.name,
      input_diff: g.diff,
      input_meta: { title: g.title, body: g.body },
      expected_output: g.expectedOutput,
      ...over,
    };
  }

  async function runSweep(app: FastifyInstance, agentId: string): Promise<Record<string, unknown>> {
    const res = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` });
    expect(res.statusCode).toBe(200);
    return res.json() as Record<string, unknown>;
  }

  async function runCountForCase(caseId: string): Promise<number> {
    const rows = await db.select().from(t.evalRuns).where(eq(t.evalRuns.caseId, caseId));
    return rows.length;
  }

  // ---- Task 7 — seed gold set (AC-34) -------------------------------------

  d('seed gold set', () => {
    it('seeds ≥8 Security-Reviewer cases with all three expectation kinds', async () => {
      const app = await makeApp();
      const res = await app.inject({ method: 'GET', url: `/agents/${securityAgentId}/eval-cases` });
      expect(res.statusCode).toBe(200);
      const cases = res.json() as Record<string, unknown>[];
      expect(cases.length).toBeGreaterThanOrEqual(8);
      const byName = new Map(cases.map((c) => [c.name as string, c]));
      const mustFind = byName.get('hardcoded-stripe-key')!;
      expect((mustFind.expected_output as { must_find: unknown[] }).must_find).toHaveLength(1);
      const mustNotFlag = byName.get('users-list-n1-untouched')!;
      expect((mustNotFlag.expected_output as { must_not_flag: unknown[] }).must_not_flag).toHaveLength(1);
      const clean = byName.get('slugify-refactor-clean')!;
      expect(Object.keys(clean.expected_output as object)).toHaveLength(0);
      // every case carries { title, body } meta + a FULL diff (headers + hunks)
      for (const c of cases) {
        expect((c.input_meta as { title: string; body: string }).title).toBeTruthy();
        expect(c.input_diff as string).toMatch(/^diff --git /);
        expect(c.input_diff as string).toContain('@@');
      }
      await app.close();
    });

    it('decides the two PR-#482 seed findings (accept + dismiss) exactly once', async () => {
      const [stripe] = await db
        .select()
        .from(t.findings)
        .where(and(eq(t.findings.file, 'src/config.ts'), eq(t.findings.startLine, 12)));
      expect(stripe!.acceptedAt).not.toBeNull();
      const [n1] = await db
        .select()
        .from(t.findings)
        .where(and(eq(t.findings.file, 'src/api/users.ts'), eq(t.findings.startLine, 45)));
      expect(n1!.dismissedAt).not.toBeNull();
      expect(n1!.acceptedAt).toBeNull();
    });

    it('re-seeding is a no-op (stable counts + untouched decisions)', async () => {
      const before = await db.select().from(t.evalCases).where(eq(t.evalCases.ownerId, securityAgentId));
      await seed(pg.handle.db);
      const after = await db.select().from(t.evalCases).where(eq(t.evalCases.ownerId, securityAgentId));
      expect(after.length).toBe(before.length);
      expect(after.length).toBeGreaterThanOrEqual(8);
    });

    it('does not decide an identical finding from a different review', async () => {
      const workspaceId = await currentWorkspaceId();
      const [pr] = await db.select().from(t.pullRequests).where(eq(t.pullRequests.number, 482));
      const [review] = await db.insert(t.reviews).values({
        workspaceId,
        prId: pr!.id,
        kind: 'review',
        model: 'manual',
      }).returning();
      try {
        const [finding] = await db.insert(t.findings).values({
          reviewId: review!.id,
          file: 'src/config.ts',
          startLine: 12,
          endLine: 12,
          severity: 'CRITICAL',
          category: 'security',
          title: 'Hardcoded Stripe secret key in commit',
          rationale: 'Independent review of the same line.',
          confidence: 0.98,
        }).returning();
        await seed(pg.handle.db);
        const [after] = await db.select().from(t.findings).where(eq(t.findings.id, finding!.id));
        expect(after!.acceptedAt).toBeNull();
        expect(after!.dismissedAt).toBeNull();
      } finally {
        await db.delete(t.reviews).where(eq(t.reviews.id, review!.id));
      }
    });

    it('the seeded gold set sweeps all-pass under the scripted model', async () => {
      const app = await makeApp();
      const sweep = await runSweep(app, securityAgentId);
      expect(sweep.traces_total).toBe(EVAL_GOLD_CASES.length);
      expect(sweep.traces_passed).toBe(EVAL_GOLD_CASES.length);
      expect(sweep.errored).toBe(0);
      expect(sweep.recall).toBe(1);
      expect(sweep.agent_version).toBe(1);
      await app.close();
    });
  });

  // ---- CRUD + duplicate names ---------------------------------------------

  d('case CRUD', () => {
    it('creates, lists, updates and deletes; duplicate names 409', async () => {
      const app = await makeApp();
      const agentId = await createAgent(app, 'CRUD Agent');
      const body = goldBody('hardcoded-stripe-key');
      const created = await createCase(app, agentId, body);
      expect(created).toMatchObject({ owner_kind: 'agent', owner_id: agentId, name: 'hardcoded-stripe-key' });
      expect(typeof created.id).toBe('string');

      // duplicate name → 409
      const dup = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-cases`, payload: body });
      expect(dup.statusCode).toBe(409);

      // update (rename) → 200, old name freed
      const updated = await app.inject({
        method: 'PUT',
        url: `/agents/${agentId}/eval-cases/${created.id}`,
        payload: goldBody('hardcoded-stripe-key', { name: 'renamed-case' }),
      });
      expect(updated.statusCode).toBe(200);
      expect(updated.json().name).toBe('renamed-case');

      const list = await app.inject({ method: 'GET', url: `/agents/${agentId}/eval-cases` });
      expect(list.json()).toHaveLength(1);

      const del = await app.inject({ method: 'DELETE', url: `/agents/${agentId}/eval-cases/${created.id}` });
      expect(del.statusCode).toBe(200);
      expect(del.json().ok).toBe(true);
      const empty = await app.inject({ method: 'GET', url: `/agents/${agentId}/eval-cases` });
      expect(empty.json()).toHaveLength(0);

      const gone = await app.inject({ method: 'DELETE', url: `/agents/${agentId}/eval-cases/${created.id}` });
      expect(gone.statusCode).toBe(404);
      await app.close();
    });

    it('deleting a case cascades its eval_runs rows (AC-10)', async () => {
      const app = await makeApp();
      const agentId = await createAgent(app, 'Cascade Agent');
      const created = await createCase(app, agentId, goldBody('hardcoded-stripe-key'));
      const run = await app.inject({
        method: 'POST',
        url: `/agents/${agentId}/eval-cases/${created.id}/run`,
      });
      expect(run.statusCode).toBe(200);
      expect(await runCountForCase(created.id as string)).toBe(1);

      await app.inject({ method: 'DELETE', url: `/agents/${agentId}/eval-cases/${created.id}` });
      expect(await runCountForCase(created.id as string)).toBe(0);
      await app.close();
    });
  });

  // ---- validation (AC-36/AC-37) -------------------------------------------

  d('input validation', () => {
    it('rejects patch-less / headers-only diffs with invalid_eval_diff (AC-36)', async () => {
      const app = await makeApp();
      const agentId = await createAgent(app, 'Validation Agent');
      const res = await app.inject({
        method: 'POST',
        url: `/agents/${agentId}/eval-cases`,
        payload: goldBody('hardcoded-stripe-key', { input_diff: PATCHLESS_DIFF }),
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('invalid_eval_diff');
      await app.close();
    });

    it('rejects oversized inputs with invalid_eval_size (AC-37)', async () => {
      const app = await makeApp();
      const agentId = await createAgent(app, 'Size Agent');
      const tooLongName = 'a'.repeat(201);
      const nameRes = await app.inject({
        method: 'POST',
        url: `/agents/${agentId}/eval-cases`,
        payload: goldBody('hardcoded-stripe-key', { name: tooLongName }),
      });
      expect(nameRes.statusCode).toBe(422);
      expect(nameRes.json().error.code).toBe('invalid_eval_size');

      const hugeDiff = gold('hardcoded-stripe-key').diff + '+${' + 'x'.repeat(200_001) + '}\n';
      const diffRes = await app.inject({
        method: 'POST',
        url: `/agents/${agentId}/eval-cases`,
        payload: goldBody('hardcoded-stripe-key', { input_diff: hugeDiff }),
      });
      expect(diffRes.statusCode).toBe(422);
      expect(diffRes.json().error.code).toBe('invalid_eval_size');
      await app.close();
    });

    it('rejects expectation entries without file/range (invalid_eval_expected)', async () => {
      const app = await makeApp();
      const agentId = await createAgent(app, 'Expectation Agent');
      const res = await app.inject({
        method: 'POST',
        url: `/agents/${agentId}/eval-cases`,
        payload: goldBody('hardcoded-stripe-key', {
          expected_output: { must_find: [{ start_line: 10, end_line: 12 }] },
        }),
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('invalid_eval_expected');
      await app.close();
    });

    it('rejects the same invalid diff on draft-run (AC-36 save-or-run)', async () => {
      const app = await makeApp();
      const agentId = await createAgent(app, 'Draft Validation Agent');
      const res = await app.inject({
        method: 'POST',
        url: `/agents/${agentId}/eval-cases/draft-run`,
        payload: goldBody('hardcoded-stripe-key', { input_diff: PATCHLESS_DIFF }),
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('invalid_eval_diff');
      await app.close();
    });
  });

  // ---- draft-run (nothing persisted) ---------------------------------------

  d('draft-run', () => {
    it('scores an unsaved case and persists NOTHING (AC-3/AC-6)', async () => {
      const app = await makeApp();
      const agentId = await createAgent(app, 'Draft Agent');
      const before = await db.select().from(t.evalCases).where(eq(t.evalCases.ownerId, agentId));
      expect(before).toHaveLength(0);

      const res = await app.inject({
        method: 'POST',
        url: `/agents/${agentId}/eval-cases/draft-run`,
        payload: goldBody('hardcoded-stripe-key'),
      });
      expect(res.statusCode).toBe(200);
      const result = res.json().result;
      expect(result.recall).toBe(1);
      expect(result.traces_total).toBe(1);
      expect(result.traces_passed).toBe(1);
      // The single trace is a full EvalTrace (case_id/metrics/error survive
      // serialization); the draft envelope rides inside `actual` (z.unknown()).
      expect(result.per_trace[0].actual.error).toBeNull();
      expect(result.cost_usd).toBeNull();

      const after = await db.select().from(t.evalCases).where(eq(t.evalCases.ownerId, agentId));
      expect(after).toHaveLength(0);
      // no run row may reference this agent either (the envelope carries agent_id)
      const runs = await db.select().from(t.evalRuns);
      expect(
        runs.filter((r) => (r.actualOutput as { agent_id?: string } | null)?.agent_id === agentId),
      ).toHaveLength(0);
      expect(before).toHaveLength(0);
      await app.close();
    });
  });

  // ---- sweeps: envelope, grouping, continue-on-error, empty ------------------

  d('sweeps', () => {
    it('persists one row per case with an identical sweep_id envelope and the current agent_version (AC-13/AC-14/AC-12)', async () => {
      const app = await makeApp();
      const agentId = await createAgent(app, 'Sweep Agent');
      await createCase(app, agentId, goldBody('hardcoded-stripe-key'));
      await createCase(app, agentId, goldBody('slugify-refactor-clean'));
      await createCase(app, agentId, goldBody('users-list-n1-untouched'));

      const sweep = await runSweep(app, agentId);
      expect(sweep.traces_total).toBe(3);
      expect(sweep.traces_passed).toBe(3);
      expect(sweep.errored).toBe(0);
      expect(typeof sweep.sweep_id).toBe('string');

      const rows = await db
        .select({ run: t.evalRuns, case: t.evalCases })
        .from(t.evalRuns)
        .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
        .where(eq(t.evalCases.ownerId, agentId));
      expect(rows).toHaveLength(3);
      const sweepIds = new Set(
        rows.map((r) => (r.run.actualOutput as { sweep_id: string }).sweep_id),
      );
      expect(sweepIds.size).toBe(1);
      expect([...sweepIds][0]).toBe(sweep.sweep_id);
      expect(
        rows.every(
          (r) => (r.run.actualOutput as { agent_version: number }).agent_version === 1,
        ),
      ).toBe(true);
      // AC-33 — unpriced mock: cost stays null end to end.
      expect(rows.every((r) => r.run.costUsd === null)).toBe(true);
      expect(sweep.cost_usd).toBeNull();

      // history groups the rows into exactly one sweep, newest-first
      const history = await app.inject({ method: 'GET', url: `/agents/${agentId}/eval-runs` });
      expect(history.statusCode).toBe(200);
      const sweeps = history.json();
      expect(sweeps).toHaveLength(1);
      expect(sweeps[0].sweep_id).toBe(sweep.sweep_id);
      expect(sweeps[0].per_trace).toHaveLength(3);
      await app.close();
    });

    it('continues on per-case failure: errored trace counts, averages exclude it (AC-15)', async () => {
      const app = await makeApp();
      const agentId = await createAgent(app, 'Continue Agent');
      const good = await createCase(app, agentId, goldBody('hardcoded-stripe-key'));
      const broken = await createCase(app, agentId, goldBody('slugify-refactor-clean'));
      // Corrupt the STORED diff past validation (create-time validation passed).
      await db
        .update(t.evalCases)
        .set({ inputDiff: PATCHLESS_DIFF })
        .where(eq(t.evalCases.id, broken.id as string));

      const sweep = await runSweep(app, agentId);
      expect(sweep.traces_total).toBe(2);
      expect(sweep.traces_passed).toBe(1);
      expect(sweep.errored).toBe(1);
      const erroredTrace = (sweep.per_trace as { case_id: string; error: string | null; recall: number }[]).find(
        (tr) => tr.case_id === broken.id,
      )!;
      expect(erroredTrace.error).toContain('unified diff');
      expect(erroredTrace.recall).toBe(0);
      // macro-average over the ONE healthy trace only
      expect(sweep.recall).toBe(1);
      expect(good).toBeTruthy();
      await app.close();
    });

    it('an agent with zero cases returns an empty sweep and writes NO rows', async () => {
      const app = await makeApp();
      const agentId = await createAgent(app, 'Empty Agent');
      const sweep = await runSweep(app, agentId);
      expect(sweep.traces_total).toBe(0);
      expect(sweep.per_trace).toHaveLength(0);
      const rows = await db
        .select({ id: t.evalRuns.id })
        .from(t.evalRuns)
        .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
        .where(eq(t.evalCases.ownerId, agentId));
      expect(rows).toHaveLength(0);
      await app.close();
    });

    it('a must_not_flag violation drops precision and fails the case', async () => {
      llm.flagDismissedN1 = true;
      try {
        const app = await makeApp();
        const agentId = await createAgent(app, 'NotFlag Agent');
        await createCase(app, agentId, goldBody('users-list-n1-untouched'));
        const sweep = await runSweep(app, agentId);
        expect(sweep.traces_passed).toBe(0);
        expect(sweep.precision).toBe(0);
        expect((sweep.per_trace as { pass: boolean }[])[0].pass).toBe(false);
        await app.close();
      } finally {
        llm.flagDismissedN1 = false;
      }
    });
  });

  // ---- single-case run ------------------------------------------------------

  d('single-case run', () => {
    it('persists one row, returns its id, and passes cost null through (AC-33)', async () => {
      const app = await makeApp();
      const agentId = await createAgent(app, 'RunCase Agent');
      const created = await createCase(app, agentId, goldBody('hardcoded-stripe-key'));
      const res = await app.inject({
        method: 'POST',
        url: `/agents/${agentId}/eval-cases/${created.id}/run`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.case_id).toBe(created.id);
      const [row] = await db.select().from(t.evalRuns).where(eq(t.evalRuns.id, body.run_id));
      expect(row).toBeDefined();
      expect(row!.pass).toBe(true);
      expect(row!.costUsd).toBeNull();
      expect(body.result.cost_usd).toBeNull();
      expect(body.result.traces_total).toBe(1);
      await app.close();
    });
  });

  // ---- version flow (AC-25) + promote (AC-27–AC-29) --------------------------

  d('versions + promote', () => {
    it('a prompt edit bumps the version and the next sweep records it with moved metrics (AC-25)', async () => {
      const app = await makeApp();
      const agentId = await createAgent(app, 'Versioned Eval Agent');
      await createCase(app, agentId, goldBody('hardcoded-stripe-key'));

      const sweep1 = await runSweep(app, agentId);
      expect(sweep1.agent_version).toBe(1);
      expect(sweep1.recall).toBe(1);

      const put = await app.inject({
        method: 'PUT',
        url: `/agents/${agentId}`,
        payload: { system_prompt: 'Tighter review instructions.' },
      });
      expect(put.json().version).toBe(2);

      llm.silent = true;
      try {
        const sweep2 = await runSweep(app, agentId);
        expect(sweep2.agent_version).toBe(2);
        expect(sweep2.sweep_id).not.toBe(sweep1.sweep_id);
        expect(sweep2.recall).toBe(0);
        expect(sweep2.traces_passed).toBe(0);

        const history = await app.inject({ method: 'GET', url: `/agents/${agentId}/eval-runs` });
        const sweeps = history.json();
        expect(sweeps).toHaveLength(2);
        expect(sweeps[0].sweep_id).toBe(sweep2.sweep_id); // newest first
        expect(sweeps[1].agent_version).toBe(1);
      } finally {
        llm.silent = false;
      }
      await app.close();
    });

    it('promote restores an old config, appends a version, and the next sweep records it (AC-28)', async () => {
      const app = await makeApp();
      const agentId = await createAgent(app, 'Promote Eval Agent');
      await createCase(app, agentId, goldBody('hardcoded-stripe-key'));
      await app.inject({ method: 'PUT', url: `/agents/${agentId}`, payload: { system_prompt: 'Changed.' } });

      const promoted = await app.inject({ method: 'POST', url: `/agents/${agentId}/versions/1/promote` });
      expect(promoted.statusCode).toBe(200);
      const agent = promoted.json();
      expect(agent.system_prompt).toBe('Review the diff.');
      expect(agent.version).toBe(3); // restore is itself recorded (append-only)

      const versions = await app.inject({ method: 'GET', url: `/agents/${agentId}/versions` });
      expect(versions.json().map((v: { version: number }) => v.version)).toEqual([3, 2, 1]);

      const sweep = await runSweep(app, agentId);
      expect(sweep.agent_version).toBe(3);
      await app.close();
    });

    it('promoting the LIVE config is a no-op: same version, no new snapshot (AC-29)', async () => {
      const app = await makeApp();
      const agentId = await createAgent(app, 'Noop Promote Agent');
      const before = await app.inject({ method: 'GET', url: `/agents/${agentId}` });
      const res = await app.inject({
        method: 'POST',
        url: `/agents/${agentId}/versions/${before.json().version}/promote`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().version).toBe(before.json().version);
      const versions = await app.inject({ method: 'GET', url: `/agents/${agentId}/versions` });
      expect(versions.json()).toHaveLength(1);
      await app.close();
    });
  });

  // ---- scoping + orphans (AC-38/AC-39) ---------------------------------------

  d('scoping + orphans', () => {
    it('hides another workspace’s eval data (AC-38)', async () => {
      const app = await makeApp();
      // A SECOND tenant, created directly in the DB (no HTTP path can act as it).
      const [wsB] = await db.insert(t.workspaces).values({ name: `tenant-b-${Date.now()}` }).returning();
      const [agentB] = await db
        .insert(t.agents)
        .values({
          workspaceId: wsB!.id,
          name: 'Tenant B Agent',
          provider: 'openrouter',
          model: 'test/model',
          systemPrompt: 'B',
          enabled: true,
          version: 1,
        })
        .returning();
      await db.insert(t.evalCases).values({
        workspaceId: wsB!.id,
        ownerKind: 'agent',
        ownerId: agentB!.id,
        name: 'foreign-case',
        inputDiff: gold('hardcoded-stripe-key').diff,
        expectedOutput: {},
      });

      const res = await app.inject({ method: 'GET', url: `/agents/${agentB!.id}/eval-cases` });
      expect(res.statusCode).toBe(404);

      const dashboard = await app.inject({ method: 'GET', url: '/eval/dashboard' });
      expect(dashboard.statusCode).toBe(200);
      const body = dashboard.json();
      expect(body.owner_kind).toBeNull();
      expect(JSON.stringify(body.recent_runs)).not.toContain('foreign-case');

      const owners = await app.inject({ method: 'GET', url: '/eval/owners' });
      expect(JSON.stringify(owners.json())).not.toContain('Tenant B Agent');
      await app.close();
    });

    it('a deleted agent’s cases/runs become unreachable from every surface (AC-39)', async () => {
      const app = await makeApp();
      const agentId = await createAgent(app, 'Doomed Eval Agent');
      const created = await createCase(app, agentId, goldBody('hardcoded-stripe-key'));
      await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-cases/${created.id}/run` });

      // The case row itself SURVIVES the agent delete (owner_id has no FK)…
      const del = await app.inject({ method: 'DELETE', url: `/agents/${agentId}` });
      expect(del.statusCode).toBe(200);
      const [orphan] = await db.select().from(t.evalCases).where(eq(t.evalCases.id, created.id as string));
      expect(orphan).toBeDefined();

      // …but no surface serves it.
      const cases = await app.inject({ method: 'GET', url: `/agents/${agentId}/eval-cases` });
      expect(cases.statusCode).toBe(404);
      const runs = await app.inject({ method: 'GET', url: `/agents/${agentId}/eval-runs` });
      expect(runs.statusCode).toBe(404);
      const dashboard = await app.inject({ method: 'GET', url: '/eval/dashboard' });
      expect(JSON.stringify(dashboard.json().recent_runs)).not.toContain(created.id as string);
      const owners = await app.inject({ method: 'GET', url: '/eval/owners' });
      expect(JSON.stringify(owners.json())).not.toContain(agentId);
      await app.close();
    });
  });
});
