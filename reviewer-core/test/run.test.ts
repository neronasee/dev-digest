import { describe, it, expect } from 'vitest';
import type { Finding, LLMProvider, StructuredResult, UnifiedDiff } from '@devdigest/shared';
import { MockLLMProvider, MockGitClient } from '../../server/src/adapters/mocks.js';
import { parseUnifiedDiff } from '../../server/src/adapters/git/diff-parser.js';
import { reviewPullRequest } from '../src/index.js';

/**
 * Engine-level test for reviewPullRequest (the core lifted out of the server's
 * runOneAgent). Uses the server's mock LLM + git so we exercise the real
 * assemble → completeStructured → reduce → grounding pipeline with no DB/SSE.
 */
describe('reviewPullRequest (engine)', () => {
  // One grounded finding (line 11 is in the MockGitClient diff) + one
  // hallucinated finding (line 999) the grounding gate must drop.
  const fixture = {
    verdict: 'request_changes',
    summary: 'secret key committed',
    score: 38,
    findings: [
      {
        id: 'f1',
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key',
        file: 'src/config.ts',
        start_line: 11,
        end_line: 11,
        rationale: 'sk_live in diff',
        confidence: 0.98,
        kind: 'finding',
      },
      {
        id: 'f-hallucinated',
        severity: 'WARNING',
        category: 'bug',
        title: 'phantom finding on a line not in the diff',
        file: 'src/config.ts',
        start_line: 999,
        end_line: 999,
        rationale: 'not real',
        confidence: 0.3,
        kind: 'finding',
      },
    ],
  };

  it('single-pass: assembles, grounds, drops the hallucinated finding', async () => {
    const llm = new MockLLMProvider('openai', { structured: fixture });
    const diff = await new MockGitClient().diff();

    const events: string[] = [];
    const outcome = await reviewPullRequest({
      systemPrompt: 'security reviewer',
      model: 'gpt-4.1',
      diff,
      llm,
      task: 'Review PR #482',
      onEvent: (e) => events.push(e.msg),
    });

    expect(outcome.mode).toBe('single-pass');
    expect(outcome.grounding).toBe('1/2 passed');
    expect(outcome.review.findings).toHaveLength(1);
    expect(outcome.review.findings[0]!.start_line).toBe(11);
    expect(outcome.dropped).toHaveLength(1);
    // Score is derived from the SURVIVING findings, not the model's self-reported
    // 38: one CRITICAL remains after grounding ⇒ 100 − 35 = 65.
    expect(outcome.review.score).toBe(65);
    expect(outcome.review.verdict).toBe('request_changes');
    expect(outcome.review.summary).toContain('Hardcoded Stripe secret key');
    // progress is surfaced (server bridges this onto SSE; runner logs it)
    expect(events.some((m) => m.includes('Citation grounding'))).toBe(true);
  });

  it('score is deterministic from findings: a clean approve scores 100', async () => {
    // Model "approves" but reports a nonsense low score (the cheap-model bug).
    // The engine must ignore that and score the zero findings as a perfect 100.
    const clean = { verdict: 'approve', summary: 'looks good', score: 10, findings: [] };
    const llm = new MockLLMProvider('openai', { structured: clean });
    const diff = await new MockGitClient().diff();

    const outcome = await reviewPullRequest({
      systemPrompt: 'security reviewer',
      model: 'deepseek/deepseek-v4-flash',
      diff,
      llm,
      task: 'Review PR #5',
    });

    expect(outcome.review.findings).toHaveLength(0);
    expect(outcome.review.score).toBe(100);
    expect(outcome.review.verdict).toBe('approve');
    expect(outcome.review.summary).toBe('looks good');
  });

  it('dropping every candidate produces a clean grounded approve', async () => {
    const onlyHallucination = {
      verdict: 'request_changes',
      summary: 'model claims a blocker',
      score: 0,
      findings: [fixture.findings[1]],
    };
    const outcome = await reviewPullRequest({
      systemPrompt: 'reviewer',
      model: 'm',
      diff: await new MockGitClient().diff(),
      llm: new MockLLMProvider('openai', { structured: onlyHallucination }),
      ciFailOn: 'any',
    });
    expect(outcome.review).toMatchObject({ verdict: 'approve', score: 100, summary: 'No grounded findings.' });
    expect(outcome.review.findings).toEqual([]);
    expect(outcome.groundingDropped).toBe(1);
  });

  it('checkCancelled throwing aborts before the LLM call', async () => {
    const llm = new MockLLMProvider('openai', { structured: fixture });
    const diff = await new MockGitClient().diff();
    await expect(
      reviewPullRequest({
        systemPrompt: 's',
        model: 'gpt-4.1',
        diff,
        llm,
        checkCancelled: () => {
          throw new Error('cancelled');
        },
      }),
    ).rejects.toThrow('cancelled');
  });

  it('forwards sessionId to every LLM call (OpenRouter session grouping)', async () => {
    const seen: (string | undefined)[] = [];
    const recorder: LLMProvider = {
      id: 'openrouter',
      async completeStructured<T>(req): Promise<StructuredResult<T>> {
        seen.push(req.sessionId);
        return {
          data: fixture as unknown as T,
          model: req.model,
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
          raw: '',
          attempts: 1,
        };
      },
      async listModels() {
        return [];
      },
      async complete() {
        throw new Error('not used');
      },
      async embed() {
        return [];
      },
    };
    const diff = await new MockGitClient().diff();
    await reviewPullRequest({ systemPrompt: 's', model: 'm', diff, llm: recorder, sessionId: 'sess-abc' });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s === 'sess-abc')).toBe(true);
  });
});

