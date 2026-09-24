import type { Finding, Review, UnifiedDiff } from '@devdigest/shared';

/**
 * Reduce + slice helpers for map-reduce reviews. Pure (no DB / `this`), so they
 * live in the engine and are shared by the server and the CI runner.
 */

/**
 * Per-severity penalty subtracted from a perfect 100. Chosen so the score
 * tracks the findings the UI actually shows: 0 findings ⇒ 100, one suggestion
 * ⇒ 97, one warning ⇒ 88, one critical ⇒ 65.
 */
const SEVERITY_PENALTY: Record<Finding['severity'], number> = {
  CRITICAL: 35,
  WARNING: 12,
  SUGGESTION: 3,
};

/**
 * Deterministic 0–100 quality score derived from the (grounded) findings —
 * NOT the model's self-reported `score`, which has no anchor and drifts wildly
 * between models (a cheap model can "approve" with zero findings yet emit 10).
 * This mirrors how the review *event* is already computed from severities in
 * `to-review.ts`, so the number on screen can never contradict the findings
 * beneath it.
 */
export function scoreFromFindings(findings: Finding[]): number {
  const penalty = findings.reduce((sum, f) => sum + (SEVERITY_PENALTY[f.severity] ?? 0), 0);
  return Math.max(0, Math.min(100, 100 - penalty));
}

/** Verdict severity order for the reduce step (worst verdict wins). */
const VERDICT_RANK: Record<string, number> = {
  request_changes: 2,
  comment: 1,
  approve: 0,
};

/**
 * Merge N partial Reviews (one per mapped file/chunk) into a single Review:
 * concat findings, take the worst verdict, mean score, joined summaries.
 */
export function reduceReviews(partials: Review[]): Review {
  if (partials.length === 1) return partials[0]!;
  const findings = partials.flatMap((p) => p.findings);
  let verdict: Review['verdict'] = 'approve';
  for (const p of partials) {
    if ((VERDICT_RANK[p.verdict] ?? 0) > (VERDICT_RANK[verdict] ?? 0)) verdict = p.verdict;
  }
  const score = partials.length
    ? Math.round(partials.reduce((s, p) => s + p.score, 0) / partials.length)
    : 0;
  const summary = partials.map((p) => p.summary).filter(Boolean).join(' ');
  return { verdict, score, summary, findings };
}

/** Extract the slice of the unified diff for a single file (for map chunks). */
export function sliceDiff(diff: UnifiedDiff, path: string): string {
  const lines = diff.raw.split('\n');
  const out: string[] = [];
  let capture = false;
  for (const line of lines) {
    if (line.startsWith('diff --git'))
      capture = line.includes(`b/${path}`) || line.includes(` ${path}`);
    if (capture) out.push(line);
  }
  if (out.length > 0) return out.join('\n');
  // Fallback: the raw slice found nothing for this path (quoted/rename paths in
  // `raw` the matcher above can't see), but the parsed file record exists.
  // Reconstruct a unified diff from the hunk metadata so the map chunk is never
  // a bare header with no hunks — downstream would silently review an empty
  // diff. DiffHunk stores ranges + new-side line numbers, not text, so each
  // covered new line renders as a placeholder `+` body line instead of code
  // (the same covered-lines set grounding's buildLineIndex uses).
  const f = diff.files.find((x) => x.path === path);
  if (!f) return diff.raw;
  const body: string[] = [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`];
  for (const h of f.hunks) {
    body.push(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`);
    const covered =
      h.newLineNumbers.length > 0
        ? h.newLineNumbers
        : Array.from({ length: Math.max(h.newLines, 1) }, (_, i) => h.newStart + i);
    for (const n of covered) body.push(`+ [line ${n}]`);
  }
  return body.join('\n');
}
