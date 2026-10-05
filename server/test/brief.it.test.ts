import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { DEMO_CLONE_PATH } from '../src/db/seed-context.js';
import { MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import { PrBrief, type StructuredRequest } from '@devdigest/shared';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';
import { eq } from 'drizzle-orm';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  console.warn('[brief] Docker not available — skipping integration tests.');
}

/**
 * The PR Brief end to end: the cached read surface (zero model calls), the
 * generation loop (facts → ONE structured call on the `risk_brief` model →
 * grounding vs PR files ∪ blast map → whole-replace `pr_brief` row), the
 * degradation edges, staleness, tenancy, and the POST rate limit.
 *
 * The model is a fixture, so this is really about the halves AROUND it —
 * which is where the feature's correctness lives. The suite owns its own
 * repo/PR rows (the seeded demo repo is never touched); the cloned repo
 * reuses the seed's read-only fixture clone so the discovered-specs path is
 * the real Project Context discovery.
 */

const PR_FILES = [
  { path: 'src/modules/brief/service.ts', additions: 120, deletions: 8 },
  { path: 'src/modules/brief/prompt.ts', additions: 80, deletions: 4 },
  { path: 'README.md', additions: 6, deletions: 1 },
];

/** A fully grounded draft — every ref is a PR file. */
const DRAFT_CLEAN = {
  summary: 'Adds the PR brief: one card with summary, risks and review focus.',
  risks: [
    {
      kind: 'security',
      title: 'Prompt injection via PR text',
      explanation: 'Description and spec docs must stay untrusted data.',
      severity: 'medium',
      file_refs: ['src/modules/brief/prompt.ts'],
    },
    {
      kind: 'correctness',
      title: 'Stale cache after a new commit',
      explanation: 'A new head SHA must mark the cached brief stale.',
      severity: 'low',
      file_refs: ['src/modules/brief/service.ts'],
    },
  ],
  review_focus: [
    { file: 'src/modules/brief/service.ts', line: 42, reason: 'Grounding runs before the write.' },
    { file: 'src/modules/brief/prompt.ts', line: 7, reason: 'Untrusted wrapping of PR text.' },
  ],
};

/** One invented ref inside a surviving risk, one all-invented risk, one
 *  invented focus item, one blast-map-only focus item that must SURVIVE. */
const DRAFT = {
  ...DRAFT_CLEAN,
  risks: [
    ...DRAFT_CLEAN.risks,
    {
      kind: 'security',
      title: 'Invented ref inside an honest risk',
      explanation: 'The invented ref is filtered; the risk survives.',
      severity: 'medium',
      file_refs: ['src/modules/brief/service.ts', 'src/invented/nothing.ts'],
    },
    {
      kind: 'performance',
      title: 'All references invented',
      explanation: 'Every file ref here is invented.',
      severity: 'high',
      file_refs: ['made/up/one.ts', 'made/up/two.ts'],
    },
  ],
  review_focus: [
    ...DRAFT_CLEAN.review_focus,
    { file: 'src/modules/reviews/run-executor.ts', line: 7, reason: 'Blast-map-only downstream caller.' },
    { file: 'src/invented/nothing.ts', line: 1, reason: 'Invented path.' },
  ],
};

const DRAFT_V2 = { ...DRAFT, summary: 'Version two: the same PR, restated for refresh.' };
const EMPTY_DRAFT = { summary: 'Nothing notable to flag.', risks: [], review_focus: [] };

/** repo-intel double: 'full' yields a usable blast map; 'partial' folds into
 *  degraded (toBlastRadius's index-state folding), so the service drops it. */
function makeRepoIntel(index: 'full' | 'partial'): RepoIntel {
  return {
    getIndexState: async () => ({
      status: index,
      filesIndexed: index === 'full' ? 12 : 5,
      filesSkipped: 0,
      durationMs: 10,
      repoId: 'x',
      lastIndexedSha: 'sha',
      indexerVersion: 1,
      updatedAt: new Date(),
    }),
    getBlastRadius: async () => ({
      changedSymbols: [
        { file: 'src/modules/brief/service.ts', name: 'BriefService', kind: 'class' },
      ],
      callers: [
        {
          file: 'src/modules/reviews/run-executor.ts',
          symbol: 'runOneAgent',
          viaSymbol: 'BriefService',
          line: 7,
          rank: 3,
        },
      ],
      impactedEndpoints: [],
    }),
  } as unknown as RepoIntel;
}

