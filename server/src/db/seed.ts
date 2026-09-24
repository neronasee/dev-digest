import 'dotenv/config';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and } from 'drizzle-orm';
import {
  GENERAL_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
  TEST_QUALITY_REVIEWER_PROMPT,
  API_CONTRACT_REVIEWER_PROMPT,
} from './seed-prompts.js';
import {
  BRANCH_COVERAGE_SKILL,
  CORNER_CASES_SKILL,
  MOCKING_DISCIPLINE_SKILL,
  FLAKE_WATCH_SKILL,
  BREAKING_CHANGE_SKILL,
  RESPONSE_SCHEMA_SKILL,
  SEMVER_DISCIPLINE_SKILL,
  DEPRECATION_POLICY_SKILL,
} from './seed-skills.js';
import {
  REFUND_SOURCE_PATCH,
  REFUND_TEST_PATCH,
  ROUTE_SIGNATURE_PATCH,
} from './seed-diffs.js';
import { wrapUntrusted } from '@devdigest/reviewer-core';
import { skillsForPrompt } from '../modules/skills/helpers.js';

/** Default provider/model for the built-in reviewer agents. */
const DEFAULT_PROVIDER = 'openrouter' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

/**
 * Seed the starter's demo data. Idempotent: re-running upserts the default
 * workspace/user and the demo fixtures.
 *
 * Seeds: default workspace + system user + membership, default settings,
 * demo repo (acme/payments-api), PR #482 with files/commits, a sample review
 * with a few findings, and the built-in agents (General + Security +
 * Performance + Test Quality + API Contract), all on the default
 * openrouter/deepseek-v4-flash provider+model.
 *
 * Skills Lab: eight seeded skills (descriptions are directive interfaces; the
 * four API-contract ones carry good/bad examples) bound to the two new agents;
 * `flake-watch` keeps its `imported_file` provenance (vetted at seed time).
 * Experiment PRs #483/#484 ship real patch hunks for the Skills control
 * experiments, and PR #483 gets one 'seed'-model run whose trace shows the
 * assembled skills block (no model call needed to inspect it).
 */

export const DEFAULT_WORKSPACE_NAME = 'default';
export const SYSTEM_USER_EMAIL = 'you@local';