/** Schema-valid finding at a single line (kept/dropped is decided by grounding). */
function mkFinding(o: {
  id: string;
  severity: Finding['severity'];
  file: string;
  line: number;
}): Finding {
  return {
    id: o.id,
    severity: o.severity,
    category: 'security',
    title: `${o.id} title`,
    file: o.file,
    start_line: o.line,
    end_line: o.line,
    rationale: 'because',
    confidence: 0.9,
    kind: 'finding',
  };
}

describe('reviewPullRequest — map-reduce golden path', () => {
  // Two files, one small hunk each. Parsing through the SERVER's real parser
  // keeps the fixture producer-faithful (this is the shape live diffs have).
  // auth.ts hunk covers new lines 10–12 (the '+' line is 11); db.ts covers 1–2.
  const RAW_TWO_FILES = [
    'diff --git a/src/auth.ts b/src/auth.ts',
    '--- a/src/auth.ts',
    '+++ b/src/auth.ts',
    '@@ -10,2 +10,3 @@',
    ' context',
    '+token = "hardcoded"',
    ' context',
    'diff --git a/src/db.ts b/src/db.ts',
    '--- a/src/db.ts',
    '+++ b/src/db.ts',
    '@@ -1,1 +1,2 @@',
    '+pool = { ssl: false }',
    ' context',
  ].join('\n');

  it('chunks per file, propagates sessionId per chunk, and merges with accumulated cost', async () => {
    // Queued per-chunk partials, in diff.files order: auth chunk comments with
    // one grounded finding; db chunk requests changes with one grounded + one
    // hallucinated (line 50) finding.
    const partials = [
      {
        verdict: 'comment',
        summary: 'auth issues',
        score: 90,
        findings: [mkFinding({ id: 'auth-1', severity: 'WARNING', file: 'src/auth.ts', line: 11 })],
      },
      {
        verdict: 'request_changes',
        summary: 'db issues',
        score: 40,
        findings: [
          mkFinding({ id: 'db-1', severity: 'SUGGESTION', file: 'src/db.ts', line: 1 }),
          mkFinding({ id: 'db-hallucinated', severity: 'WARNING', file: 'src/db.ts', line: 50 }),
        ],
      },
    ];
    const usage = [
      { tokensIn: 100, tokensOut: 40, costUsd: 0.25 },
      { tokensIn: 200, tokensOut: 60, costUsd: 0.5 },
    ];
    const calls: { sessionId?: string; userContent: string }[] = [];
    const llm: LLMProvider = {
      id: 'openrouter',
      async completeStructured<T>(req): Promise<StructuredResult<T>> {
        const i = calls.length; // consume queue position BEFORE pushing
        const last = req.messages[req.messages.length - 1]!;
        calls.push({ sessionId: req.sessionId, userContent: last.content });
        return {
          data: partials[i]! as unknown as T,
          model: req.model,
          tokensIn: usage[i]!.tokensIn,
          tokensOut: usage[i]!.tokensOut,
          costUsd: usage[i]!.costUsd,
          raw: `raw-chunk-${i + 1}`,
          attempts: 1,
        };
      },
      async listModels() {
        return [];
      },
      async complete() {
        throw new Error('not used');
      },
      async embed() {
        return [];
      },
    };

    const events: string[] = [];
    const outcome = await reviewPullRequest({
      systemPrompt: 'security reviewer',
      model: 'deepseek/deepseek-v4-flash',
      diff: parseUnifiedDiff(RAW_TWO_FILES),
      llm,
      // threshold 0 → 'auto' picks map-reduce for any non-empty multi-file diff
      mapThresholdLines: 0,
      strategy: 'auto',
      sessionId: 'sess-map-reduce',
      onEvent: (e) => events.push(e.msg),
    });

    // one completeStructured call PER FILE (≥2 total), each with the session id
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.sessionId === 'sess-map-reduce')).toBe(true);

    // each chunk's prompt contains ONLY its own file's slice
    expect(calls[0]!.userContent).toContain('+token = "hardcoded"');
    expect(calls[0]!.userContent).not.toContain('ssl: false');
    expect(calls[1]!.userContent).toContain('+pool = { ssl: false }');
    expect(calls[1]!.userContent).not.toContain('hardcoded');

    // map-reduce path ran, labeled per chunk
    expect(outcome.mode).toBe('map-reduce');
    expect(outcome.chunks).toEqual([{ label: 'src/auth.ts' }, { label: 'src/db.ts' }]);
    expect(events.some((m) => m.startsWith('map: reviewing src/auth.ts'))).toBe(true);

    // merged (reduced) result: worst verdict, joined summaries, and grounding
    // drops the hallucinated line-50 finding before the final review
    expect(outcome.review.verdict).toBe('comment');
    expect(outcome.review.summary).toContain('2 grounded findings');
    expect(outcome.review.findings.map((f) => f.id)).toEqual(['auth-1', 'db-1']);
    expect(outcome.grounding).toBe('2/3 passed');
    expect(outcome.dropped).toHaveLength(1);
    // score recomputed from SURVIVORS (WARNING + SUGGESTION → 100−12−3), not
    // the mean of the partials' self-reported scores (would be 65)
    expect(outcome.review.score).toBe(85);

    // multi-chunk usage is accumulated across the map calls
    expect(outcome.tokensIn).toBe(300);
    expect(outcome.tokensOut).toBe(100);
    expect(outcome.costUsd).toBe(0.75);
    expect(outcome.raw).toBe('raw-chunk-1\n---\nraw-chunk-2');
  });

  it('threshold 0 still single-passes a one-file diff (map-reduce needs >1 file)', async () => {
    const llm = new MockLLMProvider('openai', {
      structured: { verdict: 'approve', summary: 'ok', score: 100, findings: [] },
    });
    const outcome = await reviewPullRequest({
      systemPrompt: 's',
      model: 'm',
      diff: parseUnifiedDiff(RAW_TWO_FILES.split('diff --git a/src/db.ts')[0]!),
      llm,
      mapThresholdLines: 0,
    });
    expect(outcome.mode).toBe('single-pass');
  });
});

