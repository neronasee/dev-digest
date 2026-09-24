import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[runs-skills] Docker not available — skipping integration tests.');
}

/**
 * Skills → prompt injection — the contract that makes drag&drop order real:
 * the linked skills' bodies reach the model's user message under
 * `## Skills / rules` in `agent_skills.order`, disabled skills are absent,
 * non-manual bodies arrive wrapped untrusted, the trace records the per-block
 * token estimate + loaded names, and re-binding bumps the agent's config
 * version with an updated snapshot.
 */
d('skills in the review prompt (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let llm: MockLLMProvider;

  const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

  const REVIEW_FIXTURE: Review = {
    verdict: 'comment',
    summary: 'Checked with skills attached.',
    score: 80,
    findings: [],
  };

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces).where(eq(t.workspaces.name, 'default'));
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  let seq = 0;
  async function setupPr() {
    seq += 1;
    const name = `skills-pr-${seq}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 900 + seq,
        title: 'Add rate limiting',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha: 'a1b2c3d4',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
        body: 'Add rate limiting.',
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
    });
    return pr!;
  }

  function makeApp() {
    llm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: llm },
      },
    });
  }

  /** The user message the engine actually sent to the LLM (last call). */
  function lastUserMessage(): string {
    const structured = llm.calls.filter((c) => c.method === 'completeStructured');
    expect(structured.length).toBeGreaterThan(0);
    const last = structured[structured.length - 1]!.req as {
      messages: { role: string; content: string }[];
    };
    return last.messages.find((m) => m.role === 'user')!.content;
  }

  /**
   * The run row goes terminal (done) slightly BEFORE its trace document is
   * persisted — poll briefly so the assertions below don't race the write.
   */
  async function waitForTrace(runId: string) {
    const start = Date.now();
    for (;;) {
      const [row] = await pg.handle.db
        .select()
        .from(t.runTraces)
        .where(eq(t.runTraces.runId, runId));
      if (row) return row.trace as unknown;
      if (Date.now() - start > 5_000) throw new Error(`trace for ${runId} never persisted`);
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  it('injects linked skill bodies under ## Skills / rules in link order, wrapping the imported one; trace records tokens + names', async () => {
    const app = await makeApp();
    const pr = await setupPr();

    const manual = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: `rule-a-${seq}`, type: 'rubric', body: 'CHECK ORDER FIRST.' },
      })
    ).json();
    const imported = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: {
          name: `rule-b-${seq}`,
          type: 'custom',
          body: 'IMPORTED INSTRUCTION TEXT.',
          source: 'imported_file',
          enabled: true, // vetted on import for this test
        },
      })
    ).json();

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: `Skilled Agent ${seq}`, provider: 'openai', model: 'gpt-4.1', system_prompt: 'x' },
      })
    ).json();
    const linked = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [manual.id, imported.id] },
    });
    expect(linked.statusCode).toBe(200);

    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    const runs = await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    expect(runs[0]!.status).toBe('done');

    const user = lastUserMessage();
    const skillsIdx = user.indexOf('## Skills / rules');
    expect(skillsIdx).toBeGreaterThan(-1);
    // Link order: manual first, imported second.
    expect(user.indexOf('CHECK ORDER FIRST.')).toBeGreaterThan(skillsIdx);
    expect(user.indexOf('CHECK ORDER FIRST.')).toBeLessThan(user.indexOf('IMPORTED INSTRUCTION TEXT.'));
    // The imported (non-manual) body arrives wrapped as untrusted DATA
    // (wrapUntrusted puts the body on its own line inside the delimiters).
    expect(user).toContain(`<untrusted source="skill-rule-b-${seq}">`);
    expect(user).toContain('IMPORTED INSTRUCTION TEXT.');
    expect(user).toContain('</untrusted>');
    // The manual body is NOT wrapped.
    expect(user).not.toContain('<untrusted source="skill-rule-a-');

    // Trace: the skills block + per-block token estimate + loaded names.
    const trace = (await waitForTrace(runs[0]!.id)) as {
      prompt_assembly: {
        skills: string | null;
        skills_tokens: number | null;
        skills_loaded: string[] | null;
      };
      log: { msg: string }[];
    };
    expect(trace.prompt_assembly.skills).toContain('CHECK ORDER FIRST.');
    expect(trace.prompt_assembly.skills_loaded).toEqual([manual.name, imported.name]);
    expect(trace.prompt_assembly.skills_tokens).toBeGreaterThan(0);
    expect(trace.prompt_assembly.skills_tokens).toBeLessThan(
      Math.ceil(user.length / 4), // per-BLOCK estimate, not the whole prompt
    );
    // The "Loaded N skill(s)" line lands in the persisted run log.
    expect(trace.log.some((l) => l.msg.startsWith(`Loaded 2 skill(s)`))).toBe(true);
    await app.close();
  });

  it('a disabled skill contributes no block; re-binding swaps prompt order and bumps the agent version snapshot', async () => {
    const app = await makeApp();
    const pr = await setupPr();

    const first = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: `swap-1-${seq}`, type: 'rubric', body: 'FIRST-BODY.' },
      })
    ).json();
    const second = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: `swap-2-${seq}`, type: 'rubric', body: 'SECOND-BODY.' },
      })
    ).json();
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: `Reorder Agent ${seq}`, provider: 'openai', model: 'gpt-4.1', system_prompt: 'x' },
      })
    ).json();
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [first.id, second.id] },
    });

    // The link change IS a config change: version bumps + snapshot carries skills.
    const afterLink = (
      await app.inject({ method: 'GET', url: `/agents/${agent.id}` })
    ).json();
    expect(afterLink.version).toBe(2);
    const versions = (
      await app.inject({ method: 'GET', url: `/agents/${agent.id}/versions` })
    ).json();
    const v2 = versions.find((v: { version: number }) => v.version === 2);
    expect(v2.config.skills).toEqual([first.id, second.id]);

    // Disable the first skill master-side → next run has no FIRST-BODY at all.
    await app.inject({ method: 'PUT', url: `/skills/${first.id}`, payload: { enabled: false } });
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 2 }); // run #2 of this PR
    const withoutDisabled = lastUserMessage();
    expect(withoutDisabled).not.toContain('FIRST-BODY.');
    expect(withoutDisabled).toContain('SECOND-BODY.');

    // Re-enable + swap the order → bodies appear in the NEW order.
    await app.inject({ method: 'PUT', url: `/skills/${first.id}`, payload: { enabled: true } });
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [second.id, first.id] },
    });
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 3 }); // run #3 of this PR
    const swapped = lastUserMessage();
    expect(swapped.indexOf('SECOND-BODY.')).toBeLessThan(swapped.indexOf('FIRST-BODY.'));

    // The snapshot of the latest version reflects the new order.
    const versionsNow = (
      await app.inject({ method: 'GET', url: `/agents/${agent.id}/versions` })
    ).json();
    const latest = versionsNow[0];
    expect(latest.config.skills).toEqual([second.id, first.id]);
    await app.close();
  });

  it('no linked skills → the prompt has no ## Skills / rules section at all (omit-when-empty)', async () => {
    const app = await makeApp();
    const pr = await setupPr();
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: `Bare Agent ${seq}`, provider: 'openai', model: 'gpt-4.1', system_prompt: 'x' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    expect(lastUserMessage()).not.toContain('## Skills / rules');
    await app.close();
  });
});