interface AppOpts {
  draft?: unknown;
  blastMode?: 'full' | 'partial';
  github?: MockGitHubClient;
  extraLlm?: Record<string, MockLLMProvider>;
  nodeEnv?: 'test' | 'development';
}

d('brief module (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;
  let noCloneRepoId: string;
  let otherWorkspacePrId: string;

  let prId: string;
  let sparsePrId: string;
  let brokenPrId: string;
  let hugePrId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;

    // Own repo, pointed at the seed's read-only fixture clone so Project
    // Context discovery is real (specs/ + docs/ + insights/ documents).
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'briefs-api',
        fullName: 'acme/briefs-api',
        clonePath: DEMO_CLONE_PATH,
      })
      .returning();
    repoId = repo!.id;

    const [noClone] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'ledger', fullName: 'acme/ledger' })
      .returning();
    noCloneRepoId = noClone!.id;

    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 201,
        title: 'Add PR brief generation',
        author: 'dev.dashboard',
        branch: 'feat/pr-brief',
        base: 'main',
        headSha: 'abc123def456',
        status: 'open',
        body: 'Explains the why and the risk areas before reading the diff. Depends on intent, blast radius and the attached specs.',
      })
      .returning();
    prId = pr!.id;
    await pg.handle.db
      .insert(t.prFiles)
      .values(PR_FILES.map((f) => ({ prId, ...f, patch: null })));
    await pg.handle.db.insert(t.prIntent).values({
      prId,
      intent: 'Ship the brief card so a cold PR is triageable from one place.',
      inScope: ['brief module', 'two routes'],
      outOfScope: ['reviewer pipeline'],
    });

    // The everything-missing PR: no files, no body, no intent, on the
    // clone-less repo (edge 3 + edges 1/2/8).
    const [sparsePr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: noCloneRepoId,
        number: 202,
        title: 'Empty skeleton change',
        author: 'dev.dashboard',
        branch: 'chore/skeleton',
        base: 'main',
        headSha: 'f6e5d4c3b2a1',
        status: 'open',
        body: null,
      })
      .returning();
    sparsePrId = sparsePr!.id;

    // The contract-invalid stored row (edge 10).
    const [brokenPr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 203,
        title: 'Old schema drift victim',
        author: 'dev.dashboard',
        branch: 'feat/old',
        base: 'main',
        headSha: '0d0d0d0d0d0d',
        status: 'open',
      })
      .returning();
    brokenPrId = brokenPr!.id;
    await pg.handle.db
      .insert(t.prBrief)
      .values({ prId: brokenPrId, json: { broken: true } });

    // The huge PR (AC-17): > FILE_LIST_CAP files + a >cap description.
    const [hugePr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 204,
        title: 'Mechanical rename across every feature',
        author: 'dev.dashboard',
        branch: 'chore/rename',
        base: 'main',
        headSha: '987654123abc',
        status: 'open',
        body: 'L'.repeat(6_000),
      })
      .returning();
    hugePrId = hugePr!.id;
    await pg.handle.db.insert(t.prFiles).values(
      Array.from({ length: 250 }, (_, i) => ({
        prId: hugePrId,
        path: `packages/payments/src/features/invoices/components/rows/InvoiceTableRowItemComponent-${i}.tsx`,
        additions: 3,
        deletions: 1,
        patch: null,
      })),
    );
    await pg.handle.db.insert(t.prIntent).values({
      prId: hugePrId,
      intent: 'Rename without behavior change.',
      inScope: ['every feature row component'],
      outOfScope: ['logic'],
    });

    // Cross-workspace PR: same DB, another workspace — must 404, not leak.
    const [ws2] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'brief-other-ws' })
      .returning();
    const [otherRepo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: ws2!.id, owner: 'other', name: 'private', fullName: 'other/private' })
      .returning();
    const [otherPr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId: ws2!.id,
        repoId: otherRepo!.id,
        number: 1,
        title: 'Foreign PR',
        author: 'x',
        branch: 'b',
        base: 'main',
        headSha: '111111111111',
        status: 'open',
      })
      .returning();
    otherWorkspacePrId = otherPr!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function makeApp(opts: AppOpts = {}) {
    // risk_brief's registry default is openai/gpt-4.1 — the mock MUST sit on
    // the openai slot (a live OPENAI_API_KEY in server/.env would otherwise
    // turn the "mock" call real and billed). The github override keeps the
    // linked-issue fetch hermetic for the same reason.
    const openai = new MockLLMProvider('openai', {
      structuredBySchema: { PrBriefDraft: opts.draft ?? DRAFT },
    });
    const app = await buildApp({
      config: loadConfig({
        ...process.env,
        NODE_ENV: opts.nodeEnv ?? 'test',
        LOG_LEVEL: 'silent',
      } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: {
        repoIntel: makeRepoIntel(opts.blastMode ?? 'full'),
        github: opts.github ?? new MockGitHubClient(),
        llm: { openai, ...(opts.extraLlm ?? {}) },
      },
    });
    return { app, openai };
  }

  const structuredCalls = (llm: MockLLMProvider) =>
    llm.calls.filter((c) => c.method === 'completeStructured');

  const userPromptOf = (llm: MockLLMProvider, n = 0) =>
    (structuredCalls(llm)[n]!.req as StructuredRequest<unknown>).messages[1]!.content as string;

  const storedRow = async (id: string) =>
    (await pg.handle.db.select().from(t.prBrief)).find((r) => r.prId === id);

  const briefRowsFor = async (id: string) =>
    (await pg.handle.db.select().from(t.prBrief)).filter((r) => r.prId === id);

  // ---- AC-11: the read surface never invokes the model ----
  it('GET before any generation serves the explicit none-state with zero model calls', async () => {
    const { app, openai } = await makeApp();
    const res = await app.inject({ url: `/pulls/${prId}/brief` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      pr_id: prId,
      brief: null,
      current_head_sha: 'abc123def456',
      stale: false,
    });
    expect(openai.calls).toHaveLength(0);
    await app.close();
  });

  // ---- AC-7/AC-12/AC-15/AC-16: the generation loop, end to end ----
  it('generates from one structured call, stores one row, and serves it back identically', async () => {
    const { app, openai } = await makeApp({ draft: DRAFT_CLEAN });
    const res = await app.inject({ method: 'POST', url: `/pulls/${prId}/brief` });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Exactly ONE structured call (AC-15), on the registry-default model.
    expect(structuredCalls(openai)).toHaveLength(1);
    expect(body.brief.generation.model).toBe('gpt-4.1');
    expect(body.brief.generation.prompt_tokens).toBeGreaterThan(0);
    expect(body.brief.generation.completion_tokens).toBe(50);
    expect(body.brief.generation.cost_usd).toBe(0.001);
    expect(body.brief.generation.generated_for_sha).toBe('abc123def456');

    // Missing inputs: everything is present except the linked issue (the
    // default GitHub mock carries none).
    expect(body.brief.generation.missing_inputs).toEqual(['linked_issue']);

    // The response is contract-valid and matches the stored row exactly.
    expect(() => PrBrief.parse(body.brief)).not.toThrow();
    expect(body.brief.summary).toBe(DRAFT_CLEAN.summary);
    const row = await storedRow(prId);
    expect(row!.json).toEqual(body.brief);
    expect(await briefRowsFor(prId)).toHaveLength(1);

    // AC-16: the prompt is reproducible from the fixtures — per-file stats
    // and role tags, citable list, intent, blast, wrapped PR text and specs;
    // NO hunk bodies anywhere.
    const prompt = userPromptOf(openai);
    expect(prompt).toContain('PR #201 — brief request');
    expect(prompt).toContain('<untrusted source="pr-title">');
    expect(prompt).toContain('Add PR brief generation');
    expect(prompt).toContain('src/modules/brief/service.ts (+120/-8) [core]');
    expect(prompt).toContain('README.md (+6/-1) [docs]');
    expect(prompt).toContain('CITABLE FILES (PR files ∪ blast map) (4)');
    expect(prompt).toContain('- src/modules/brief/service.ts');
    expect(prompt).toContain('- src/modules/reviews/run-executor.ts'); // blast-map member
    expect(prompt).toContain('Goal: "Ship the brief card so a cold PR is triageable from one place."');
    expect(prompt).toContain('Downstream callers:');
    expect(prompt).toContain('- runOneAgent src/modules/reviews/run-executor.ts:7');
    expect(prompt).toContain('<untrusted source="pr-description">');
    expect(prompt).toContain('Depends on intent, blast radius and the attached specs.');
    expect(prompt).toContain('<untrusted source="specs/api-layering.md">');
    expect(prompt).toContain('The service is layered');
    expect(prompt).not.toContain('@@');
    expect(prompt).not.toContain('+++ b/');
    expect(prompt).not.toContain('--- a/');

    // A re-GET serves the identical row with no further model calls (AC-7).
    const again = await app.inject({ url: `/pulls/${prId}/brief` });
    expect(again.statusCode).toBe(200);
    expect(again.json().brief).toEqual(body.brief);
    expect(structuredCalls(openai)).toHaveLength(1);
    await app.close();
  });

  // ---- AC-4: the linked-issue-present variant completes the input set ----
  it('includes the linked issue when GitHub has one, and then nothing is missing', async () => {
    const github = new MockGitHubClient({
      detail: {
        linked_issue: { number: 471, title: 'API times out under load', body: 'Users report 504s.', state: 'open' },
      },
    });
    const { app, openai } = await makeApp({ github });
    const res = await app.inject({ method: 'POST', url: `/pulls/${prId}/brief` });
    expect(res.statusCode).toBe(200);
    expect(res.json().brief.generation.missing_inputs).toEqual([]);
    const prompt = userPromptOf(openai);
    expect(prompt).toContain('<untrusted source="issue-471">');
    expect(prompt).toContain('API times out under load');
    await app.close();
  });

  // ---- AC-9: the grounding gate ----
  it('drops invented refs/items, drops all-invented risks, keeps blast-map-only files', async () => {
    const { app } = await makeApp(); // default DRAFT carries the invented entries
    const res = await app.inject({ method: 'POST', url: `/pulls/${prId}/brief` });
    expect(res.statusCode).toBe(200);
    const brief = res.json().brief;

    // The honest risk with one invented ref survives with the ref filtered.
    const filtered = brief.risks.risks.find(
      (r: { title: string }) => r.title === 'Invented ref inside an honest risk',
    );
    expect(filtered.file_refs).toEqual(['src/modules/brief/service.ts']);
    // The all-invented risk is gone entirely.
    expect(
      brief.risks.risks.some((r: { title: string }) => r.title === 'All references invented'),
    ).toBe(false);
    // The invented focus item is gone; the blast-map-only item SURVIVES.
    const focusFiles = brief.review_focus.map((f: { file: string }) => f.file);
    expect(focusFiles).not.toContain('src/invented/nothing.ts');
    expect(focusFiles).toContain('src/modules/reviews/run-executor.ts');
    // …and the counts add up: one risk + one focus item dropped.
    expect(brief.generation.dropped_ungrounded).toBe(2);

    expect((await storedRow(prId))!.json).toEqual(brief);
    await app.close();
  });

  // ---- AC-4 / edges 1-2-3-8: everything missing still generates ----
  it('generates with all five inputs missing and empty lists, on the sparse PR', async () => {
    const { app, openai } = await makeApp({ blastMode: 'partial' });
    const res = await app.inject({ method: 'POST', url: `/pulls/${sparsePrId}/brief` });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.brief.generation.missing_inputs).toEqual([
      'intent',
      'blast',
      'description',
      'linked_issue',
      'attached_specs',
    ]);
    // No files and no blast map: the citable universe is empty, so every
    // ref/item is ungrounded — served as explicit empty lists (AC-5 shape).
    expect(body.brief.risks.risks).toEqual([]);
    expect(body.brief.review_focus).toEqual([]);
    expect(body.brief.generation.dropped_ungrounded).toBe(8); // 4 risks + 4 focus items
    const prompt = userPromptOf(openai);
    expect(prompt).toContain('Blast radius: not available');
    await app.close();
  });

  // ---- AC-5: explicit empty lists from an honest empty draft ----
  it('serves empty risks and focus arrays when the draft is empty', async () => {
    const { app } = await makeApp({ draft: EMPTY_DRAFT });
    const res = await app.inject({ method: 'POST', url: `/pulls/${prId}/brief` });
    expect(res.statusCode).toBe(200);
    const brief = res.json().brief;
    expect(brief.risks.risks).toEqual([]);
    expect(brief.review_focus).toEqual([]);
    expect(brief.generation.dropped_ungrounded).toBe(0);
    await app.close();
  });

  // ---- AC-8: refresh replaces the single row and advances generated_at ----
  it('a second POST replaces the one row with new content and a later generated_at', async () => {
    const app1 = await makeApp();
    const first = await app1.app.inject({ method: 'POST', url: `/pulls/${prId}/brief` });
    expect(first.statusCode).toBe(200);
    const gen1 = first.json().brief.generation.generated_at;
    await app1.app.close();

    await new Promise((r) => setTimeout(r, 20)); // distinct timestamp

    const app2 = await makeApp({ draft: DRAFT_V2 });
    const second = await app2.app.inject({ method: 'POST', url: `/pulls/${prId}/brief` });
    expect(second.statusCode).toBe(200);
    const brief2 = second.json().brief;

    expect(await briefRowsFor(prId)).toHaveLength(1);
    expect(brief2.summary).toBe('Version two: the same PR, restated for refresh.');
    expect(brief2.generation.generated_at > gen1).toBe(true);
    expect((await storedRow(prId))!.json).toEqual(brief2);
    await app2.app.close();
  });

  // ---- AC-20: staleness is serve-and-indicate, never auto-regeneration ----
  it('serves the cached brief marked stale after a head-SHA change, with no model call', async () => {
    const seeded = await makeApp();
    const post = await seeded.app.inject({ method: 'POST', url: `/pulls/${prId}/brief` });
    const cached = post.json().brief;
    await seeded.app.close();

    await pg.handle.db
      .update(t.pullRequests)
      .set({ headSha: 'ffffff000000' })
      .where(eq(t.pullRequests.id, prId));

    const { app, openai } = await makeApp();
    const res = await app.inject({ url: `/pulls/${prId}/brief` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.stale).toBe(true);
    expect(body.current_head_sha).toBe('ffffff000000');
    expect(body.brief).toEqual(cached); // the OLD document, still served
    expect(body.brief.generation.generated_for_sha).toBe('abc123def456');
    expect(openai.calls).toHaveLength(0); // no auto-regeneration on GET
    await app.close();

    // Restore for the remaining cases.
    await pg.handle.db
      .update(t.pullRequests)
      .set({ headSha: 'abc123def456' })
      .where(eq(t.pullRequests.id, prId));
  });

  // ---- AC-10: a failing model run leaves the stored row untouched ----
  it('returns 5xx and keeps the stored row byte-identical when the model call fails', async () => {
    const seeded = await makeApp();
    await seeded.app.inject({ method: 'POST', url: `/pulls/${prId}/brief` });
    const before = await storedRow(prId);
    await seeded.app.close();

    // A fixture that fails BriefDraftSchema makes MockLLMProvider throw —
    // the service propagates and never reaches the upsert.
    const bad = await makeApp({ draft: { nonsense: true } });
    const res = await bad.app.inject({ method: 'POST', url: `/pulls/${prId}/brief` });
    expect(res.statusCode).toBe(500);

    const after = await storedRow(prId);
    expect(after!.json).toEqual(before!.json);
    await bad.app.close();
  });

  // ---- edge 10: a contract-invalid stored row degrades to brief: null ----
  it('serves brief: null (200, never a 500) for a stored row that fails the contract', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ url: `/pulls/${brokenPrId}/brief` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.brief).toBeNull();
    expect(body.stale).toBe(false);
    expect(body.current_head_sha).toBe('0d0d0d0d0d0d');
    await app.close();
  });

  // ---- edge 7: concurrent POSTs converge on one valid row ----
  it('two concurrent POSTs leave exactly one parseable row after both settle', async () => {
    const { app, openai } = await makeApp();
    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: `/pulls/${prId}/brief` }),
      app.inject({ method: 'POST', url: `/pulls/${prId}/brief` }),
    ]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect(structuredCalls(openai)).toHaveLength(2);

    const rows = await briefRowsFor(prId);
    expect(rows).toHaveLength(1);
    expect(() => PrBrief.parse(rows[0]!.json)).not.toThrow();
    await app.close();
  });

  // ---- AC-19: the workspace's feature-model override picks the model ----
  it('uses the settings override when set, and the registry default when unset', async () => {
    const openrouter = new MockLLMProvider('openrouter', {
      structuredBySchema: { PrBriefDraft: DRAFT_CLEAN },
    });
    const { app, openai } = await makeApp({ extraLlm: { openrouter } });

    const put = await app.inject({
      method: 'PUT',
      url: '/settings',
      payload: {
        feature_models: { risk_brief: { provider: 'openrouter', model: 'test-brief-model' } },
      },
    });
    expect(put.statusCode).toBe(200);

    const overridden = await app.inject({ method: 'POST', url: `/pulls/${prId}/brief` });
    expect(overridden.statusCode).toBe(200);
    expect(overridden.json().brief.generation.model).toBe('test-brief-model');
    expect(structuredCalls(openrouter)).toHaveLength(1);
    expect(structuredCalls(openai)).toHaveLength(0);

    // Unsetting the override falls back to the registry default.
    const clear = await app.inject({
      method: 'PUT',
      url: '/settings',
      payload: { feature_models: {} },
    });
    expect(clear.statusCode).toBe(200);

    const defaulted = await app.inject({ method: 'POST', url: `/pulls/${prId}/brief` });
    expect(defaulted.statusCode).toBe(200);
    expect(defaulted.json().brief.generation.model).toBe('gpt-4.1');
    expect(structuredCalls(openai)).toHaveLength(1);
    await app.close();
  });

  // ---- AC-17: caps and markers on a huge PR ----
  it('caps the file list with a marker and the description at its cap; title/stats/intent stay', async () => {
    const { app, openai } = await makeApp({ draft: DRAFT_CLEAN });
    const res = await app.inject({ method: 'POST', url: `/pulls/${hugePrId}/brief` });
    expect(res.statusCode).toBe(200);
    const prompt = userPromptOf(openai);

    // Edge 4: > FILE_LIST_CAP files → explicit markers on BOTH the stats
    // lines and the citable listing; grounding still uses the full set.
    expect(prompt).toContain('… and 190 more files');
    expect(prompt).toContain('packages/payments/src/features/invoices/components/rows/InvoiceTableRowItemComponent-59.tsx (+3/-1)');
    expect(prompt).not.toContain('InvoiceTableRowItemComponent-60.tsx (+3/-1)');
    // The citable LISTING is capped too — the header keeps the FULL count
    // (250 PR files ∪ blast map = 252) plus the valid-but-unlisted marker.
    expect(prompt).toContain('CITABLE FILES (PR files ∪ blast map) (252)');
    expect(prompt).toContain('- packages/payments/src/features/invoices/components/rows/InvoiceTableRowItemComponent-59.tsx');
    expect(prompt).not.toContain('- packages/payments/src/features/invoices/components/rows/InvoiceTableRowItemComponent-60.tsx');
    expect(prompt).toContain('… and 192 more files (valid but not listed)');

    // AC-17: title, diff stats, intent are never dropped…
    expect(prompt).toContain('<untrusted source="pr-title">');
    expect(prompt).toContain('Mechanical rename across every feature');
    expect(prompt).toContain('(+3/-1) [core]');
    expect(prompt).toContain('Goal: "Rename without behavior change."');
    // …while the long description is capped at its CHAR_CAP.
    expect(prompt).toContain('L'.repeat(3_500));
    expect(prompt).not.toContain('L'.repeat(4_200));
    // The budget drop ORDER (specs → issue → description) is pinned
    // hermetically in brief-helpers.test.ts — the fixture clone's three
    // small docs cannot squeeze the 12k budget from the HTTP lane.
    expect(res.json().brief.generation.prompt_tokens).toBeGreaterThan(0);
    await app.close();
  });

  // ---- tenancy: another workspace's PR 404s on both routes ----
  it('404s a cross-workspace PR id on GET and on POST', async () => {
    const { app, openai } = await makeApp();
    const get = await app.inject({ url: `/pulls/${otherWorkspacePrId}/brief` });
    expect(get.statusCode).toBe(404);

    const post = await app.inject({ method: 'POST', url: `/pulls/${otherWorkspacePrId}/brief` });
    expect(post.statusCode).toBe(404);
    expect(openai.calls).toHaveLength(0);
    await app.close();
  });

  // ---- the POST is rate-limited tighter than the global cap ----
  it('returns 429 on the 4th rapid POST, with at most 3 model calls', async () => {
    const { app, openai } = await makeApp({ nodeEnv: 'development' });
    const codes: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const res = await app.inject({ method: 'POST', url: `/pulls/${prId}/brief` });
      codes.push(res.statusCode);
    }
    expect(codes).toEqual([200, 200, 200, 429]);
    expect(structuredCalls(openai)).toHaveLength(3);
    await app.close();
  });
});
