import { describe, it, expect } from 'vitest';
import {
  findingPreviewsByPr,
  latestRoundByPr,
  latestScoresByPr,
  roundKeyOf,
  toPrMetaDto,
  type FindingPreviewRow,
  type RunRollupRow,
  type ReviewRunRefRow,
  type ReviewScoreRow,
} from './helpers.js';

/**
 * B24 — hermetic PR-list rollup tests. The rollup was the source of two
 * recorded INSIGHTS bugs (server/INSIGHTS.md 2026-09-16/17) but used to be
 * inline in the route, reachable only through DB-backed tests. These pin the
 * logic with plain row fixtures — no DB, no Docker.
 *
 * Fixtures are listed NEWEST-FIRST, matching the read surface's ordering
 * (`ran_at desc` / `created_at desc`): the rollup's correctness depends on
 * that order, so the tests exercise it exactly as the queries deliver it.
 */

let runSeq = 0;
/** A done run row; `at` only documents newest-first position (not read by the helper). */
function run(opts: {
  prId: string;
  multiRunId?: string | null;
  costUsd?: number | null;
  score?: number | null;
  status?: string;
  id?: string;
}): RunRollupRow {
  return {
    id: opts.id ?? `run-${++runSeq}`,
    prId: opts.prId,
    multiRunId: opts.multiRunId ?? null,
    costUsd: opts.costUsd ?? null,
    score: opts.score ?? null,
    status: opts.status ?? 'done',
  };
}

function reviewRef(id: string, runId: string): ReviewRunRefRow {
  return { id, runId };
}

function preview(reviewId: string, id: string): FindingPreviewRow {
  return {
    reviewId,
    id,
    severity: 'CRITICAL',
    category: 'security',
    title: `finding ${id}`,
    file: 'src/config.ts',
    startLine: 12,
    endLine: 12,
    confidence: 0.98,
    rationale: 'rationale',
  };
}

describe('roundKeyOf', () => {
  it('runs sharing a multi_run_id form one round', () => {
    expect(roundKeyOf({ id: 'a', multiRunId: 'm1' })).toBe('m1');
  });

  it('null multi_run_id (pre-grouping) rows are their own round', () => {
    expect(roundKeyOf({ id: 'a', multiRunId: null })).toBe('run:a');
    expect(roundKeyOf({ id: 'b', multiRunId: null })).toBe('run:b');
  });
});

describe('latestRoundByPr', () => {
  it('uses the minimum non-null score from the same latest successful round', () => {
    const rows = [
      run({ prId: 'pr1', multiRunId: 'm2', score: 88 }),
      run({ prId: 'pr1', multiRunId: 'm2', score: 61 }),
      run({ prId: 'pr1', multiRunId: 'm2', score: null }),
      run({ prId: 'pr1', multiRunId: 'm1', score: 12 }),
      run({ prId: 'pr1', multiRunId: 'm3', score: 1, status: 'failed' }),
    ];
    expect(latestRoundByPr(rows).scoreByPr.get('pr1')).toBe(61);
  });

  it('sums a whole round even though its rows keep arriving after its newest run (newest-first partial sums)', () => {
    // Round m1's NEWEST run is seen first; its older sibling arrives later in
    // the newest-first stream. Picking the round before summing all of them
    // would report cost 0.30 (the 2026-09-16 partial-sum bug) — the round's
    // real cost is the sum of BOTH runs.
    const rows = [
      run({ prId: 'pr1', multiRunId: 'm1', costUsd: 0.3 }), // newest of round m1
      run({ prId: 'pr1', multiRunId: 'm1', costUsd: 0.7 }), // older, same round
    ];
    const { costByPr } = latestRoundByPr(rows);
    expect(costByPr.get('pr1')).toBe(1.0);
  });

  it('null multi_run_id runs are their own round — the latest single run, not a merged sum', () => {
    const rows = [
      run({ prId: 'pr1', costUsd: 5 }), // newest, own round run:X
      run({ prId: 'pr1', costUsd: 2 }), // older, own round run:Y
    ];
    const { costByPr } = latestRoundByPr(rows);
    // Pre-grouping rows never share a round, so only the newest run's cost shows.
    expect(costByPr.get('pr1')).toBe(5);
  });

  it("picks each PR's LATEST round (newest-first), costing only that round", () => {
    const rows = [
      run({ prId: 'pr1', multiRunId: 'm2', costUsd: 0.1 }), // newest → round m2
      run({ prId: 'pr1', multiRunId: 'm2', costUsd: 0.2 }),
      run({ prId: 'pr1', multiRunId: 'm1', costUsd: 9 }), // older round m1
      run({ prId: 'pr1', multiRunId: 'm1', costUsd: 9 }),
    ];
    const { costByPr } = latestRoundByPr(rows);
    expect(costByPr.get('pr1')).toBeCloseTo(0.3, 10); // m2, not m1 (float sum)
  });

  it('excludes failed/cancelled runs — a newer failed round never masks an older successful one', () => {
    const rows = [
      run({ prId: 'pr1', multiRunId: 'm2', costUsd: 99, status: 'failed' }), // newest, FAILED
      run({ prId: 'pr1', multiRunId: 'm1', costUsd: 0.4, status: 'done' }), // latest successful
      run({ prId: 'pr1', multiRunId: 'm1', costUsd: 0.6, status: 'done' }),
    ];
    const { costByPr } = latestRoundByPr(rows);
    expect(costByPr.get('pr1')).toBe(1.0);
  });

  it('excludes failed runs even inside the latest otherwise-successful round', () => {
    // Defensive: the read surface filters status='done' in the query, but the
    // helper must not resurrect a failed sibling that slipped through.
    const rows = [
      run({ prId: 'pr1', multiRunId: 'm1', costUsd: 0.5, status: 'done' }),
      run({ prId: 'pr1', multiRunId: 'm1', costUsd: 7, status: 'cancelled' }),
    ];
    const { costByPr } = latestRoundByPr(rows);
    expect(costByPr.get('pr1')).toBe(0.5);
  });

  it('unpriced runs contribute nothing; a wholly unpriced round is null, not 0', () => {
    const rows = [
      run({ prId: 'pr1', multiRunId: 'm1', costUsd: 0.25 }),
      run({ prId: 'pr1', multiRunId: 'm1', costUsd: null }), // unpriced sibling
      run({ prId: 'pr2', multiRunId: 'm2', costUsd: null }), // whole round unpriced
    ];
    const { costByPr } = latestRoundByPr(rows);
    expect(costByPr.get('pr1')).toBe(0.25);
    expect(costByPr.get('pr2')).toBeNull();
  });

  it('maps every run of the PRs latest round back to the PR (the findings join key)', () => {
    const newest = run({ prId: 'pr1', multiRunId: 'm2', costUsd: 1 });
    const sibling = run({ prId: 'pr1', multiRunId: 'm2', costUsd: 1 });
    const stale = run({ prId: 'pr1', multiRunId: 'm1', costUsd: 1 });
    const { runIdToPr } = latestRoundByPr([newest, sibling, stale]);
    expect(runIdToPr.get(newest.id)).toBe('pr1');
    expect(runIdToPr.get(sibling.id)).toBe('pr1');
    expect(runIdToPr.has(stale.id)).toBe(false); // older round — not part of the latest
  });
});

