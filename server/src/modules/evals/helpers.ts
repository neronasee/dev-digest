import type {
  EvalCase,
  EvalOwnerKind,
  EvalRunRecord,
  EvalSweep,
  EvalTrace,
  EvalTrendPoint,
} from '@devdigest/shared';
import { EvalActualOutput } from '@devdigest/shared';
// Row types come from db/rows (B14), NOT from ./repository — the repository
// imports pure mappers from here, so a repository import would re-create the
// helpers ↔ repository import cycle (agents module precedent).
import type { EvalCaseRow, EvalRunRow } from '../../db/rows.js';

/**
 * Pure helpers for the evals module — DB row ⇄ DTO mapping, sweep grouping and
 * the dashboard aggregation. No I/O of any kind: everything here is plain
 * functions over already-fetched data (AC-41: aggregation runs without
 * provider mocks).
 */

/** Map a persisted eval_cases row to the public `EvalCase` DTO. */
export function toEvalCaseDto(row: EvalCaseRow): EvalCase {
  return {
    id: row.id,
    owner_kind: row.ownerKind as EvalOwnerKind,
    owner_id: row.ownerId,
    name: row.name,
    input_diff: row.inputDiff ?? '',
    input_files: row.inputFiles ?? null,
    input_meta: row.inputMeta ?? null,
    expected_output: row.expectedOutput ?? null,
    notes: row.notes ?? null,
  };
}

/** One eval_runs row joined with the (reachable) case it scored. */
export interface EvalRunWithCase {
  run: EvalRunRow;
  caseId: string;
  caseName: string;
  caseExpectedOutput: unknown;
}

/** Map a run+case join row to the public `EvalRunRecord` (recent_runs rows). */
export function toEvalRunRecordDto(r: EvalRunWithCase): EvalRunRecord {
  return {
    id: r.run.id,
    case_id: r.caseId,
    case_name: r.caseName,
    ran_at: r.run.ranAt.toISOString(),
    actual_output: r.run.actualOutput ?? null,
    pass: r.run.pass ?? null,
    recall: r.run.recall ?? null,
    precision: r.run.precision ?? null,
    citation_accuracy: r.run.citationAccuracy ?? null,
    duration_ms: r.run.durationMs ?? null,
    cost_usd: r.run.costUsd ?? null,
  };
}

// ---- Sweep grouping ---------------------------------------------------------

/**
 * Group joined run rows into `EvalSweep`s via the `sweep_id` each row carries
 * in its `actual_output` envelope (EvalActualOutput — Task-1 contract).
 *
 * Rows whose envelope is absent or unparseable (legacy rows, drift) are
 * SKIPPED for grouping — they can still surface in recent_runs as raw
 * EvalRunRecords, but they never fabricate a sweep.
 */
export function groupSweeps(rows: EvalRunWithCase[]): EvalSweep[] {
  const bySweep = new Map<string, { envelope: EvalActualOutput; rows: EvalRunWithCase[] }>();
  for (const r of rows) {
    const parsed = EvalActualOutput.safeParse(r.run.actualOutput);
    if (!parsed.success) continue; // legacy/null envelope — not groupable
    const group = bySweep.get(parsed.data.sweep_id) ?? { envelope: parsed.data, rows: [] };
    group.rows.push(r);
    bySweep.set(parsed.data.sweep_id, group);
  }

  const sweeps: EvalSweep[] = [];
  for (const [sweepId, group] of bySweep) {
    const traces = group.rows
      .slice()
      .sort(
        (a, b) =>
          a.run.ranAt.getTime() - b.run.ranAt.getTime() || (a.run.id < b.run.id ? -1 : 1),
      )
      .map((r) => toTrace(r));
    const newest = group.rows.reduce(
      (acc, r) => (r.run.ranAt.getTime() > acc.getTime() ? r.run.ranAt : acc),
      group.rows[0]!.run.ranAt,
    );
    sweeps.push({
      ...aggregateSweep(traces),
      sweep_id: sweepId,
      agent_id: group.envelope.agent_id,
      agent_version: group.envelope.agent_version,
      ran_at: newest.toISOString(),
      errored: traces.filter((t) => t.error != null).length,
      per_trace: traces,
    });
  }
  // Newest-first (history order); sweep_id breaks identical-timestamp ties.
  return sweeps.sort(
    (a, b) => b.ran_at.localeCompare(a.ran_at) || (a.sweep_id < b.sweep_id ? 1 : -1),
  );
}

