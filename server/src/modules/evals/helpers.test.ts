import { describe, it, expect } from 'vitest';
import type { EvalTrace } from '@devdigest/shared';
import {
  aggregateSweep,
  dashboardDelta,
  degradedMetrics,
  groupSweeps,
  latestSweep,
  sweepTrend,
  toEvalCaseDto,
} from './helpers.js';
import type { EvalCaseRow, EvalRunRow } from '../../db/rows.js';

/**
 * Pure aggregation units — sweep grouping via the actual_output envelope,
 * macro-averages excluding errored traces, dashboard views (AC-15/AC-22/AC-41).
 */

function trace(over: Partial<EvalTrace>): EvalTrace {
  return {
    name: 'case',
    pass: true,
    expected: null,
    actual: null,
    case_id: 'c1',
    recall: 1,
    precision: 1,
    citation_accuracy: 1,
    duration_ms: 10,
    cost_usd: 0.01,
    error: null,
    ...over,
  };
}

function runRow(over: Partial<EvalRunRow> & { actualOutput: unknown }): EvalRunRow {
  return {
    id: over.id ?? 'r1',
    caseId: 'c1',
    ranAt: new Date('2026-10-10T00:00:00Z'),
    pass: true,
    recall: 1,
    precision: 1,
    citationAccuracy: 1,
    durationMs: 10,
    costUsd: 0.01,
    ...over,
  } as EvalRunRow;
}

function joined(
  run: EvalRunRow,
  over?: { caseId?: string; caseName?: string; caseExpectedOutput?: unknown },
) {
  return {
    run,
    caseId: over?.caseId ?? 'c1',
    caseName: over?.caseName ?? 'case one',
    caseExpectedOutput: over?.caseExpectedOutput ?? null,
  };
}

const envelope = (sweepId: string, error: string | null = null) => ({
  sweep_id: sweepId,
  agent_id: '11111111-1111-4111-8111-111111111111',
  agent_version: 1,
  findings: [],
  pre_grounding_count: 0,
  error,
});

describe('aggregateSweep', () => {
  it('macro-averages over NON-errored traces only, but counts them in totals', () => {
    const agg = aggregateSweep([
      trace({ recall: 1, precision: 0.5, citation_accuracy: 1, pass: true }),
      trace({ recall: 0, precision: 1, citation_accuracy: 0.5, pass: false }),
      trace({ error: 'boom', pass: false, recall: 0, precision: 0, citation_accuracy: 0, cost_usd: null }),
    ]);
    // Errored trace excluded from the averages…
    expect(agg.recall).toBeCloseTo(0.5);
    expect(agg.precision).toBeCloseTo(0.75);
    expect(agg.citation_accuracy).toBeCloseTo(0.75);
    // …but present in totals and counted as not-passing.
    expect(agg.traces_total).toBe(3);
    expect(agg.traces_passed).toBe(1);
  });

  it('sums durations and nulls the cost when ANY trace cost is unknown', () => {
    expect(aggregateSweep([trace({}), trace({})]).cost_usd).toBeCloseTo(0.02);
    expect(aggregateSweep([trace({}), trace({ cost_usd: null })]).cost_usd).toBeNull();
  });

  it('aggregates an empty trace list to zeros with null cost', () => {
    const agg = aggregateSweep([]);
    expect(agg.traces_total).toBe(0);
    expect(agg.traces_passed).toBe(0);
    expect(agg.recall).toBe(0);
    expect(agg.cost_usd).toBeNull();
  });
});

