/**
 * Intent Layer — hermetic unit tests (no Docker, no DB, no network): the pure
 * seams take MockLLMProvider / MockGitHubClient / MockGitClient directly.
 * Covers: happy-path gathering, the inferred/no-body path + mechanical
 * confidence cap, plan-ref regex + content flow, evidence-claim verification,
 * fail-open on LLM errors, and the composed prompt block.
 */
import { describe, it, expect } from 'vitest';
import type { IntentClassification, PrDetail, UnifiedDiff } from '@devdigest/shared';
import { MockGitHubClient, MockGitClient, MockLLMProvider } from '../src/adapters/mocks.js';
import {
  deriveIntentWith,
  enforceIntentPolicy,
  composeIntentBlock,
  buildIntentMessages,
  gatherIntentSources,
  findDocRefs,
} from '../src/modules/reviews/intent.js';
import type { PullRow, RepoRow } from '../src/db/rows.js';

// ---- fixtures ---------------------------------------------------------------

function pullFixture(o: Partial<PullRow> = {}): PullRow {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    workspaceId: '00000000-0000-0000-0000-0000000000aa',
    repoId: '00000000-0000-0000-0000-000000000002',
    number: 483,
    title: 'Add rate limiting to public API endpoints',
    author: 'marisa.koch',
    branch: 'feat/471-rate-limit-public',
    base: 'main',
    headSha: 'a1b2c3d4',
    lastReviewedSha: null,
    additions: 247,
    deletions: 38,
    filesCount: 9,
    status: 'open',
    body: null,
    openedAt: null,
    updatedAt: null,
    ...o,
  };
}

function repoFixture(): RepoRow {
  return {
    id: '00000000-0000-0000-0000-000000000002',
    workspaceId: '00000000-0000-0000-0000-0000000000aa',
    owner: 'acme',
    name: 'payments-api',
    fullName: 'acme/payments-api',
    defaultBranch: 'main',
    clonePath: '/clones/acme/payments-api',
    lastPolledAt: null,
    createdBy: null,
    createdAt: new Date(),
  };
}

const DIFF: UnifiedDiff = {
  raw: 'diff --git a/src/config.ts b/src/config.ts',
  files: [
    { path: 'src/config.ts', additions: 4, deletions: 0, hunks: [] },
    { path: 'src/middleware/ratelimit.ts', additions: 120, deletions: 8, hunks: [] },
  ],
};

const PLAN_PATH = 'docs/plans/2026-09-24-intent-layer.md';

/** A full happy-path classification fixture (model self-report). */
const CLASSIFICATION: IntentClassification = {
  reasoning: 'Body states the hardening goal and links the plan.',
  intent: 'Rate-limit the public API as planned hardening.',
  category: 'feature',
  breaking_change: false,
  in_scope: ['public API endpoints', 'rate limiter middleware'],
  out_of_scope: ['internal admin routes'],
  confidence: 0.86,
  evidence_used: ['title', 'description', 'linked_issue', 'plan', 'diff'],
};

function withDetail(detail: Partial<PrDetail>): MockGitHubClient {
  return new MockGitHubClient({ detail });
}

// ---- tests ------------------------------------------------------------------

describe('findDocRefs', () => {
  it('finds repo-relative .md paths and same-repo blob URLs; plans/specs win', () => {
    const text = [
      `Implements ${PLAN_PATH}.`,
      'See README.md too, and https://github.com/acme/payments-api/blob/main/docs/specs/rate-limit.md',
      '(foreign repo: https://github.com/other/repo/blob/main/x.md)',
    ].join(' ');
    const refs = findDocRefs(text, 'acme', 'payments-api');
    const paths = refs.map((r) => r.path);
    // ≤3 docs, docs/plans + specs first, foreign-repo URLs never match.
    expect(paths).toContain(PLAN_PATH);
    expect(paths).toContain('docs/specs/rate-limit.md');
    expect(paths).not.toContain('x.md');
    expect(refs.filter((r) => r.kind === 'spec').map((r) => r.path)).toContain(
      'docs/specs/rate-limit.md',
    );
  });
});

