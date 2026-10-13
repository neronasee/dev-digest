import type { Finding, EvalExpectation, EvalExpectedOutput } from '@devdigest/shared';

/**
 * Deterministic eval scoring — PURE, zero LLM, zero DB (AC-17–AC-21, AC-41).
 *
 * Matching uses ONLY `file` (exact string equality) + line-range overlap;
 * `severity`/`category`/`title` on an expectation are informational. No model
 * call and no adapter import lives here, so the whole suite runs without
 * provider mocks.
 */

export interface CaseScore {
  recall: number;
  precision: number;
  citation_accuracy: number;
  pass: boolean;
}

/** Half-open-free inclusive overlap: `[aStart,aEnd]` touches `[bStart,bEnd]`. */
export function rangesIntersect(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/** A finding satisfies an expectation ⇔ same file + intersecting line range. */
function intersects(e: EvalExpectation, f: Finding): boolean {
  return f.file === e.file && rangesIntersect(e.start_line, e.end_line, f.start_line, f.end_line);
}

/**
 * Score one case against its (grounded) findings.
 *
 * - recall = satisfied `must_find` share (empty set → 1)
 * - precision = share of findings intersecting NO `must_not_flag`
 *   (zero findings → 1). Unexpected-extra findings are TOLERATED on non-clean
 *   cases — they reduce nothing (settled decision).
 * - citation_accuracy = kept / preGroundingCount (grounded findings over the
 *   pre-gate candidate count; 1 when nothing was pre-gate)
 * - pass ⇔ every `must_find` satisfied ∧ no `must_not_flag` intersection ∧
 *   (zero expectations declared ⇒ zero findings — a clean case with any
 *   finding fails).
 */
export function scoreCase(
  expected: EvalExpectedOutput,
  findings: Finding[],
  preGroundingCount: number,
): CaseScore {
  const mustFind = expected.must_find ?? [];
  const mustNotFlag = expected.must_not_flag ?? [];
  const isClean = mustFind.length === 0 && mustNotFlag.length === 0;

  const satisfied = mustFind.filter((e) => findings.some((f) => intersects(e, f))).length;
  const recall = mustFind.length === 0 ? 1 : satisfied / mustFind.length;

  const falsePositives = findings.filter((f) => mustNotFlag.some((e) => intersects(e, f))).length;
  const precision = findings.length === 0 ? 1 : (findings.length - falsePositives) / findings.length;

  const citationAccuracy = preGroundingCount > 0 ? findings.length / preGroundingCount : 1;

  const pass = satisfied === mustFind.length && falsePositives === 0 && (!isClean || findings.length === 0);

  return { recall, precision, citation_accuracy: citationAccuracy, pass };
}
