import type {
  EvalCaseWriteBody,
  EvalExpectedOutput,
  EvalExpectation,
  EvalRun,
  Finding,
  FindingRecord,
  PrFile,
} from "@devdigest/shared";
import { EvalExpectedOutput as EvalExpectedOutputSchema } from "@devdigest/shared";
import {
  MAX_CASE_NAME_CHARS,
  MAX_EXPECTED_OUTPUT_CHARS,
  MAX_INPUT_DIFF_CHARS,
  MAX_INPUT_META_BODY_CHARS,
  MAX_INPUT_META_TITLE_CHARS,
} from "./constants";

/**
 * Pure helpers for EvalCaseModal — diff slicing from PR files, expectation
 * prefill from a finding, expected-output JSON parsing, and the defensive read
 * of a draft-run result (the wire type strips trace-only fields, so the
 * findings + error signal ride inside `per_trace[0].actual`, typed unknown).
 */

// ---- Unified-diff slicing --------------------------------------------------

/** New-side start/count of one hunk, from its `@@ -a,b +c,d @@` header. */
export interface PatchHunk {
  text: string;
  newStart: number;
  newCount: number;
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/** Split a patch body into hunks (header line + body kept verbatim). */
export function parseHunks(patch: string): PatchHunk[] {
  const hunks: PatchHunk[] = [];
  let current: string[] | null = null;
  let newStart = 0;
  let newCount = 0;
  for (const line of patch.split("\n")) {
    const m = HUNK_HEADER.exec(line);
    if (m) {
      if (current) hunks.push({ text: current.join("\n"), newStart, newCount });
      newStart = Number(m[1]);
      newCount = m[2] === undefined ? 1 : Number(m[2]);
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) hunks.push({ text: current.join("\n"), newStart, newCount });
  return hunks;
}

/** Inclusive new-side range overlap (`[startLine, endLine]` vs the hunk's). */
export function hunkIntersects(h: PatchHunk, startLine: number, endLine: number): boolean {
  const hunkEnd = h.newStart + Math.max(h.newCount, 1) - 1;
  return h.newStart <= endLine && startLine <= hunkEnd;
}

/**
 * The eval-case diff for one finding: slice the PR file's patch down to the
 * hunks whose new-side range intersects the finding's citation range, re-adding
 * the `diff --git` / `---` / `+++` headers (the seed's `diffFromPrFiles`
 * pattern). No intersecting hunk (or a patch-less `pr_files` row) falls back to
 * the full patch / an empty string — the server's 422 stays authoritative.
 */
export function diffFromPrFiles(
  files: PrFile[],
  filePath: string,
  startLine: number,
  endLine: number,
): string {
  const file = files.find((f) => f.path === filePath);
  if (!file?.patch) return "";
  const hunks = parseHunks(file.patch);
  if (hunks.length === 0) return "";
  const picked = hunks.filter((h) => hunkIntersects(h, startLine, endLine));
  const chosen = picked.length > 0 ? picked : hunks;
  return [
    `diff --git a/${filePath} b/${filePath}`,
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    ...chosen.map((h) => h.text),
  ].join("\n");
}

// ---- Prefill from a finding ------------------------------------------------

/** Everything the modal pre-fills from a PR detail + one finding. */
export interface CasePrefill {
  name: string;
  diff: string;
  title: string;
  body: string;
  expected: EvalExpectedOutput;
}

/** One expectation at the finding's file + cited range. */
export function expectationForFinding(f: FindingRecord): EvalExpectation {
  return { file: f.file, start_line: f.start_line, end_line: f.end_line };
}

/**
 * Accepted finding ⇒ `must_find` at its range; dismissed ⇒ `must_not_flag`.
 * The case name is the finding's title; the diff is the citation-range slice.
 */
export function prefillFromFinding(
  finding: FindingRecord,
  files: PrFile[],
  prMeta: { title: string | null; body: string | null },
): CasePrefill {
  const expectation = expectationForFinding(finding);
  return {
    name: finding.title,
    diff: diffFromPrFiles(files, finding.file, finding.start_line, finding.end_line),
    title: prMeta.title ?? "",
    body: prMeta.body ?? "",
    expected: finding.dismissed_at ? { must_not_flag: [expectation] } : { must_find: [expectation] },
  };
}

// ---- Expected-output JSON editor ---------------------------------------------

/** `JSON.parse` + the shared schema — the same gate the server applies. */
export function parseExpectedJson(raw: string): EvalExpectedOutput | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const res = EvalExpectedOutputSchema.safeParse(parsed);
  return res.success ? res.data : null;
}

/** Which size caps the form violates (client mirror — server authoritative). */
export type SizeCappedField = "name" | "diff" | "title" | "body" | "expected";

export function capViolations(form: {
  name: string;
  diff: string;
  title: string;
  body: string;
  expectedJson: string;
}): SizeCappedField[] {
  const violations: SizeCappedField[] = [];
  if (form.name.length > MAX_CASE_NAME_CHARS) violations.push("name");
  if (form.diff.length > MAX_INPUT_DIFF_CHARS) violations.push("diff");
  if (form.title.length > MAX_INPUT_META_TITLE_CHARS) violations.push("title");
  if (form.body.length > MAX_INPUT_META_BODY_CHARS) violations.push("body");
  if (form.expectedJson.length > MAX_EXPECTED_OUTPUT_CHARS) violations.push("expected");
  return violations;
}

/** The `EvalCaseWriteBody` the modal sends (create / update / draft-run). */
export function toWriteBody(form: {
  name: string;
  diff: string;
  title: string;
  body: string;
  expected: EvalExpectedOutput;
  notes?: string | null;
}): EvalCaseWriteBody {
  return {
    name: form.name.trim(),
    input_diff: form.diff,
    input_meta: { title: form.title, body: form.body },
    expected_output: form.expected,
    notes: form.notes ?? null,
  };
}

// ---- Draft-run result reads (defensive — actual is z.unknown()) -------------

export interface DraftActual {
  findings: Finding[];
  error: string | null;
}

/**
 * The single-trace result's actual payload: for saved-case runs it is the sweep
 * envelope, for drafts a bare `{ findings, pre_grounding_count, error }` — the
 * zod serializer strips trace-only fields either way, so read it defensively.
 */
export function actualOfRun(result: EvalRun | null | undefined): DraftActual {
  const raw = result?.per_trace?.[0]?.actual as
    | { findings?: unknown; error?: unknown }
    | null
    | undefined;
  return {
    findings: Array.isArray(raw?.findings) ? (raw?.findings as Finding[]) : [],
    error: typeof raw?.error === "string" ? raw.error : null,
  };
}

/** Whether the single-trace run passed (falling back to the aggregate counter). */
export function runPassed(result: EvalRun | null | undefined): boolean {
  const tracePass = result?.per_trace?.[0]?.pass;
  return typeof tracePass === "boolean" ? tracePass : (result?.traces_passed ?? 0) > 0;
}

/** 0–1 metric → whole percent for the `resultSummary` line. */
export function toPercent(v: number): number {
  return Math.round(v * 100);
}