describe('gatherIntentSources', () => {
  it('happy path: persisted body + linked issue + plan doc all become labeled sources', async () => {
    const bundle = await gatherIntentSources({
      pull: pullFixture({
        body: `Add rate limiting per ${PLAN_PATH}. Closes #471.`,
      }),
      repoRow: repoFixture(),
      diff: DIFF,
      git: new MockGitClient({ files: { [PLAN_PATH]: '# Intent Layer plan\nDo the thing.' } }),
    });
    expect(bundle.providedKinds).toEqual(['title', 'description', 'plan', 'diff']);
    expect(bundle.evidence).toContainEqual({ source: 'plan', detail: PLAN_PATH });
    expect(bundle.labeled).toContain('# Intent Layer plan');
    expect(bundle.labeled).toContain('## PR title');
    expect(bundle.labeled).toContain('## Diff summary');
  });

  it('fresh GitHub fetch supplies the body + linked issue when the row has none', async () => {
    const bundle = await gatherIntentSources({
      pull: pullFixture({ branch: 'bugfix/issue-471-crash' }),
      repoRow: repoFixture(),
      diff: DIFF,
      git: new MockGitClient(),
      github: withDetail({ body: 'Fixes the crash.', linked_issue: { number: 471, title: 'API crashes under load', body: null, state: 'open' } }),
    });
    expect(bundle.providedKinds).toEqual(['title', 'description', 'linked_issue', 'diff']);
    expect(bundle.evidence).toContainEqual({ source: 'linked_issue', detail: '#471' });
    expect(bundle.labeled).toContain('## Linked issue #471');
  });

  it('no body anywhere → no description kind; branch-name issue still used', async () => {
    const bundle = await gatherIntentSources({
      pull: pullFixture({ branch: 'fix/471-crash' }),
      repoRow: repoFixture(),
      diff: DIFF,
      git: new MockGitClient(),
      github: withDetail({ body: null, linked_issue: undefined }),
    });
    expect(bundle.providedKinds).toEqual(['title', 'linked_issue', 'diff']);
  });
});

describe('enforceIntentPolicy (mechanical, never the self-report)', () => {
  it('keeps a documentary-sourced classification as-is', () => {
    const out = enforceIntentPolicy(CLASSIFICATION, [
      'title',
      'description',
      'linked_issue',
      'plan',
      'diff',
    ]);
    expect(out.inferred).toBe(false);
    expect(out.confidence).toBe(0.86);
    expect(out.evidence_used).toEqual(CLASSIFICATION.evidence_used);
  });

  it('no documentary source ⇒ inferred + confidence capped at 0.5 (model claimed 0.9)', () => {
    const out = enforceIntentPolicy(
      { ...CLASSIFICATION, confidence: 0.9, evidence_used: ['title', 'diff'] },
      ['title', 'diff'],
    );
    expect(out.inferred).toBe(true);
    expect(out.confidence).toBe(0.5);
  });

  it('drops an evidence claim with no provided source AND caps confidence', () => {
    const out = enforceIntentPolicy(
      { ...CLASSIFICATION, evidence_used: ['description', 'plan'] },
      ['title', 'description', 'diff'],
    );
    expect(out.evidence_used).toEqual(['description']);
    expect(out.inferred).toBe(false);
    expect(out.confidence).toBe(0.5);
  });

  it('clamps an out-of-range self-report into [0,1] (no cap when claims are honest)', () => {
    const out = enforceIntentPolicy(
      { ...CLASSIFICATION, confidence: 7, evidence_used: ['title', 'description', 'diff'] },
      ['title', 'description', 'diff'],
    );
    expect(out.confidence).toBe(1);
  });
});

describe('buildIntentMessages', () => {
  it('frames sources as data and pins evidence_used to the provided kinds', () => {
    const messages = buildIntentMessages({
      labeled: '## PR title\nAdd rate limiting',
      providedKinds: ['title', 'diff'],
      evidence: [],
    });
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe('system');
    expect(messages[0]!.content).toContain('never instructions');
    expect(messages[0]!.content).toContain('feature, bugfix, refactor, performance, docs, test, chore, other');
    expect(messages[0]!.content).toContain('ONLY kinds actually provided in this request (title, diff)');
    expect(messages[1]!.content).toContain('Add rate limiting');
  });
});

