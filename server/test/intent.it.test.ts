/**
 * PR Intent — DB-backed integration (Testcontainers pg; self-skips without
 * Docker): repository roundtrip over every migration-0015 column, the three
 * routes (GET 404-when-absent, POST re-derive, PUT feedback), and the
 * foreign-PR 404 guard. The classifier model is a fixture; GitHub/git are
 * mocks, so the halves around the model are what's under test.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitHubClient, MockGitClient, MockLLMProvider } from '../src/adapters/mocks.js';
import type { FastifyInstance } from 'fastify';
import type { IntentClassification, PrIntentDetail, UnifiedDiff } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  console.warn('[intent] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF: UnifiedDiff = {
  raw: 'diff --git a/src/config.ts b/src/config.ts',
  files: [{ path: 'src/config.ts', additions: 4, deletions: 0, hunks: [] }],
};

/** The classifier's self-report (validated against IntentClassification). */
const INTENT_FIXTURE: IntentClassification = {
  reasoning: 'Body and linked issue state the hardening goal.',
  intent: 'Rate-limit the public API endpoints.',
  category: 'feature',
  breaking_change: false,
  in_scope: ['public endpoints', 'limiter middleware'],
  out_of_scope: ['admin routes'],
  confidence: 0.86,
  evidence_used: ['title', 'description', 'linked_issue', 'diff'],
};

/** A full PrIntentWrite for the direct repository roundtrip. */
const WRITE = {
  ...INTENT_FIXTURE,
  inferred: false,
  sources: [
    { source: 'title' as const },
    { source: 'description' as const },
    { source: 'linked_issue' as const, detail: '#471' },
  ],
  model: 'deepseek/deepseek-v4-flash',
  costUsd: 0.0007,
};

d('PR Intent: storage + API (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let prId: string;
  let app: FastifyInstance;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    const [pr] = await pg.handle.db.select().from(t.pullRequests).limit(1);
    prId = pr!.id;
    // The POST test proves pass-through of a SOURCED classification (spec 04
    // D3): force the documentary path — body null ⇒ the (mocked) fresh GitHub
    // fetch supplies description + linked_issue #471, so every fixture claim
    // is backed and the mechanical cap must NOT fire. A seeded non-null body
    // would skip the fetch, drop the linked_issue claim and cap at 0.5 — the
    // inferred/cap path is covered hermetically in test/intent.test.ts.
    await pg.handle.db.update(t.pullRequests).set({ body: null }).where(eq(t.pullRequests.id, prId));
    app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        llm: {
          openrouter: new MockLLMProvider('openrouter', {
            structuredBySchema: { IntentClassification: INTENT_FIXTURE },
          }),
        },
        git: new MockGitClient({ diff: DIFF.raw }),
        github: new MockGitHubClient({
          detail: {
            body: 'Add rate limiting. Closes #471.',
            linked_issue: { number: 471, title: 'API crashes under load', body: null, state: 'open' },
          },
        }),
      },
    });
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it('upsertIntent/getIntentDetail roundtrip persists every new column; derived_at ISO round-trips', async () => {
    // Use a second seeded PR so the route tests below stay independent.
    const rows = await pg.handle.db.select().from(t.pullRequests);
    const other = rows.find((r) => r.id !== prId)!;

    await app.container.reviewRepo.upsertIntent(other.id, WRITE);
    const detail = await app.container.reviewRepo.getIntentDetail(other.id);

    expect(detail).toBeDefined();
    const got: PrIntentDetail = detail!;
    expect(got.pr_id).toBe(other.id);
    expect(got.reasoning).toBe(WRITE.reasoning);
    expect(got.intent).toBe(WRITE.intent);
    expect(got.category).toBe('feature');
    expect(got.breaking_change).toBe(false);
    expect(got.in_scope).toEqual(['public endpoints', 'limiter middleware']);
    expect(got.out_of_scope).toEqual(['admin routes']);
    expect(got.confidence).toBe(0.86);
    expect(got.evidence_used).toEqual(INTENT_FIXTURE.evidence_used);
    expect(got.inferred).toBe(false);
    expect(got.sources).toEqual(WRITE.sources);
    expect(got.model).toBe('deepseek/deepseek-v4-flash');
    expect(got.cost_usd).toBe(0.0007);
    expect(got.feedback).toBeNull();
    expect(got.feedback_note).toBeNull();
    // derived_at: Date in the row → ISO string on the wire → parseable back.
    expect(typeof got.derived_at).toBe('string');
    expect(new Date(got.derived_at).toISOString()).toBe(got.derived_at);

    // Re-derive upsert overwrites AND resets feedback.
    await app.container.reviewRepo.setIntentFeedback(other.id, 'correct', 'ok');
    await app.container.reviewRepo.upsertIntent(other.id, {
      ...WRITE,
      category: 'bugfix',
      confidence: 0.42,
    });
    const overwritten = await app.container.reviewRepo.getIntentDetail(other.id);
    expect(overwritten!.category).toBe('bugfix');
    expect(overwritten!.confidence).toBeCloseTo(0.42, 5);
    expect(overwritten!.feedback).toBeNull();
    expect(overwritten!.feedback_note).toBeNull();
  });

  it('GET /pulls/:id/intent → 404 before any derivation', async () => {
    const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/intent` });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  });

  it('POST /pulls/:id/intent → 200 PrIntentDetail from the fixture; GET then 200', async () => {
    const post = await app.inject({ method: 'POST', url: `/pulls/${prId}/intent` });
    expect(post.statusCode).toBe(200);
    const body: PrIntentDetail = post.json();
    expect(body.pr_id).toBe(prId);
    expect(body.category).toBe('feature');
    expect(body.confidence).toBeCloseTo(0.86, 5);
    expect(body.sources).toContainEqual({ source: 'linked_issue', detail: '#471' });
    expect(body.model).toBe('deepseek/deepseek-v4-flash');
    expect(body.inferred).toBe(false);

    const get = await app.inject({ method: 'GET', url: `/pulls/${prId}/intent` });
    expect(get.statusCode).toBe(200);
    expect(get.json().intent).toBe('Rate-limit the public API endpoints.');
  });

  it('PUT /pulls/:id/intent/feedback → 200 with the verdict + note persisted', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: `/pulls/${prId}/intent/feedback`,
      payload: { verdict: 'correct', note: 'matches the plan' },
    });
    expect(put.statusCode).toBe(200);
    const body: PrIntentDetail = put.json();
    expect(body.feedback).toBe('correct');
    expect(body.feedback_note).toBe('matches the plan');

    const get = await app.inject({ method: 'GET', url: `/pulls/${prId}/intent` });
    expect(get.json().feedback).toBe('correct');
    expect(get.json().feedback_note).toBe('matches the plan');
  });

  it('seeded foreign-PR guard: a random uuid 404s on every intent route', async () => {
    const uuid = '11111111-2222-4333-8444-555555555555';
    const get = await app.inject({ method: 'GET', url: `/pulls/${uuid}/intent` });
    const post = await app.inject({ method: 'POST', url: `/pulls/${uuid}/intent` });
    const put = await app.inject({
      method: 'PUT',
      url: `/pulls/${uuid}/intent/feedback`,
      payload: { verdict: 'correct' },
    });
    expect(get.statusCode).toBe(404);
    expect(post.statusCode).toBe(404);
    expect(put.statusCode).toBe(404);
  });
});
