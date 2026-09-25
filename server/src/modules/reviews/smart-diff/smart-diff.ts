// Smart Diff builder — groups PR files by role and marks finding lines, pure
// and synchronous: no HTTP, no DB, no container, no LLM (pseudocode summaries
// and split heuristics are future Brief work; both stay minimal here).
import type { SmartDiff, SmartDiffFile, SmartDiffGroup, SmartDiffRole } from '@devdigest/shared';
import { classifyFile } from './classify.js';
import { SMART_DIFF_ROLE_ORDER } from './constants.js';

/** Minimal file shape the builder needs (a superset arrives from the repo). */
export type SmartDiffFileInput = { path: string; additions: number; deletions: number };

/** Minimal finding shape: which file, which (new-side) line it anchors to. */
export type SmartDiffFindingInput = { file: string; start_line: number };

/**
 * Build the SmartDiff for a PR:
 *  - files grouped per `classifyFile` in `SMART_DIFF_ROLE_ORDER` (empty groups
 *    omitted; input order preserved within a group);
 *  - per file, `finding_lines` = sorted, deduped `start_line`s of findings
 *    whose `file` equals the path — findings on files not among the inputs are
 *    ignored for line marking (they cannot anchor anywhere);
 *  - `split_suggestion` filled minimally: never too_big, Σ additions+deletions
 *    across ALL files, no proposed splits.
 */
export function buildSmartDiff(
  files: ReadonlyArray<SmartDiffFileInput>,
  findings: ReadonlyArray<SmartDiffFindingInput>,
): SmartDiff {
  // Findings by path, line deduped per file (sorted when materialized below).
  const linesByPath = new Map<string, Set<number>>();
  for (const f of findings) {
    const set = linesByPath.get(f.file) ?? new Set<number>();
    set.add(f.start_line);
    linesByPath.set(f.file, set);
  }

  // Bucket files per role, preserving input order inside each bucket.
  const buckets = new Map<SmartDiffRole, SmartDiffFileInput[]>();
  for (const file of files) {
    const role = classifyFile(file.path);
    const list = buckets.get(role) ?? [];
    list.push(file);
    buckets.set(role, list);
  }

  const groups: SmartDiffGroup[] = [];
  for (const role of SMART_DIFF_ROLE_ORDER) {
    const bucket = buckets.get(role);
    if (!bucket || bucket.length === 0) continue; // empty groups omitted
    groups.push({
      role,
      files: bucket.map(
        (f): SmartDiffFile => ({
          path: f.path,
          pseudocode_summary: null,
          additions: f.additions,
          deletions: f.deletions,
          finding_lines: [...(linesByPath.get(f.path) ?? [])].sort((a, b) => a - b),
        }),
      ),
    });
  }

  const totalLines = files.reduce((n, f) => n + f.additions + f.deletions, 0);
  return {
    groups,
    split_suggestion: { too_big: false, total_lines: totalLines, proposed_splits: [] },
  };
}
