import { describe, it, expect } from "vitest";
import type { EvalRun, FindingRecord, PrFile } from "@devdigest/shared";
import {
  actualOfRun,
  capViolations,
  diffFromPrFiles,
  hunkIntersects,
  parseExpectedJson,
  parseHunks,
  prefillFromFinding,
  runPassed,
  toPercent,
} from "./helpers";
import { MAX_INPUT_DIFF_CHARS } from "./constants";

const FILE_PATH = "src/config.ts";
const PATCH = [
  "@@ -8,6 +8,7 @@ import Stripe",
  " const existing = 1;",
  "+const stripeKey = 'sk_live_x';",
  " const next = 2;",
  "@@ -40,3 +41,4 @@ export function handler()",
  " const a = 1;",
  "+const b = 2;",
  " const c = 3;",
].join("\n");

const FILES: PrFile[] = [
  { path: FILE_PATH, additions: 2, deletions: 0, patch: PATCH },
  { path: "src/other.ts", additions: 1, deletions: 1, patch: "@@ -1,1 +1,1 @@\n-a\n+b" },
  { path: "src/patchless.ts", additions: 3, deletions: 0, patch: null },
];

function finding(overrides: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded Stripe secret key",
    file: FILE_PATH,
    start_line: 9,
    end_line: 9,
    rationale: "r",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...overrides,
  };
}

describe("parseHunks / hunkIntersects", () => {
  it("splits a patch into hunks with new-side ranges", () => {
    const hunks = parseHunks(PATCH);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]).toMatchObject({ newStart: 8, newCount: 7 });
    expect(hunks[1]).toMatchObject({ newStart: 41, newCount: 4 });
  });

  it("treats a single-line hunk count as 1 and overlaps inclusively", () => {
    const h = parseHunks("@@ -5 +5 @@\n-a\n+b")[0]!;
    expect(h.newStart).toBe(5);
    expect(hunkIntersects(h, 5, 5)).toBe(true);
    expect(hunkIntersects(h, 6, 9)).toBe(false);
    expect(hunkIntersects(h, 1, 4)).toBe(false);
  });
});

describe("diffFromPrFiles", () => {
  it("keeps only hunks intersecting the cited range and re-adds headers", () => {
    const diff = diffFromPrFiles(FILES, FILE_PATH, 9, 9);
    const lines = diff.split("\n");
    expect(lines[0]).toBe(`diff --git a/${FILE_PATH} b/${FILE_PATH}`);
    expect(lines[1]).toBe(`--- a/${FILE_PATH}`);
    expect(lines[2]).toBe(`+++ b/${FILE_PATH}`);
    expect(diff).toContain("@@ -8,6 +8,7 @@");
    expect(diff).not.toContain("@@ -40,3 +41,4 @@");
    expect(diff).toContain("+const stripeKey = 'sk_live_x';");
  });

  it("falls back to the whole patch when no hunk intersects", () => {
    const diff = diffFromPrFiles(FILES, FILE_PATH, 900, 950);
    expect(diff).toContain("@@ -8,6 +8,7 @@");
    expect(diff).toContain("@@ -40,3 +41,4 @@");
  });

  it("returns '' for a missing file or a patch-less pr_files row", () => {
    expect(diffFromPrFiles(FILES, "src/absent.ts", 1, 2)).toBe("");
    expect(diffFromPrFiles(FILES, "src/patchless.ts", 1, 2)).toBe("");
  });
});

describe("prefillFromFinding", () => {
  it("prefills must_find for an accepted finding, named from its title", () => {
    const p = prefillFromFinding(finding({ accepted_at: "2026-10-10T00:00:00Z" }), FILES, {
      title: "Add Stripe",
      body: "Wire payments.",
    });
    expect(p.name).toBe("Hardcoded Stripe secret key");
    expect(p.expected).toEqual({
      must_find: [{ file: FILE_PATH, start_line: 9, end_line: 9 }],
    });
    expect(p.title).toBe("Add Stripe");
    expect(p.body).toBe("Wire payments.");
    expect(p.diff).toContain("@@ -8,6 +8,7 @@");
  });

  it("prefills must_not_flag for a dismissed finding", () => {
    const p = prefillFromFinding(finding({ dismissed_at: "2026-10-10T00:00:00Z" }), FILES, {
      title: null,
      body: null,
    });
    expect(p.expected).toEqual({
      must_not_flag: [{ file: FILE_PATH, start_line: 9, end_line: 9 }],
    });
    expect(p.title).toBe("");
  });
});

describe("parseExpectedJson", () => {
  it("accepts valid expectation shapes and strips unknown top-level fields", () => {
    const parsed = parseExpectedJson(
      '{"must_find":[{"file":"a.ts","start_line":1,"end_line":2}],"hacker":"x"}',
    );
    expect(parsed).toEqual({ must_find: [{ file: "a.ts", start_line: 1, end_line: 2 }] });
  });

  it("rejects broken JSON and malformed expectations", () => {
    expect(parseExpectedJson("{oops")).toBeNull();
    expect(parseExpectedJson('{"must_find":[{"file":"a.ts"}]}')).toBeNull();
    expect(parseExpectedJson('{"must_find":"all"}')).toBeNull();
  });
});

describe("capViolations", () => {
  const base = { name: "case", diff: "d", title: "t", body: "b", expectedJson: "{}" };
  it("passes a small form and flags an over-cap field", () => {
    expect(capViolations(base)).toEqual([]);
    expect(capViolations({ ...base, diff: "x".repeat(MAX_INPUT_DIFF_CHARS + 1) })).toEqual([
      "diff",
    ]);
    expect(capViolations({ ...base, name: "x".repeat(201) })).toEqual(["name"]);
  });
});

const RUN = (overrides: Record<string, unknown> = {}): EvalRun =>
  ({
    recall: 0.75,
    precision: 1,
    citation_accuracy: 0.5,
    traces_passed: 1,
    traces_total: 1,
    duration_ms: 2400,
    cost_usd: 0.0012,
    per_trace: [
      {
        name: "case",
        pass: true,
        expected: {},
        actual: { findings: [], pre_grounding_count: 0, error: null },
      },
    ],
    ...overrides,
  }) as EvalRun;

describe("actualOfRun / runPassed (defensive reads of the stripped trace)", () => {
  it("reads findings + error out of per_trace[0].actual", () => {
    const run = RUN({
      per_trace: [
        {
          name: "case",
          pass: false,
          expected: {},
          actual: {
            sweep_id: "s",
            findings: [{ id: "f" }],
            pre_grounding_count: 2,
            error: "boom",
          },
        },
      ],
    });
    expect(actualOfRun(run)).toEqual({ findings: [{ id: "f" }], error: "boom" });
    expect(runPassed(run)).toBe(false);
  });

  it("degrades to empty findings / aggregate pass when shapes are unexpected", () => {
    expect(actualOfRun(null)).toEqual({ findings: [], error: null });
    expect(actualOfRun(RUN({ per_trace: [{ name: "c", pass: true }] } as never))).toEqual({
      findings: [],
      error: null,
    });
    expect(runPassed(RUN({ per_trace: [], traces_passed: 1 }))).toBe(true);
  });
});

describe("toPercent", () => {
  it("rounds a 0-1 metric to whole percents", () => {
    expect(toPercent(0.754)).toBe(75);
    expect(toPercent(1)).toBe(100);
  });
});
