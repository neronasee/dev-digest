/**
 * Pure helpers for SkillDetailView — no dependencies, no I/O.
 */

export type DiffRowType = "same" | "added" | "removed";
export interface DiffRow {
  type: DiffRowType;
  text: string;
}

/** Lines are capped so a huge diff can't blow the LCS (O(n·m)) budget. */
const MAX_DIFF_LINES = 400;

/**
 * Line-based diff of `a` (old) vs `b` (new) via LCS, emitting rows in order:
 * removed lines (in a but not b), added lines (in b but not a), same lines.
 * Rows are NOT word-level — this is a review aid, not a patch format.
 */
export function lineDiff(a: string, b: string): DiffRow[] {
  const A = a.replace(/\r\n/g, "\n").split("\n").slice(0, MAX_DIFF_LINES);
  const B = b.replace(/\r\n/g, "\n").split("\n").slice(0, MAX_DIFF_LINES);
  const n = A.length;
  const m = B.length;

  // LCS length table.
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = A[i] === B[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  // Walk the table.
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      rows.push({ type: "same", text: A[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      rows.push({ type: "removed", text: A[i]! });
      i++;
    } else {
      rows.push({ type: "added", text: B[j]! });
      j++;
    }
  }
  while (i < n) rows.push({ type: "removed", text: A[i++]! });
  while (j < m) rows.push({ type: "added", text: B[j++]! });
  return rows;
}
