import type { EvalSweep, EvalTrace } from "@devdigest/shared";
import type { MetricKey } from "./constants";

/** Pure helpers for EvalsTab — sweep-derived values, no I/O, no React. */

/**
 * Newest trace per case id: sweeps arrive newest-first, so the FIRST trace
 * seen for a case wins. Drives the cases table's "latest outcome" column.
 */
export function latestByCase(sweeps: EvalSweep[]): Map<string, EvalTrace> {
  const byCase = new Map<string, EvalTrace>();
  for (const sweep of sweeps) {
    for (const trace of sweep.per_trace) {
      if (!byCase.has(trace.case_id)) byCase.set(trace.case_id, trace);
    }
  }
  return byCase;
}

/**
 * A sweep passed when every trace passed (errored traces count as
 * not-passing server-side, so traces_passed < traces_total whenever one
 * errored). An empty sweep (no cases) is neither.
 */
export function sweepPassed(sweep: EvalSweep): boolean | null {
  if (sweep.traces_total === 0) return null;
  return sweep.traces_passed === sweep.traces_total;
}

/** Chronological (oldest → newest) metric series for trend charts/sparklines. */
export function metricSeries(sweeps: EvalSweep[], key: MetricKey): number[] {
  return [...sweeps].reverse().map((s) => s[key]);
}

/** 0–1 metric → whole-percent text ("75%"). */
export function pctText(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/** Locale ran-at label; falls back to the raw string when unparsable. */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}