describe('latestScoresByPr', () => {
  it('resolves the score from the NEWEST review per PR (rows newest-first)', () => {
    const rows: ReviewScoreRow[] = [
      { prId: 'pr1', score: 61 }, // newest → wins
      { prId: 'pr1', score: 90 },
      { prId: 'pr2', score: 45 },
      { prId: 'pr2', score: 12 },
    ];
    const byPr = latestScoresByPr(rows);
    expect(byPr.get('pr1')).toBe(61);
    expect(byPr.get('pr2')).toBe(45);
  });

  it('keeps a null score (reviewed but unscored) distinct from never-reviewed', () => {
    const byPr = latestScoresByPr([{ prId: 'pr1', score: null }]);
    expect(byPr.get('pr1')).toBeNull();
    expect(byPr.has('pr2')).toBe(false);
  });
});

describe('findingPreviewsByPr', () => {
  it('ships the findings of the latest round only, mapped to the preview shape', () => {
    const newest = run({ prId: 'pr1', multiRunId: 'm2' });
    const older = run({ prId: 'pr1', multiRunId: 'm1' });
    const { runIdToPr } = latestRoundByPr([newest, older]);

    const reviews = [reviewRef('rev-new', newest.id), reviewRef('rev-old', older.id)];
    const findings = [preview('rev-new', 'f1'), preview('rev-old', 'f2')];
    const byPr = findingPreviewsByPr(reviews, findings, runIdToPr);

    expect(byPr.get('pr1')).toHaveLength(1);
    expect(byPr.get('pr1')![0]).toMatchObject({
      id: 'f1',
      severity: 'CRITICAL',
      file: 'src/config.ts',
      start_line: 12,
      end_line: 12,
    });
  });

  it('skips reviews whose run is not part of any latest round (e.g. pre-grouping run_id NULL reviews)', () => {
    const { runIdToPr } = latestRoundByPr([run({ prId: 'pr1', multiRunId: 'm1' })]);
    const reviews = [reviewRef('rev-null', 'unknown-run')];
    const byPr = findingPreviewsByPr(reviews, [preview('rev-null', 'f1')], runIdToPr);
    expect(byPr.size).toBe(0);
  });
});

describe('toPrMetaDto', () => {
  it('maps row + rollup extras to the wire DTO (snake_case, derived status)', () => {
    const dto = toPrMetaDto(
      {
        id: 'pr1',
        number: 482,
        title: 'Add rate limiting',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha: 'a1b2c3d4',
        lastReviewedSha: null,
        additions: 247,
        deletions: 38,
        filesCount: 9,
        status: 'open',
        openedAt: new Date('2026-06-01T00:00:00Z'),
        updatedAt: new Date('2026-06-01T03:00:00Z'),
      },
      { score: 61, costUsd: null, findings: [] },
      Date.parse('2026-06-03T00:00:00Z'),
    );
    expect(dto).toMatchObject({
      id: 'pr1',
      number: 482,
      head_sha: 'a1b2c3d4',
      opened_at: '2026-06-01T00:00:00.000Z',
      score: 61,
      cost_usd: null,
      findings: [],
    });
    // Never reviewed against this head → needs_review.
    expect(dto.status).toBe('needs_review');
  });
});