/** Build one `EvalTrace` from a run row (its envelope supplies `error`). */
function toTrace(r: EvalRunWithCase): EvalTrace {
  const envelope = EvalActualOutput.safeParse(r.run.actualOutput);
  return {
    name: r.caseName,
    pass: r.run.pass ?? false,
    expected: r.caseExpectedOutput ?? null,
    actual: r.run.actualOutput ?? null,
    case_id: r.caseId,
    recall: r.run.recall ?? 0,
    precision: r.run.precision ?? 0,
    citation_accuracy: r.run.citationAccuracy ?? 0,
    duration_ms: r.run.durationMs ?? 0,
    cost_usd: r.run.costUsd ?? null,
    error: envelope.success ? envelope.data.error : 'unparseable run envelope',
  };
}

// ---- Aggregation (macro-averages over non-errored traces) --------------------

export interface SweepAggregate {
  recall: number;
  precision: number;
  citation_accuracy: number;
  traces_passed: number;
  traces_total: number;
  duration_ms: number;
  cost_usd: number | null;
}

/**
 * Aggregate the traces of one sweep. Errored traces (error != null) are
 * EXCLUDED from the macro-averages but count in `traces_total` and as
 * not-passing (AC-15/AC-22). Cost sums only while EVERY trace's cost is
 * known — one unknown cost makes the total unknown (null → client em-dash).
 */
export function aggregateSweep(traces: EvalTrace[]): SweepAggregate {
  const ok = traces.filter((t) => t.error == null);
  const macro = (pick: (t: EvalTrace) => number) =>
    ok.length === 0 ? 0 : ok.reduce((s, t) => s + pick(t), 0) / ok.length;
  const cost =
    traces.length === 0 || traces.some((t) => t.cost_usd == null)
      ? null
      : traces.reduce((s, t) => s + (t.cost_usd ?? 0), 0);
  return {
    recall: macro((t) => t.recall),
    precision: macro((t) => t.precision),
    citation_accuracy: macro((t) => t.citation_accuracy),
    traces_passed: traces.filter((t) => t.pass).length,
    traces_total: traces.length,
    duration_ms: traces.reduce((s, t) => s + t.duration_ms, 0),
    cost_usd: cost,
  };
}

// ---- Dashboard pure views ----------------------------------------------------

/** Chronological trend points (the repository returns newest-first). */
export function sweepTrend(sweeps: EvalSweep[]): EvalTrendPoint[] {
  return sweeps
    .slice()
    .sort((a, b) => a.ran_at.localeCompare(b.ran_at))
    .map((s) => ({
      ran_at: s.ran_at,
      recall: s.recall,
      precision: s.precision,
      citation_accuracy: s.citation_accuracy,
      pass_rate: s.traces_total === 0 ? 0 : s.traces_passed / s.traces_total,
      cost_usd: s.cost_usd,
    }));
}

/** The newest sweep of a list (any order in, ran_at compared). */
export function latestSweep(sweeps: EvalSweep[]): EvalSweep | null {
  if (sweeps.length === 0) return null;
  return sweeps.reduce((acc, s) => (s.ran_at.localeCompare(acc.ran_at) > 0 ? s : acc));
}

/**
 * Per-metric delta of the two most recent sweeps (next − prev). Without both
 * sweeps there is no delta — zeros, never an invented number.
 */
export function dashboardDelta(
  prev: EvalSweep | null,
  next: EvalSweep | null,
): { recall: number; precision: number; citation_accuracy: number } {
  if (!prev || !next) return { recall: 0, precision: 0, citation_accuracy: 0 };
  return {
    recall: next.recall - prev.recall,
    precision: next.precision - prev.precision,
    citation_accuracy: next.citation_accuracy - prev.citation_accuracy,
  };
}

/**
 * Metric names that REGRESSED from `prev` to `next` (AC-26). The service joins
 * them into `EvalDashboard.alert` as a comma-separated list of raw names; the
 * client maps each through its `dashboard.metrics.*` labels.
 */
export function degradedMetrics(prev: EvalSweep, next: EvalSweep): string[] {
  const names: string[] = [];
  if (next.recall < prev.recall) names.push('recall');
  if (next.precision < prev.precision) names.push('precision');
  if (next.citation_accuracy < prev.citation_accuracy) names.push('citation_accuracy');
  return names;
}
