import type { Finding, UnifiedDiff } from '@devdigest/shared';

/**
 * Citation grounding — the mandatory mechanical gate for diff-findings.
 *
 * A diff-finding is kept ONLY if its [start_line, end_line] range intersects a
 * real hunk in the unified diff for the same file. Findings that fail are
 * dropped (the model "hallucinated" a location).
 *
 */

export interface GroundingResult {
  kept: Finding[];
  dropped: { finding: Finding; reason: string }[];
  rewritten: { finding: Finding; from: string; to: string }[];
}

/** Build a quick lookup of file → set of new-side line numbers covered by hunks. */
export function buildLineIndex(diff: UnifiedDiff): Map<string, Set<number>> {
  const idx = new Map<string, Set<number>>();
  for (const f of diff.files) {
    const set = new Set<number>();
    for (const h of f.hunks) {
      if (h.newLineNumbers && h.newLineNumbers.length > 0) {
        for (const n of h.newLineNumbers) set.add(n);
      } else {
        // fall back to the hunk's declared new range
        for (let n = h.newStart; n < h.newStart + Math.max(h.newLines, 1); n++) set.add(n);
      }
    }
    idx.set(f.path, set);
  }
  return idx;
}

function rangeIntersects(lines: Set<number>, start: number, end: number): boolean {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  for (let n = lo; n <= hi; n++) if (lines.has(n)) return true;
  return false;
}

function normalizePath(path: string): string {
  let normalized = path.replaceAll('\\', '/');
  while (normalized.startsWith('./')) normalized = normalized.slice(2);
  if (normalized.startsWith('a/') || normalized.startsWith('b/')) normalized = normalized.slice(2);
  return normalized.replace(/\/+/g, '/');
}

function trailingSegmentScore(left: string, right: string): number {
  const a = normalizePath(left).split('/');
  const b = normalizePath(right).split('/');
  let score = 0;
  while (score < a.length && score < b.length && a[a.length - 1 - score] === b[b.length - 1 - score]) {
    score++;
  }
  return score;
}

/**
 * Apply the grounding gate to a set of findings against a unified diff.
 * Returns the kept findings and the dropped ones with reasons (for the trace).
 */
export function groundFindings(findings: Finding[], diff: UnifiedDiff): GroundingResult {
  const lineIndex = buildLineIndex(diff);
  const normalizedFiles = new Map<string, string[]>();
  for (const file of diff.files) {
    const normalized = normalizePath(file.path);
    normalizedFiles.set(normalized, [...(normalizedFiles.get(normalized) ?? []), file.path]);
  }
  const kept: Finding[] = [];
  const dropped: { finding: Finding; reason: string }[] = [];
  const rewritten: GroundingResult['rewritten'] = [];

  for (const finding of findings) {
    if (!Number.isInteger(finding.start_line) || !Number.isInteger(finding.end_line) || finding.start_line < 1 || finding.end_line < 1) {
      dropped.push({ finding, reason: 'line range must contain positive integers' });
      continue;
    }

    const normalized = normalizePath(finding.file);
    let candidates = normalizedFiles.get(normalized) ?? [];
    if (candidates.length === 0) {
      const basename = normalized.split('/').at(-1);
      candidates = diff.files
        .filter((file) => normalizePath(file.path).split('/').at(-1) === basename)
        .filter((file) => rangeIntersects(lineIndex.get(file.path) ?? new Set(), finding.start_line, finding.end_line))
        .map((file) => file.path);
    }

    let file: string | undefined;
    if (candidates.length === 1) {
      file = candidates[0];
    } else if (candidates.length > 1) {
      const ranked = candidates
        .map((candidate) => ({ candidate, score: trailingSegmentScore(normalized, candidate) }))
        .sort((a, b) => b.score - a.score);
      if (ranked[0]!.score > ranked[1]!.score) file = ranked[0]!.candidate;
      else {
        dropped.push({ finding, reason: `file '${finding.file}' is ambiguous in diff (${candidates.join(', ')})` });
        continue;
      }
    } else {
      dropped.push({ finding, reason: `file '${finding.file}' not present in diff` });
      continue;
    }
    if (file === undefined) {
      dropped.push({ finding, reason: `file '${finding.file}' could not be resolved uniquely` });
      continue;
    }

    const lines = lineIndex.get(file) ?? new Set<number>();
    if (rangeIntersects(lines, finding.start_line, finding.end_line)) {
      const grounded = file === finding.file ? finding : { ...finding, file };
      kept.push(grounded);
      if (file !== finding.file) rewritten.push({ finding: grounded, from: finding.file, to: file });
    } else {
      dropped.push({
        finding,
        reason: `lines ${finding.start_line}-${finding.end_line} do not intersect any diff hunk in '${file}'`,
      });
    }
  }

  return { kept, dropped, rewritten };
}

/** Human-readable summary, e.g. "3/3 passed" used in run-trace stats. */
export function groundingSummary(result: GroundingResult): string {
  const total = result.kept.length + result.dropped.length;
  return `${result.kept.length}/${total} passed`;
}
