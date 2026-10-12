import { describe, it, expect } from "vitest";
import type { Agent, AgentVersionConfig, EvalSweep } from "@devdigest/shared";
import {
  deltaDirection,
  formatDelta,
  metricDeltas,
  promoteIsNoop,
  promptDiffLines,
} from "./helpers";

const SWEEP = (overrides: Partial<EvalSweep>): EvalSweep =>
  ({
    recall: 0.5,
    precision: 0.5,
    citation_accuracy: 0.5,
    traces_passed: 0,
    traces_total: 2,
    duration_ms: 1000,
    cost_usd: null,
    sweep_id: "s",
    agent_id: "ag",
    agent_version: 1,
    ran_at: "2026-10-10T00:00:00Z",
    errored: 0,
    per_trace: [],
    ...overrides,
  }) as EvalSweep;

describe("metricDeltas — computed from stored sweeps, never assumed", () => {
  it("produces b-relative deltas for all three metrics", () => {
    const a = SWEEP({ recall: 0.5, precision: 1, citation_accuracy: 0.25 });
    const b = SWEEP({ recall: 0.75, precision: 0.5, citation_accuracy: 0.25 });
    expect(metricDeltas(a, b)).toEqual([
      { key: "recall", a: 0.5, b: 0.75, delta: 0.25 },
      { key: "precision", a: 1, b: 0.5, delta: -0.5 },
      { key: "citation_accuracy", a: 0.25, b: 0.25, delta: 0 },
    ]);
  });
});

describe("formatDelta / deltaDirection — direction by text + sign", () => {
  it("signs non-zero deltas and marks flat as 0", () => {
    expect(formatDelta(0.25)).toBe("+0.25");
    expect(formatDelta(-0.5)).toBe("-0.50");
    expect(formatDelta(0)).toBe("0.00");
    expect(deltaDirection(0.1)).toBe("up");
    expect(deltaDirection(-0.1)).toBe("down");
    expect(deltaDirection(0)).toBe("flat");
  });
});

describe("promptDiffLines — LCS line diff of two system prompts", () => {
  it("classifies same / removed / added lines", () => {
    const diff = promptDiffLines("alpha\nbeta\ngamma", "alpha\ndelta\ngamma");
    expect(diff).toEqual([
      { kind: "same", text: "alpha" },
      { kind: "removed", text: "beta" },
      { kind: "added", text: "delta" },
      { kind: "same", text: "gamma" },
    ]);
  });

  it("handles pure insertions, deletions, and identical prompts", () => {
    expect(promptDiffLines("a\nb", "a\nb\nc")).toEqual([
      { kind: "same", text: "a" },
      { kind: "same", text: "b" },
      { kind: "added", text: "c" },
    ]);
    expect(promptDiffLines("a\nb", "b")).toEqual([
      { kind: "removed", text: "a" },
      { kind: "same", text: "b" },
    ]);
    expect(promptDiffLines("same", "same")).toEqual([{ kind: "same", text: "same" }]);
    // "" splits to a single empty line — an identical (empty) prompt diffs to it.
    expect(promptDiffLines("", "")).toEqual([{ kind: "same", text: "" }]);
  });
});

const CONFIG = (overrides: Partial<AgentVersionConfig>): AgentVersionConfig =>
  ({
    provider: "openai",
    model: "gpt-4.1",
    system_prompt: "review things",
    output_schema: null,
    strategy: "single-pass",
    ci_fail_on: "critical",
    repo_intel: true,
    skills: [],
    context_docs: [],
    ...overrides,
  }) as AgentVersionConfig;

const AGENT: Agent = {
  id: "ag",
  name: "Security Reviewer",
  description: "",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "review things",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 3,
};

describe("promoteIsNoop — client mirror of the server's AC-29 guard", () => {
  it("is a no-op when the sweep already ran on the live version", () => {
    expect(promoteIsNoop(undefined, AGENT, 3)).toBe(true);
  });

  it("is a no-op when the comparable config equals the live agent", () => {
    expect(promoteIsNoop(CONFIG({}), AGENT, 1)).toBe(true);
  });

  it("is actionable when any comparable field differs", () => {
    expect(promoteIsNoop(CONFIG({ system_prompt: "changed" }), AGENT, 1)).toBe(false);
    expect(promoteIsNoop(CONFIG({ model: "gpt-4.1-mini" }), AGENT, 2)).toBe(false);
    expect(promoteIsNoop(undefined, AGENT, 1)).toBe(false);
  });
});