export async function seed(db: Db): Promise<{ workspaceId: string; userId: string }> {
  // ---- workspace + user (no-auth defaults) ----
  let [ws] = await db
    .select()
    .from(t.workspaces)
    .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
  if (!ws) {
    [ws] = await db
      .insert(t.workspaces)
      .values({ name: DEFAULT_WORKSPACE_NAME })
      .returning();
  }
  const workspaceId = ws!.id;

  let [user] = await db.select().from(t.users).where(eq(t.users.email, SYSTEM_USER_EMAIL));
  if (!user) {
    [user] = await db
      .insert(t.users)
      .values({ email: SYSTEM_USER_EMAIL, name: 'You' })
      .returning();
  }
  const userId = user!.id;

  await db
    .insert(t.workspaceMembers)
    .values({ workspaceId, userId, role: 'owner' })
    .onConflictDoNothing();

  // ---- default settings ----
  const defaultSettings: Record<string, unknown> = {
    polling_interval_min: 5,
    theme: 'dark',
    density: 'regular',
    sync_to_folder: true,
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    await db
      .insert(t.settings)
      .values({ workspaceId, userId, key, value })
      .onConflictDoNothing();
  }

  // ---- demo repo (acme/payments-api) ----
  let [repo] = await db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
  if (!repo) {
    [repo] = await db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'payments-api',
        fullName: 'acme/payments-api',
        defaultBranch: 'main',
        clonePath: null,
        createdBy: userId,
      })
      .returning();
  }
  const repoId = repo!.id;

  // ---- PR #482 (rate limiting) ----
  let [pr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 482)));
  if (!pr) {
    [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 482,
        title: 'Add rate limiting to public API endpoints',
        author: 'marisa.koch',
        branch: 'feat/rate-limit-public',
        base: 'main',
        headSha: 'a1b2c3d4e5f6',
        additions: 247,
        deletions: 38,
        filesCount: 9,
        status: 'needs_review',
        body: 'Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.',
      })
      .returning();

    // pr_files (subset)
    await db.insert(t.prFiles).values([
      { prId: pr!.id, path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0 },
      { prId: pr!.id, path: 'src/api/public/webhooks.ts', additions: 31, deletions: 6 },
      { prId: pr!.id, path: 'src/config.ts', additions: 4, deletions: 0 },
      { prId: pr!.id, path: 'src/api/users.ts', additions: 7, deletions: 2 },
    ]);

    // pr_commits
    await db.insert(t.prCommits).values({
      prId: pr!.id,
      sha: 'a1b2c3d4e5f6',
      message: 'Add token-bucket rate limiter',
      author: 'marisa.koch',
    });

    // a sample review + findings so the PR shows results before the first run
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        kind: 'review',
        verdict: 'request_changes',
        summary:
          'Solid middleware approach, but a Stripe secret key is committed in plaintext and the user-list endpoint introduces an N+1 query under the new limiter.',
        score: 61,
        model: 'seed',
      })
      .returning();

    await db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 12,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key in commit',
        rationale: 'Line 12 contains a literal `sk_live_` Stripe secret key.',
        suggestion: 'Move to env var and rotate the key immediately.',
        confidence: 0.98,
      },
      {
        reviewId: review!.id,
        file: 'src/api/users.ts',
        startLine: 45,
        endLine: 52,
        severity: 'WARNING',
        category: 'perf',
        title: 'N+1 query in user list endpoint',
        rationale: 'Loop issues one query per user → N+1.',
        suggestion: 'Use a single IN query and group in memory.',
        confidence: 0.86,
      },
    ]);
  }

  // ---- built-in agents (the starter presets) ----
  // Prompt bodies live in ./seed-prompts.ts (mirrored in docs/agent-prompts/*.md).
  const seedAgents: Array<typeof t.agents.$inferInsert> = [
    {
      workspaceId,
      name: 'General Reviewer',
      description: 'Reviews a PR diff for bugs, correctness, and clarity.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: GENERAL_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Security Reviewer',
      description: 'Flags secrets, injection, SSRF and the lethal trifecta before merge.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: SECURITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Performance Reviewer',
      description: 'Catches N+1 queries, missing indexes, and hot-path allocations.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: PERFORMANCE_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Test Quality Reviewer',
      description:
        'Flags uncovered branches, missed corner cases, excessive mocking, and flaky tests.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: TEST_QUALITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'API Contract Reviewer',
      description:
        'Flags breaking API-surface changes, response-schema drift, semver misses, and missing deprecation windows.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: API_CONTRACT_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
  ];
  for (const a of seedAgents) {
    const [existing] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, a.name)));
    if (!existing) await db.insert(t.agents).values(a);
  }

  // ---- link the seeded review to an agent_run ----
  // The seeded review originally had no run row, which left the PR timeline
  // empty and the PR list's Findings column (latest-round previews) blank in
  // every seeded/e2e environment. Give it one agent_run so the seeded data
  // exercises the same round pipeline real "Run Review" triggers do.
  // Idempotent: only fires while the review still has no run.
  const [seedReview] = await db
    .select()
    .from(t.reviews)
    .where(and(eq(t.reviews.workspaceId, workspaceId), eq(t.reviews.model, 'seed')));
  if (seedReview && seedReview.runId == null && pr) {
    const [securityAgent] = await db
      .select()
      .from(t.agents)
      .where(
        and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'Security Reviewer')),
      );
    const [multiRun] = await db
      .insert(t.multiAgentRuns)
      .values({ workspaceId, prId: pr.id, ranAt: seedReview.createdAt })
      .returning();
    const [run] = await db
      .insert(t.agentRuns)
      .values({
        workspaceId,
        agentId: securityAgent?.id ?? null,
        prId: pr.id,
        multiRunId: multiRun!.id,
        provider: 'seed',
        model: 'seed',
        status: 'done',
        // Mirrors the seeded review: 2 findings, 1 blocker (the CRITICAL one).
        findingsCount: 2,
        blockers: 1,
        score: 61,
        // Unpriced on purpose — the Cost column keeps showing "—" like before.
        costUsd: null,
      })
      .returning();
    await db.update(t.reviews).set({ runId: run!.id }).where(eq(t.reviews.id, seedReview.id));
  }

  // ---- Skills Lab: seeded skills (descriptions are directive interfaces) ----
  // Bodies live in ./seed-skills.ts. flake-watch keeps source 'imported_file'
  // (vetted at seed time; provenance preserved) so the studio shows a real
  // "Imported" origin; user-driven imports land disabled until vetted instead.
  const seedSkills: Array<{
    name: string;
    type: 'rubric' | 'convention';
    source: 'manual' | 'imported_file';
    description: string;
    body: string;
    enabled: boolean;
  }> = [
    {
      name: 'breaking-change',
      type: 'convention',
      source: 'manual',
      description:
        'Flag any change to public API surface that breaks an existing caller — method, path, params, or response shape.',
      body: BREAKING_CHANGE_SKILL,
      enabled: true,
    },
    {
      name: 'response-schema',
      type: 'convention',
      source: 'manual',
      description:
        'Flag response bodies that diverge from the documented schema — removed, renamed, or retyped fields.',
      body: RESPONSE_SCHEMA_SKILL,
      enabled: true,
    },
    {
      name: 'semver-discipline',
      type: 'convention',
      source: 'manual',
      description:
        'Require a version action matching the change type: major for breaking, minor for additive, patch for fixes.',
      body: SEMVER_DISCIPLINE_SKILL,
      enabled: true,
    },
    {
      name: 'deprecation-policy',
      type: 'convention',
      source: 'manual',
      description:
        'Require a deprecation window (alias, changelog note, sunset version) for any removed or renamed public surface.',
      body: DEPRECATION_POLICY_SKILL,
      enabled: true,
    },
    {
      name: 'branch-coverage',
      type: 'rubric',
      source: 'manual',
      description:
        'Enumerate the branches of changed code and flag every branch no test in this PR drives through.',
      body: BRANCH_COVERAGE_SKILL,
      enabled: true,
    },
    {
      name: 'corner-cases',
      type: 'rubric',
      source: 'manual',
      description:
        'Check the PR tests against the boundary/empty/null/error-path input matrix and flag every uncovered case.',
      body: CORNER_CASES_SKILL,
      enabled: true,
    },
    {
      name: 'mocking-discipline',
      type: 'convention',
      source: 'manual',
      description:
        'Flag tests that mock the unit under test, stub owned types, or fake I/O in integration tests.',
      body: MOCKING_DISCIPLINE_SKILL,
      enabled: true,
    },
    {
      name: 'flake-watch',
      type: 'convention',
      source: 'imported_file',
      description:
        'Flag time, randomness, ordering, and real-network dependencies that make tests flake in CI.',
      body: FLAKE_WATCH_SKILL,
      enabled: true,
    },
  ];
  const skillIdsByName = new Map<string, string>();
  for (const s of seedSkills) {
    let [row] = await db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, s.name)));
    if (!row) {
      [row] = await db
        .insert(t.skills)
        .values({
          workspaceId,
          name: s.name,
          description: s.description,
          type: s.type,
          source: s.source,
          body: s.body,
          enabled: s.enabled,
          version: 1,
        })
        .returning();
      // Mirror the API invariant: a skill always has its v1 history entry.
      await db
        .insert(t.skillVersions)
        .values({ skillId: row!.id, version: 1, body: s.body });
    }
    skillIdsByName.set(s.name, row!.id);
  }

  // ---- bind the seeded skills to the new agents (order = prompt order) ----
  const bindings: Array<{ agent: string; skills: string[] }> = [
    {
      agent: 'Test Quality Reviewer',
      skills: ['branch-coverage', 'corner-cases', 'mocking-discipline', 'flake-watch'],
    },
    {
      agent: 'API Contract Reviewer',
      skills: ['breaking-change', 'response-schema', 'semver-discipline', 'deprecation-policy'],
    },
  ];
  for (const { agent: agentName, skills: skillNames } of bindings) {
    const [agent] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, agentName)));
    if (!agent) continue;
    for (const [i, skillName] of skillNames.entries()) {
      const skillId = skillIdsByName.get(skillName);
      if (!skillId) continue;
      await db
        .insert(t.agentSkills)
        .values({ agentId: agent.id, skillId, order: i })
        .onConflictDoNothing();
    }
  }

  // ---- Conventions Extractor: one candidate per triage state ----
  // Deterministic board for the page, component tests and the e2e flow —
  // no model call needed to see accept/reject/edit working. Keyed on
  // (repo, rule) so re-seeding is a no-op.
  const seedConventions: Array<{
    category: 'naming' | 'structure' | 'errors' | 'testing' | 'imports' | 'typing' | 'api' | 'general';
    rule: string;
    rationale: string | null;
    evidencePath: string;
    evidenceLine: number;
    evidenceSnippet: string;
    confidence: number;
    occurrences: number;
    status: 'pending' | 'accepted' | 'rejected';
  }> = [
    {
      category: 'errors',
      rule: 'Throw NotFoundError for a missing row instead of returning null',
      rationale: 'Callers skip null checks; a typed error surfaces the miss in CI instead of at runtime.',
      evidencePath: 'src/api/users.ts',
      evidenceLine: 3,
      evidenceSnippet: 'const user = await db.users.find(id);\nif (!user) throw new NotFoundError(`user ${id}`);',
      confidence: 0.9,
      occurrences: 4,
      status: 'pending',
    },
    {
      category: 'structure',
      rule: 'Never mix .then() chains with await in new code',
      rationale: 'The codebase is fully async/await; a .then() chain hides control flow a reviewer cannot follow.',
      evidencePath: 'src/middleware/ratelimit.ts',
      evidenceLine: 12,
      evidenceSnippet: 'const bucket = await store.take(key);\nreturn { allowed: bucket.remaining > 0 };',
      confidence: 0.85,
      occurrences: 9,
      status: 'accepted',
    },
    {
      category: 'structure',
      rule: 'Prefer default exports for modules',
      rationale: null,
      evidencePath: 'src/config.ts',
      evidenceLine: 1,
      evidenceSnippet: 'export const config = loadConfig(process.env);',
      confidence: 0.55,
      occurrences: 1,
      status: 'rejected',
    },
  ];
  for (const c of seedConventions) {
    const [existing] = await db
      .select({ id: t.conventions.id })
      .from(t.conventions)
      .where(
        and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId), eq(t.conventions.rule, c.rule)),
      );
    if (existing) continue;
    await db.insert(t.conventions).values({
      workspaceId,
      repoId,
      category: c.category,
      rule: c.rule,
      rationale: c.rationale ?? null,
      evidencePath: c.evidencePath,
      evidenceLine: c.evidenceLine,
      evidenceSnippet: c.evidenceSnippet,
      confidence: c.confidence,
      occurrences: c.occurrences,
      status: c.status,
    });
  }

  // ---- experiment PRs (#483, #484) — Skills control experiments ----
  // pr_files carry REAL patch hunks (PR #482's files don't — its diff is
  // empty), so the reviewer sees actual code and the grounding gate accepts
  // line citations inside the hunks.
  const experimentPrs: Array<{
    number: number;
    title: string;
    author: string;
    branch: string;
    headSha: string;
    additions: number;
    deletions: number;
    filesCount: number;
    body: string;
    commitMessage: string;
    files: Array<{ path: string; additions: number; deletions: number; patch: string }>;
  }> = [
    {
      number: 483,
      title: 'Add refund endpoint with happy-path test',
      author: 'dev.dashboard',
      branch: 'feat/refund-endpoint',
      headSha: 'b2c3d4e5f6a1',
      additions: 39,
      deletions: 0,
      filesCount: 2,
      body: 'Adds refundPayment plus a unit test for the success path.',
      commitMessage: 'Add refund endpoint with tests',
      files: [
        { path: 'src/payments/refund.ts', additions: 25, deletions: 0, patch: REFUND_SOURCE_PATCH },
        { path: 'src/payments/refund.test.ts', additions: 14, deletions: 0, patch: REFUND_TEST_PATCH },
      ],
    },
    {
      number: 484,
      title: 'Change GET /users query params and response shape',
      author: 'dev.dashboard',
      branch: 'feat/users-list-shape',
      headSha: 'c3d4e5f6a1b2',
      additions: 4,
      deletions: 5,
      filesCount: 1,
      body: 'Renames the profile query param, adjusts the default page size, and clarifies the response field naming.',
      commitMessage: 'Adjust users list params and response naming',
      files: [
        { path: 'src/api/users.ts', additions: 4, deletions: 5, patch: ROUTE_SIGNATURE_PATCH },
      ],
    },
  ];
  for (const ep of experimentPrs) {
    const [existing] = await db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, ep.number)));
    if (existing) continue;
    const [newPr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: ep.number,
        title: ep.title,
        author: ep.author,
        branch: ep.branch,
        base: 'main',
        headSha: ep.headSha,
        additions: ep.additions,
        deletions: ep.deletions,
        filesCount: ep.filesCount,
        status: 'needs_review',
        body: ep.body,
      })
      .returning();
    await db.insert(t.prFiles).values(
      ep.files.map((f) => ({
        prId: newPr!.id,
        path: f.path,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch,
      })),
    );
    await db.insert(t.prCommits).values({
      prId: newPr!.id,
      sha: ep.headSha,
      message: ep.commitMessage,
      author: ep.author,
    });
  }

  // ---- seeded demo run for Test Quality Reviewer on PR #483 ----
  // A 'seed'-model run whose trace shows the assembled skills block (bodies,
  // per-block token estimate, loaded names, log line) — so the Run Trace UI
  // and e2e can verify skills observability without a model call. Idempotent
  // via the 'seed' model marker on the PR's runs.
  const [pr483] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 483)));
  const [tqAgent] = await db
    .select()
    .from(t.agents)
    .where(
      and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'Test Quality Reviewer')),
    );
  if (pr483 && tqAgent) {
    const [existingRun] = await db
      .select()
      .from(t.agentRuns)
      .where(and(eq(t.agentRuns.prId, pr483.id), eq(t.agentRuns.model, 'seed')));
    if (!existingRun) {
      const links = (
        await db
          .select({ skill: t.skills, order: t.agentSkills.order })
          .from(t.agentSkills)
          .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
          .where(eq(t.agentSkills.agentId, tqAgent.id))
      ).map((r) => ({ skill: r.skill, order: r.order }));
      const { bodies, names, tokens } = skillsForPrompt(links);
      const diffText = experimentPrs
        .find((e) => e.number === 483)!
        .files.map((f) => `--- a/${f.path}\n+++ b/${f.path}\n${f.patch}`)
        .join('\n');
      const taskLine = `Review the changes in PR #483 "${pr483.title}".`;
      const user = [
        taskLine,
        `## PR description\n${wrapUntrusted('pr-description', pr483.body ?? '')}`,
        ...(bodies.length > 0 ? [`## Skills / rules\n${bodies.join('\n\n')}`] : []),
        `## Diff to review\n${wrapUntrusted('diff', diffText)}`,
      ].join('\n\n');
      const [multiRun] = await db
        .insert(t.multiAgentRuns)
        .values({ workspaceId, prId: pr483.id })
        .returning();
      const [run] = await db
        .insert(t.agentRuns)
        .values({
          workspaceId,
          agentId: tqAgent.id,
          prId: pr483.id,
          multiRunId: multiRun!.id,
          provider: 'seed',
          model: 'seed',
          status: 'done',
          durationMs: 0,
          tokensIn: 0,
          tokensOut: 0,
          costUsd: null,
          findingsCount: 0,
          grounding: '0/0 passed',
          score: null,
          blockers: 0,
        })
        .returning();
      await db.insert(t.runTraces).values({
        runId: run!.id,
        trace: {
          config: {
            agent: tqAgent.name,
            version: String(tqAgent.version),
            provider: 'seed',
            model: 'seed',
            pr: 483,
            source: 'local',
          },
          stats: {
            duration_ms: 0,
            tokens_in: 0,
            tokens_out: 0,
            cost_usd: null,
            findings: 0,
            grounding: '0/0 passed',
          },
          prompt_assembly: {
            system: tqAgent.systemPrompt,
            skills: bodies.length > 0 ? bodies.join('\n\n') : null,
            ...(bodies.length > 0 ? { skills_tokens: tokens, skills_loaded: names } : {}),
            memory: null,
            specs: null,
            user,
          },
          tool_calls: [],
          raw_output: '',
          memory_pulled: [],
          specs_read: [],
          log: [
            { t: '00.00', kind: 'info', msg: `Starting review with agent "Test Quality Reviewer" (seed/seed)` },
            ...(bodies.length > 0
              ? [
                  {
                    t: '00.01',
                    kind: 'info' as const,
                    msg: `Loaded ${names.length} skill(s) (~${tokens} tokens): ${names.join(', ')}`,
                  },
                ]
              : []),
            { t: '00.02', kind: 'info', msg: 'Run complete; trace persisted' },
          ],
        },
      });
    }
  }

  return { workspaceId, userId };
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const handle = createDb(url);
  seed(handle.db)
    .then(async (r) => {
      console.log('✓ seeded', r);
      await handle.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('✗ seed failed:', err);
      await handle.close();
      process.exit(1);
    });
}