describe('groupSweeps', () => {
  it('groups rows by the envelope sweep_id and orders sweeps newest-first', () => {
    const rows = [
      joined(runRow({ id: 'r1', ranAt: new Date('2026-10-10T01:00:00Z'), actualOutput: envelope('00000000-0000-4000-8000-000000000001') })),
      joined(runRow({ id: 'r2', ranAt: new Date('2026-10-10T02:00:00Z'), actualOutput: envelope('00000000-0000-4000-8000-000000000002') })),
      joined(runRow({ id: 'r3', ranAt: new Date('2026-10-10T01:30:00Z'), actualOutput: envelope('00000000-0000-4000-8000-000000000001') })),
    ];
    const sweeps = groupSweeps(rows);
    expect(sweeps.map((s) => s.sweep_id)).toEqual(['00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001']);
    const s1 = sweeps.find((s) => s.sweep_id === '00000000-0000-4000-8000-000000000001')!;
    expect(s1.traces_total).toBe(2);
    // per_trace ordered oldest→newest within the sweep
    expect(s1.per_trace.map((t) => t.case_id)).toEqual(['c1', 'c1']);
    expect(s1.ran_at).toBe('2026-10-10T01:30:00.000Z');
  });

  it('skips rows with a null/legacy/unparseable envelope (no fabricated sweeps)', () => {
    const rows = [
      joined(runRow({ actualOutput: null })),
      joined(runRow({ actualOutput: { something: 'else' } })),
      joined(runRow({ id: 'r9', actualOutput: envelope('00000000-0000-4000-8000-000000000001') })),
    ];
    const sweeps = groupSweeps(rows);
    expect(sweeps).toHaveLength(1);
    expect(sweeps[0]!.traces_total).toBe(1);
  });

  it('propagates the envelope error into the trace (errored trace)', () => {
    const sweeps = groupSweeps([
      joined(runRow({ pass: false, recall: 0, actualOutput: envelope('00000000-0000-4000-8000-000000000001', 'diff invalid') })),
    ]);
    expect(sweeps[0]!.errored).toBe(1);
    expect(sweeps[0]!.per_trace[0]!.error).toBe('diff invalid');
    expect(sweeps[0]!.traces_passed).toBe(0);
  });
});

describe('sweepTrend / latestSweep', () => {
  it('returns chronological trend points with pass_rate', () => {
    const rows = [
      joined(runRow({ id: 'r1', ranAt: new Date('2026-10-10T02:00:00Z'), actualOutput: envelope('00000000-0000-4000-8000-000000000002'), pass: true })),
      joined(runRow({ id: 'r2', ranAt: new Date('2026-10-10T01:00:00Z'), actualOutput: envelope('00000000-0000-4000-8000-000000000001'), pass: false, recall: 0.5 })),
    ];
    const sweeps = groupSweeps(rows);
    const trend = sweepTrend(sweeps);
    expect(trend.map((p) => p.ran_at)).toEqual([
      '2026-10-10T01:00:00.000Z',
      '2026-10-10T02:00:00.000Z',
    ]);
    expect(trend[0]!.pass_rate).toBe(0);
    expect(trend[1]!.pass_rate).toBe(1);
    expect(latestSweep(sweeps)!.sweep_id).toBe('00000000-0000-4000-8000-000000000002');
  });
});

describe('dashboardDelta / degradedMetrics', () => {
  const sweep = (over: Partial<{ recall: number; precision: number; citation: number; id: string }>) => ({
    recall: over.recall ?? 1,
    precision: over.precision ?? 1,
    citation_accuracy: over.citation ?? 1,
    traces_passed: 1,
    traces_total: 1,
    duration_ms: 5,
    cost_usd: 0.01,
    per_trace: [],
    sweep_id: over.id ?? '00000000-0000-4000-8000-000000000001',
    agent_id: '11111111-1111-4111-8111-111111111111',
    agent_version: 1,
    ran_at: '2026-10-10T00:00:00.000Z',
    errored: 0,
  });

  it('zeros the delta without both sweeps', () => {
    expect(dashboardDelta(null, sweep({}))).toEqual({ recall: 0, precision: 0, citation_accuracy: 0 });
  });

  it('deltas per metric (next − prev)', () => {
    expect(dashboardDelta(sweep({ recall: 0.5 }), sweep({ recall: 1 }))).toMatchObject({ recall: 0.5 });
  });

  it('names regressed metrics only (AC-26)', () => {
    expect(degradedMetrics(sweep({}), sweep({ recall: 0.5 }))).toEqual(['recall']);
    expect(degradedMetrics(sweep({}), sweep({ recall: 0.5, citation: 0.2 }))).toEqual([
      'recall',
      'citation_accuracy',
    ]);
    expect(degradedMetrics(sweep({ recall: 0.5 }), sweep({}))).toEqual([]);
  });
});

describe('toEvalCaseDto', () => {
  it('maps a row with null jsonb slots onto the contract', () => {
    const row = {
      id: 'c1',
      workspaceId: 'w1',
      ownerKind: 'agent',
      ownerId: 'a1',
      name: 'stripe key case',
      inputDiff: 'diff --git a/x b/x',
      inputFiles: null,
      inputMeta: { title: 'T', body: 'B' },
      expectedOutput: { must_find: [] },
      notes: null,
    } as EvalCaseRow;
    expect(toEvalCaseDto(row)).toEqual({
      id: 'c1',
      owner_kind: 'agent',
      owner_id: 'a1',
      name: 'stripe key case',
      input_diff: 'diff --git a/x b/x',
      input_files: null,
      input_meta: { title: 'T', body: 'B' },
      expected_output: { must_find: [] },
      notes: null,
    });
  });
});
