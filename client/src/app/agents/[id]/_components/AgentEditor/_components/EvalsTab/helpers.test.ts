import { describe, it, expect } from "vitest";
import type { EvalSweep } from "@devdigest/shared";
import { latestByCase, metricSeries, pctText, sweepPassed } from "./helpers";

const SWEEP = (overrides: Partial<EvalSweep>): EvalSweep =>
  ({
    recall: 1,
    precision: 1,
    citation_accuracy: 1,
    traces_passed: 1,
    traces_total: 1,
    duration_ms: 100,
    cost_usd: null,
    sweep_id: "s1",
    agent_id: "ag",
    agent_version: 1,
    ran_at: "2026-10-10T00:00:00Z",
    errored: 0,
    per_trace: [],
    ...overrides,
  }) as EvalSweep;

describe("latestByCase", () => {
  it("keeps the NEWEST trace per case (sweeps arrive newest-first)", () => {
    const newest = SWEEP({
      sweep_id: "new",
      per_trace: [
        { name: "c1", pass: true, case_id: "c1", recall: 1, precision: 1, citation_accuracy: 1, duration_ms: 1, cost_usd: null, error: null, expected: {}, actual: {} },
      ],
    });
    const older = SWEEP({
      sweep_id: "old",
      per_trace: [
        { name: "c1", pass: false, case_id: "c1", recall: 0, precision: 0, citation_accuracy: 0, duration_ms: 1, cost_usd: null, error: null, expected: {}, actual: {} },
        { name: "c2", pass: false, case_id: "c2", recall: 0.5, precision: 1, citation_accuracy: 1, duration_ms: 1, cost_usd: null, error: null, expected: {}, actual: {} },
      ],
    });
    const byCase = latestByCase([newest, older]);
    expect(byCase.get("c1")!.pass).toBe(true);
    expect(byCase.get("c2")!.recall).toBe(0.5);
    expect(byCase.size).toBe(2);
  });
});

describe("sweepPassed", () => {
  it("passes only when every trace passed; empty sweeps are neither", () => {
    expect(sweepPassed(SWEEP({ traces_passed: 2, traces_total: 2 }))).toBe(true);
    expect(sweepPassed(SWEEP({ traces_passed: 1, traces_total: 2 }))).toBe(false);
    // errored traces are already excluded from traces_passed server-side
    expect(sweepPassed(SWEEP({ traces_passed: 1, traces_total: 2, errored: 1 }))).toBe(false);
    expect(sweepPassed(SWEEP({ traces_passed: 0, traces_total: 0 }))).toBeNull();
  });
});

describe("metricSeries / pctText", () => {
  it("reverses newest-first sweeps into chronological series", () => {
    const a = SWEEP({ sweep_id: "a", recall: 0.5 });
    const b = SWEEP({ sweep_id: "b", recall: 0.75 });
    expect(metricSeries([b, a], "recall")).toEqual([0.5, 0.75]);
    expect(pctText(0.754)).toBe("75%");
  });
});