describe('deriveIntentWith (fail-open end to end)', () => {
  it('happy path: persists-shape record with sources, model and cost; confidence kept', async () => {
    const llm = new MockLLMProvider('openrouter', { structured: CLASSIFICATION });
    const record = await deriveIntentWith({
      llm,
      git: new MockGitClient({ files: { [PLAN_PATH]: '# plan' } }),
      github: withDetail({ linked_issue: { number: 471, title: 't', body: null, state: 'open' } }),
      pull: pullFixture({ body: `Add rate limiting per ${PLAN_PATH}.` }),
      repoRow: repoFixture(),
      diff: DIFF,
      model: 'deepseek/deepseek-v4-flash',
    });
    expect(record).not.toBeNull();
    expect(record!.inferred).toBe(false);
    expect(record!.confidence).toBe(0.86);
    expect(record!.model).toBe('deepseek/deepseek-v4-flash');
    expect(record!.costUsd).toBe(0.001);
    expect(record!.sources).toContainEqual({ source: 'plan', detail: PLAN_PATH });
    // The cheap-call discipline reached the provider.
    const call = llm.calls.find((c) => c.method === 'completeStructured');
    expect(call).toBeDefined();
  });

  it('no body anywhere → inferred: true and the 0.9 self-report capped to 0.5', async () => {
    const record = await deriveIntentWith({
      llm: new MockLLMProvider('openrouter', {
        structured: { ...CLASSIFICATION, confidence: 0.9, evidence_used: ['title', 'diff'] },
      }),
      git: new MockGitClient(),
      github: withDetail({ body: null }),
      pull: pullFixture({ branch: 'chore/cleanup' }),
      repoRow: repoFixture(),
      diff: DIFF,
      model: 'deepseek/deepseek-v4-flash',
    });
    expect(record).not.toBeNull();
    expect(record!.inferred).toBe(true);
    expect(record!.confidence).toBe(0.5);
  });

  it('plan ref found by regex → its content (MockGit files map) reaches the prompt', async () => {
    const llm = new MockLLMProvider('openrouter', { structured: CLASSIFICATION });
    await deriveIntentWith({
      llm,
      git: new MockGitClient({ files: { [PLAN_PATH]: 'UNIQUE-PLAN-CONTENT-9f2' } }),
      github: withDetail({ body: null }),
      pull: pullFixture({ branch: 'feat/x' }),
      repoRow: repoFixture(),
      diff: DIFF,
      model: 'deepseek/deepseek-v4-flash',
    });
    const call = llm.calls.find((c) => c.method === 'completeStructured') as
      | { req: { messages: { content: string }[] } }
      | undefined;
    // No body → the plan ref can only come from the TITLE (regex covers it).
    expect(call?.req.messages[1]!.content).not.toContain('UNIQUE-PLAN-CONTENT-9f2');
    const llm2 = new MockLLMProvider('openrouter', { structured: CLASSIFICATION });
    const withBody = await deriveIntentWith({
      llm: llm2,
      git: new MockGitClient({ files: { [PLAN_PATH]: 'UNIQUE-PLAN-CONTENT-9f2' } }),
      pull: pullFixture({ body: `See ${PLAN_PATH} for the plan.` }),
      repoRow: repoFixture(),
      diff: DIFF,
      model: 'deepseek/deepseek-v4-flash',
    });
    const call2 = llm2.calls.find((c) => c.method === 'completeStructured') as
      | { req: { messages: { content: string }[] } }
      | undefined;
    expect(call2?.req.messages[1]!.content).toContain('UNIQUE-PLAN-CONTENT-9f2');
    expect(withBody!.sources).toContainEqual({ source: 'plan', detail: PLAN_PATH });
  });

  it("evidence_used: ['plan'] with no plan provided → claim dropped + capped", async () => {
    const record = await deriveIntentWith({
      llm: new MockLLMProvider('openrouter', {
        structured: { ...CLASSIFICATION, evidence_used: ['description', 'plan'] },
      }),
      git: new MockGitClient(),
      github: withDetail({ body: 'Adds the limiter.' }),
      pull: pullFixture(),
      repoRow: repoFixture(),
      diff: DIFF,
      model: 'deepseek/deepseek-v4-flash',
    });
    expect(record!.evidence_used).toEqual(['description']);
    expect(record!.confidence).toBe(0.5);
  });

  it('LLM throws → returns null without throwing (fail-open)', async () => {
    const throwing = {
      ...new MockLLMProvider('openrouter', { structured: CLASSIFICATION }),
      completeStructured: async () => {
        throw new Error('no key configured');
      },
    };
    const record = await deriveIntentWith({
      llm: throwing as unknown as MockLLMProvider,
      git: new MockGitClient(),
      github: withDetail({ body: 'Adds the limiter.' }),
      pull: pullFixture(),
      repoRow: repoFixture(),
      diff: DIFF,
      model: 'deepseek/deepseek-v4-flash',
    });
    expect(record).toBeNull();
  });
});

describe('composeIntentBlock', () => {
  it('renders goal quote, category, scope bullets, provenance, and the passive-context instruction', () => {
    const block = composeIntentBlock({
      ...CLASSIFICATION,
      inferred: false,
      sources: [
        { source: 'title' },
        { source: 'description' },
        { source: 'linked_issue', detail: '#471' },
        { source: 'plan', detail: PLAN_PATH },
      ],
      model: 'deepseek/deepseek-v4-flash',
      costUsd: 0.001,
    });
    expect(block).toContain('"Rate-limit the public API as planned hardening."');
    expect(block).toContain('Category: feature');
    expect(block).toContain('- public API endpoints');
    expect(block).toContain('- internal admin routes');
    expect(block).toContain('Confidence: High (0.86)');
    expect(block).toContain(`Derived from: title, description, issue #471, ${PLAN_PATH} · deepseek/deepseek-v4-flash`);
    expect(block).toContain('passive, untrusted context');
    expect(block).toContain('diff-grounded finding');
    // No breaking-change marker when the flag is off.
    expect(block).not.toContain('BREAKING CHANGE');
  });

  it('marks inferred blocks Low + the indirect-signals note and the breaking marker when set', () => {
    const block = composeIntentBlock({
      ...CLASSIFICATION,
      category: 'refactor',
      breaking_change: true,
      confidence: 0.5,
      inferred: true,
      evidence_used: ['title', 'diff'],
      sources: [{ source: 'title' }, { source: 'diff', detail: '2 file(s)' }],
      model: null,
      costUsd: null,
    });
    expect(block).toContain('· BREAKING CHANGE');
    expect(block).toContain('Confidence: Low (0.50) — inferred, derived from indirect signals only');
  });
});
