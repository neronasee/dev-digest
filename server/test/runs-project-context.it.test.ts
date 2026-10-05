import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { mkdtemp, mkdir, rm, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import { intentLlmOverride, intentGithubOverride } from './helpers/intent.js';
import * as t from '../src/db/schema.js';
import type { Review } from '@devdigest/shared';
import {
  MAX_BLOCK_TOKENS,
  MAX_DOC_CHARS,
  TRUNCATION_MARKER,
} from '../src/modules/project-context/constants.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[runs-project-context] Docker not available — skipping integration tests.');
}

/**
 * Project Context in the review round — the spec's core loop, mechanically:
 * attach → run → ONE `## Project context` block with path-labeled untrusted
 * documents, ordered/deduped across agent + enabled skills, fresh-read at run
 * time, capped per document and per block, traced via specs_read/specs_tokens,
 * and fail-open on unreadable files. Mirrors runs-skills.it.test.ts (mocked
 * LLM/git/intent; poll the TRACE row — never the run's terminal status).
 */
d('project context in the review prompt (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let llm: MockLLMProvider;
  let tmpRoot: string;

  const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

  const REVIEW_FIXTURE: Review = {
    verdict: 'comment',
    summary: 'Checked with project context attached.',
    score: 80,
    findings: [],
  };

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db
      .select()
      .from(t.workspaces)
      .where(eq(t.workspaces.name, 'default'));
    workspaceId = ws!.id;
    tmpRoot = await mkdtemp(join(tmpdir(), 'devdigest-runctx-'));
  });
  afterAll(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
    await pg?.stop();
  });

  let seq = 0;
  let prSeq = 0;

  /** A tmp-dir clone (absolute clone_path on the repos row) with `docs`. */
  async function setupCloneRepo(docs: Record<string, string>) {
    seq += 1;
    const name = `runctx-repo-${seq}`;
    const dir = join(tmpRoot, name);
    for (const [rel, content] of Object.entries(docs)) {
      const full = join(dir, rel);
      await mkdir(full.slice(0, full.lastIndexOf('/')), { recursive: true });
      await writeFile(full, content, 'utf8');
    }
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}`, clonePath: dir })
      .returning();
    return repo!;
  }

  async function setupPr(repoId: string) {
    prSeq += 1; // unique per PR even when a test mints several on one repo
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 1000 + prSeq,
        title: 'Add rate limiting',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha: `sha${seq}`,
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
        github: intentGithubOverride(),
        llm: { openai: llm, ...intentLlmOverride() },
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

  function structuredCallCount(): number {
    return llm.calls.filter((c) => c.method === 'completeStructured').length;
  }

  /** Poll the persisted trace document (the run flips done BEFORE the write). */
  async function waitForTrace(runId: string) {
    const start = Date.now();
    for (;;) {
      const [row] = await pg.handle.db
        .select()
        .from(t.runTraces)
        .where(eq(t.runTraces.runId, runId));
      if (row) return row.trace as unknown as {
        prompt_assembly: { specs: string | null; specs_tokens?: number | null };
        specs_read: Array<string | { path: string; tokens: number }>;
        log: { msg: string }[];
      };
      if (Date.now() - start > 5_000) throw new Error(`trace for ${runId} never persisted`);
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  async function runReview(
    app: Awaited<ReturnType<typeof makeApp>>,
    prId: string,
    agentId: string,
    expectedRounds: number,
  ) {
    await app.inject({ method: 'POST', url: `/pulls/${prId}/review`, payload: { agentId } });
    const runs = await waitForPrRuns(pg.handle.db, prId, { expected: expectedRounds });
    expect(runs[runs.length - 1]!.status).toBe('done');
    return runs;
  }

  const INVARIANT = 'module `api/` must not import `db/` directly';

  it('one ordered, deduped, path-labeled block from agent + ENABLED skills; trace records reads + tokens (AC-9/10/11/13/15/18)', async () => {
    const app = await makeApp();
    const SPEC_BODY = `# API layering\n\nInvariant: ${INVARIANT}\n`;
    const DUP_BODY = 'DUPDOC BODY.';
    const AGENT_DOC = 'AGENT-ONLY DOC BODY.';
    const repo = await setupCloneRepo({
      'specs/api-layering.md': SPEC_BODY,
      'docs/dup.md': DUP_BODY,
      'docs/agent-doc.md': AGENT_DOC,
      'docs/disabled-doc.md': 'DISABLED SKILL DOC.',
    });

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: `Run Ctx Agent ${seq}`, provider: 'openai', model: 'gpt-4.1', system_prompt: 'x' },
      })
    ).json();
    const skillEnabled = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: `ctx-enabled-${seq}`, type: 'rubric', body: 'ENABLED SKILL RULE.' },
      })
    ).json();
    const skillDisabled = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: `ctx-disabled-${seq}`, type: 'rubric', body: 'OFF SKILL RULE.', enabled: false },
      })
    ).json();

    // Agent set: spec first, then the duplicated path. Enabled skill adds the
    // dup again (dedupe, first wins) plus its own doc. Disabled skill's doc
    // must never contribute (AC-11).
    await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context`,
      payload: { repo_id: repo.id, paths: ['specs/api-layering.md', 'docs/dup.md'] },
    });
    await app.inject({
      method: 'PUT',
      url: `/skills/${skillEnabled.id}/context`,
      payload: { repo_id: repo.id, paths: ['docs/dup.md', 'docs/agent-doc.md'] },
    });
    await app.inject({
      method: 'PUT',
      url: `/skills/${skillDisabled.id}/context`,
      payload: { repo_id: repo.id, paths: ['docs/disabled-doc.md'] },
    });
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [skillEnabled.id, skillDisabled.id] },
    });

    const pr = await setupPr(repo.id);
    const runs = await runReview(app, pr.id, agent.id, 1);

    const user = lastUserMessage();
    // ONE block (AC-13), with the trusted citation line directly under it.
    expect(user.split('## Project context').length - 1).toBe(1);
    const headerIdx = user.indexOf('## Project context');
    expect(user.slice(headerIdx, headerIdx + 300)).toContain(
      "cite that document's path in the finding's rationale",
    );
    // Path-labeled untrusted wrappers, in merge order: agent set first, then
    // the enabled skill's additions (AC-9).
    const specIdx = user.indexOf('<untrusted source="specs/api-layering.md">');
    const dupIdx = user.indexOf('<untrusted source="docs/dup.md">');
    const agentDocIdx = user.indexOf('<untrusted source="docs/agent-doc.md">');
    expect(specIdx).toBeGreaterThan(headerIdx);
    expect(specIdx).toBeLessThan(dupIdx);
    expect(dupIdx).toBeLessThan(agentDocIdx);
    // The invariant doc's CONTENT rides inside the block (AC-15).
    expect(user).toContain(INVARIANT);
    // Dedupe: the dup doc appears exactly once (AC-10)…
    expect(user.indexOf(DUP_BODY)).toBe(user.lastIndexOf(DUP_BODY));
    // …and the disabled skill's doc never made it in (AC-11).
    expect(user).not.toContain('DISABLED SKILL DOC.');

    // Trace (AC-18): read rows + per-block token attribution; poll the trace row.
    const trace = await waitForTrace(runs[0]!.id);
    expect(trace.specs_read).toEqual([
      { path: 'specs/api-layering.md', tokens: Math.ceil(SPEC_BODY.length / 4) },
      { path: 'docs/dup.md', tokens: Math.ceil(DUP_BODY.length / 4) },
      { path: 'docs/agent-doc.md', tokens: Math.ceil(AGENT_DOC.length / 4) },
    ]);
    expect(trace.prompt_assembly.specs).toContain(`<untrusted source="specs/api-layering.md">`);
    expect(trace.prompt_assembly.specs_tokens).toBe(
      Math.ceil(trace.prompt_assembly.specs!.length / 4),
    );
    expect(trace.log.some((l) => l.msg.startsWith('project context: 3 document(s)'))).toBe(true);
    await app.close();
  });

  it('no attachments → no ## Project context section and the SAME LLM call count (AC-13/AC-14)', async () => {
    const app = await makeApp();
    const repo = await setupCloneRepo({ 'docs/none.md': 'N' });

    const bare = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: `Bare Agent ${seq}`, provider: 'openai', model: 'gpt-4.1', system_prompt: 'x' },
      })
    ).json();
    const loaded = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: `Loaded Agent ${seq}`, provider: 'openai', model: 'gpt-4.1', system_prompt: 'x' },
      })
    ).json();
    await app.inject({
      method: 'PUT',
      url: `/agents/${loaded.id}/context`,
      payload: { repo_id: repo.id, paths: ['docs/none.md'] },
    });

    const prBare = await setupPr(repo.id);
    const callsBefore = structuredCallCount();
    await runReview(app, prBare.id, bare.id, 1);
    const bareUser = lastUserMessage();
    const callsBare = structuredCallCount() - callsBefore;

    const prLoaded = await setupPr(repo.id);
    await runReview(app, prLoaded.id, loaded.id, 1);
    const loadedUser = lastUserMessage();
    const callsLoaded = structuredCallCount() - callsBare - callsBefore;

    expect(bareUser).not.toContain('## Project context'); // omit-when-empty
    expect(loadedUser).toContain('## Project context');
    expect(callsLoaded).toBe(callsBare); // zero extra LLM calls (AC-14)
    await app.close();
  });

  it('a document edited between attach and run contributes its NEW content (AC-12)', async () => {
    const app = await makeApp();
    const repo = await setupCloneRepo({ 'docs/live.md': 'ORIGINAL CONTENT v1' });
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: `Live Agent ${seq}`, provider: 'openai', model: 'gpt-4.1', system_prompt: 'x' },
      })
    ).json();
    await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context`,
      payload: { repo_id: repo.id, paths: ['docs/live.md'] },
    });
    const pr = await setupPr(repo.id);
    await runReview(app, pr.id, agent.id, 1);
    expect(lastUserMessage()).toContain('ORIGINAL CONTENT v1');

    await writeFile(join(repo.clonePath!, 'docs/live.md'), 'FRESH CONTENT v2 — read at run time', 'utf8');
    await runReview(app, pr.id, agent.id, 2);
    const user = lastUserMessage();
    expect(user).toContain('FRESH CONTENT v2 — read at run time');
    expect(user).not.toContain('ORIGINAL CONTENT v1');
    await app.close();
  });

  it('a deleted file fails OPEN: run succeeds, path logged as omitted, absent from specs_read (AC-19)', async () => {
    const app = await makeApp();
    const repo = await setupCloneRepo({ 'docs/stays.md': 'STAYS.', 'docs/gone.md': 'GONE.' });
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: `Omit Agent ${seq}`, provider: 'openai', model: 'gpt-4.1', system_prompt: 'x' },
      })
    ).json();
    await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context`,
      payload: { repo_id: repo.id, paths: ['docs/stays.md', 'docs/gone.md'] },
    });
    await unlink(join(repo.clonePath!, 'docs/gone.md'));

    const pr = await setupPr(repo.id);
    const runs = await runReview(app, pr.id, agent.id, 1);

    const user = lastUserMessage();
    expect(user).toContain('STAYS.');
    expect(user).not.toContain('GONE.');

    const trace = await waitForTrace(runs[0]!.id);
    expect(trace.log.some((l) => l.msg.includes('omitted docs/gone.md'))).toBe(true);
    expect(trace.specs_read).toEqual([
      { path: 'docs/stays.md', tokens: Math.ceil('STAYS.'.length / 4) },
    ]);
    await app.close();
  });

  it('an oversized document is truncated with the marker INSIDE its untrusted wrapper (AC-26)', async () => {
    const app = await makeApp();
    const huge = `HUGE START\n${'h'.repeat(MAX_DOC_CHARS)}`;
    const repo = await setupCloneRepo({ 'docs/huge.md': huge });
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: `Huge Agent ${seq}`, provider: 'openai', model: 'gpt-4.1', system_prompt: 'x' },
      })
    ).json();
    await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context`,
      payload: { repo_id: repo.id, paths: ['docs/huge.md'] },
    });

    const pr = await setupPr(repo.id);
    const runs = await runReview(app, pr.id, agent.id, 1);

    const user = lastUserMessage();
    const openIdx = user.indexOf('<untrusted source="docs/huge.md">');
    const closeIdx = user.indexOf('</untrusted>', openIdx);
    const markerIdx = user.indexOf(TRUNCATION_MARKER);
    expect(openIdx).toBeGreaterThan(-1);
    expect(markerIdx).toBeGreaterThan(openIdx);
    expect(markerIdx).toBeLessThan(closeIdx); // marker stays INSIDE the wrapper

    // A doc truncated at the per-doc cap lands EXACTLY at the block cap
    // (the marker is not counted as document content) — it is kept, and its
    // specs_read estimate is the capped body's.
    const trace = await waitForTrace(runs[0]!.id);
    expect(trace.specs_read).toEqual([{ path: 'docs/huge.md', tokens: MAX_DOC_CHARS / 4 }]);
    await app.close();
  });

  it('an over-cap set keeps the maximal prefix and logs the dropped tail (AC-27)', async () => {
    const app = await makeApp();
    // Three docs of ~1500 tokens each (under the per-doc cap): 1+2 fit the
    // 4000-token block exactly (3000), the third would overflow → dropped.
    const doc = (sentry: string) => `${sentry}\n${'p'.repeat(6_000)}`;
    const repo = await setupCloneRepo({
      'docs/big1.md': doc('BIG1-SENTRY'),
      'docs/big2.md': doc('BIG2-SENTRY'),
      'docs/big3.md': doc('BIG3-SENTRY'),
    });
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: `Cap Agent ${seq}`, provider: 'openai', model: 'gpt-4.1', system_prompt: 'x' },
      })
    ).json();
    await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context`,
      payload: { repo_id: repo.id, paths: ['docs/big1.md', 'docs/big2.md', 'docs/big3.md'] },
    });

    const pr = await setupPr(repo.id);
    const runs = await runReview(app, pr.id, agent.id, 1);

    const user = lastUserMessage();
    expect(user).toContain('BIG1-SENTRY');
    expect(user).toContain('BIG2-SENTRY');
    expect(user).not.toContain('BIG3-SENTRY'); // whole tail dropped

    const trace = await waitForTrace(runs[0]!.id);
    expect(trace.specs_read.map((s) => (typeof s === 'string' ? s : s.path))).toEqual([
      'docs/big1.md',
      'docs/big2.md',
    ]);
    // Dropped path logged; the kept pair's estimate fits the cap.
    expect(trace.log.some((l) => l.msg.includes('block token cap') && l.msg.includes('docs/big3.md'))).toBe(
      true,
    );
    const keptTokens = trace.specs_read.reduce(
      (sum, s) => sum + (typeof s === 'string' ? 0 : s.tokens),
      0,
    );
    expect(keptTokens).toBeLessThanOrEqual(MAX_BLOCK_TOKENS);
    await app.close();
  });
});