describe('reviewPullRequest — entry contract gate (zod-validated diff)', () => {
  const neverCalled = (): { llm: LLMProvider; calls: () => number } => {
    let n = 0;
    const llm: LLMProvider = {
      id: 'openai',
      async completeStructured<T>(): Promise<StructuredResult<T>> {
        n++;
        throw new Error('LLM must not be called when the diff is malformed');
      },
      async listModels() {
        return [];
      },
      async complete() {
        throw new Error('not used');
      },
      async embed() {
        return [];
      },
    };
    return { llm, calls: () => n };
  };

  it('rejects a malformed hunk (string newStart) AT ENTRY, before any LLM call', async () => {
    // The classic silent degradation: JSON from persistence types newStart as a
    // string. Pre-gate, grounding's fallback loop concatenated '12' + 1 → '121'
    // and quietly grounded against nonsense; now the entry safeParse rejects it.
    const malformed = {
      raw: 'diff --git a/x.ts b/x.ts',
      files: [
        {
          path: 'x.ts',
          additions: 1,
          deletions: 0,
          hunks: [
            { file: 'x.ts', oldStart: 1, oldLines: 1, newStart: '12', newLines: 1, newLineNumbers: [12] },
          ],
        },
      ],
    } as unknown as UnifiedDiff;
    const { llm, calls } = neverCalled();

    await expect(
      reviewPullRequest({ systemPrompt: 's', model: 'm', diff: malformed, llm }),
    ).rejects.toThrow(/Invalid UnifiedDiff rejected at review entry.*files\.0\.hunks\.0\.newStart/);
    expect(calls()).toBe(0);
  });

  it('rejects a hunk missing newLineNumbers (a required array)', async () => {
    const malformed = {
      raw: 'diff --git a/x.ts b/x.ts',
      files: [
        {
          path: 'x.ts',
          additions: 1,
          deletions: 0,
          hunks: [{ file: 'x.ts', oldStart: 1, oldLines: 1, newStart: 2, newLines: 1 }],
        },
      ],
    } as unknown as UnifiedDiff;
    const { llm, calls } = neverCalled();

    await expect(
      reviewPullRequest({ systemPrompt: 's', model: 'm', diff: malformed, llm }),
    ).rejects.toThrow(
      /Invalid UnifiedDiff rejected at review entry.*files\.0\.hunks\.0\.newLineNumbers/,
    );
    expect(calls()).toBe(0);
  });

  it('accepts the parser’s 0-valued edge shapes: a deleted file emits +0,0 with empty newLineNumbers', async () => {
    // Permissiveness pin: the schema must accept EVERY real producer shape —
    // tightening newStart/newLines to ≥1 (or requiring non-empty
    // newLineNumbers) would fail live runs on deleted-file hunks.
    const deletedFile = [
      'diff --git a/gone.ts b/gone.ts',
      '--- a/gone.ts',
      '+++ b/gone.ts',
      '@@ -1,2 +0,0 @@',
      '-old line 1',
      '-old line 2',
    ].join('\n');
    const llm = new MockLLMProvider('openai', {
      structured: { verdict: 'approve', summary: 'ok', score: 100, findings: [] },
    });

    const outcome = await reviewPullRequest({
      systemPrompt: 's',
      model: 'm',
      diff: parseUnifiedDiff(deletedFile),
      llm,
    });
    expect(outcome.mode).toBe('single-pass');
    expect(outcome.review.verdict).toBe('approve');
  });
});
