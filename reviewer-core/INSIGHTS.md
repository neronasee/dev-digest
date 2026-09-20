# reviewer-core/ — INSIGHTS

Non-obvious knowledge you can't infer from the code or git history: gotchas hit
in practice, "why it's built this way", debugging dead ends.

Contract:

- Append only — never rewrite, reword, or prune existing entries.
- One dated bullet per insight, newest on top of its section:
  `- YYYY-MM-DD — one actionable sentence. (<file>:<line> or dir/PR ref)`
- If it belongs in the README, `docs/`, or a `specs/` file instead — put it there.

## What Works

<!-- newest on top -->

- _none yet_

## What Doesn't Work

<!-- newest on top -->

- _none yet_

## Codebase Patterns

<!-- newest on top -->

- 2026-09-20 — The `UnifiedDiff` zod gate lives ONLY at `reviewPullRequest` entry (src/review/run.ts); `groundFindings`/`sliceDiff` stay defensive (optional-chain guards) because they are exported and callable directly, bypassing the gate. The vendored schemas (vendor/shared/adapters.ts) must stay at least as permissive as the server's `parseUnifiedDiff`: deleted-file hunks emit `@@ -1,N +0,0 @@` → `newStart`/`newLines` **0** and an EMPTY `newLineNumbers` — tightening to ≥1 or non-empty would fail live runs; a run.test.ts fixture pins this.
- 2026-09-20 — `DiffHunk` carries ranges and line numbers, NOT text — any hunk-based reconstruction (e.g. the sliceDiff fallback) can only emit `+ [line N]` placeholders; the raw diff slice is the sole source of line text, so the fallback can never be "improved" into real content without changing the vendored contract. (src/review/reduce.ts)

## Tool & Library Notes

<!-- newest on top -->

- _none yet_

## Recurring Errors & Fixes

<!-- newest on top -->

- _none yet_

## Session Notes

<!-- newest on top -->

- _none yet_

## Open Questions

<!-- newest on top -->

- _none yet_
