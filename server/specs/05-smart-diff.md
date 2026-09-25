# 05 — Smart Diff: role-grouped Files-changed with inline findings

Status: **implemented** (2026-09-25) · Scope: `server/` · `client/` · shared contracts
Related: [`04-pr-intent.md`](04-pr-intent.md) — same module-local application-layer
discipline (`intent.ts` / `smart-diff/`); the diff viewer it feeds lives in
`client/src/components/diff-viewer/`.

The Files changed tab groups a PR's files by ROLE — core → tests → wiring →
docs → boilerplate, docs and boilerplate collapsed — and marks the latest
review's findings inline under the diff lines they cite. No LLM anywhere: the
grouping is pure path classification over `pr_files`, and the finding lines are
pure DB reads.

## 1. Decisions taken

| # | Decision | Consequence |
|---|----------|-------------|
| D1 | Classification is **pure path matching, precedence-first** — `boilerplate → tests → wiring → docs`, first match wins, `core` is the fallback | deterministic, testable, zero cost; a path has exactly one role regardless of how many patterns would match |
| D2 | **Glob subject depends on the pattern**: a pattern without `/` matches the file's BASENAME (`*.lock`, `index.ts`, `README*`, `.env*`, `*.config.*`, `tsconfig*.json`); a pattern with `/` matches the FULL repo-relative path (`dist/**`, `**/__tests__/**`, `e2e/**`) | `api/poetry.lock` is boilerplate without enumerating every lockfile dir; directory-scoped patterns can't accidentally match same-named files elsewhere |
| D3 | The three CONTESTED cases are pinned by tests, not accident: `src/__tests__/__snapshots__/x.snap` → **boilerplate** (a committed snapshot is generated output, even inside a test tree); `.claude/**` → **wiring** (tooling beats `*.md`); `e2e/README.md` → **tests** (the e2e surface is a test, conscious default) | re-litigating any of them fails `test/smart-diff.test.ts` — change the spec AND the test together |
| D4 | "Findings of the last review" = the findings of the **single newest `reviews` row** (`reviewsForPull` is `created_at desc` → `rows[0]`); the client computes the identical set as `reviews[0]?.findings ?? []` from `GET /pulls/:id/reviews` | one source of truth on both sides — server `finding_lines` and client dots/inline comments can never disagree |
| D5 | D4 trade-off: in a multi-agent round **only the last-finishing agent's pass shows inline**; accept/dismiss state never changes membership (it only mutes cards); a finding whose file is not among `pr_files` is ignored for `finding_lines` | rejected alternatives: all-reviews-ever (stale rounds leak into counters) and round-grouping via `multi_run_id` (impossible client-side — `ReviewRecord` carries no round key; that would be a contract change, revisit if the multi-agent demo gap matters) |
| D6 | **No LLM, no adapters** in the whole feature | the route is two repository reads + pure functions; no feature-model, no cost row, no failure mode beyond DB |
| D7 | `split_suggestion` is filled **minimally**: `too_big: false`, `total_lines` = Σ additions+deletions over ALL files, no proposed splits | heuristics + the `largeTitle/largeBody` banner are future Brief work; the contract shape ships now |
| D8 | The classifier stays **importable standalone** (`modules/reviews/smart-diff/` has no HTTP/DB/container imports) | L08 prompt-assembly filtering reuses `classifyFile`/`SMART_DIFF_ROLE_ORDER` later without touching transport |

## 2. What already existed (do not rebuild)

| Layer | Already there | File |
|-------|---------------|------|
| Contracts | `SmartDiffRole` (3 values), `SmartDiffFile`, `SmartDiffGroup`, `SmartDiff`, `SmartDiffResponse` | `vendor/shared/contracts/brief.ts`, `contracts/review-api.ts` |
| Repository | `getPrFiles`, `reviewsForPull` (newest-first with findings) | `modules/reviews/repository/` |
| Route precedent | schema-first GET with `z.infer` DTO (intent route) | `modules/reviews/routes.ts` |

The only contract change: `SmartDiffRole` widened 3 → 5 values
(`core, tests, wiring, docs, boilerplate`), mirrored byte-identically into both
vendored copies.

## 3. Server — `src/modules/reviews/smart-diff/`

`constants.ts` (pure data): `SMART_DIFF_ROLE_ORDER` (display order), 
`SMART_DIFF_PRECEDENCE` (match order, no `core` — it is the fallback, never
matched), `SMART_DIFF_PATTERNS` (one matcher list per non-core role).
`classify.ts`: `classifyFile(path)` — picomatch matchers compiled once at
module scope; per pattern, basename or full path per D2; walks the precedence,
returns `'core'` when nothing matches. `smart-diff.ts`: `buildSmartDiff(files,
findings)` — groups in role order (empty groups omitted, input order kept
inside a group), per file `finding_lines` = sorted deduped `start_line`s of
findings whose `file` equals the path (unknown-file findings dropped), the D7
minimal `split_suggestion`.

```
GET /pulls/:id/smart-diff  → SmartDiffResponse  (uuid params; global rate limit)
```

`ReviewService.smartDiffForPull`: workspace-scoped `getPull` (404), then
`Promise.all([getPrFiles, reviewsForPull])`, pinned newest-review findings
mapped to `{ file, start_line }`, then `buildSmartDiff`.

## 4. Client

`useSmartDiff` (`lib/hooks/reviews.ts`, key `["smart-diff", prId]`) polls every
4s while the SHARED `usePrActiveRuns` cache reports a run, and on the
running→settled transition invalidates `["smart-diff", prId]` +
`["reviews", prId]` — counters, dots and inline comments refresh when a run
started elsewhere settles. UI decisions live in
[`../../client/specs/02-smart-diff-ui.md`](../../client/specs/02-smart-diff-ui.md).

## 5. Testing

| Lane | What |
|------|------|
| server unit (hermetic) | `test/smart-diff.test.ts` — the full path→role table incl. the 3 contested cases, group order/omission, finding_lines semantics, split totals |
| server DB (Docker) | `test/smart-diff.it.test.ts` — route over real Postgres: 200 + grouping, newest-review pinning (older review's findings absent), unknown-file finding ignored, totals, foreign-workspace 404, non-uuid 422 |
| client | `FileCard.test.tsx` (dot, marked line, anchored comment under RIGHT:newNo, unanchored footer) + `SmartDiffView.test.tsx` (through DiffTab + real hooks: groups, collapse defaults, counter, toggle, no-review state, resilient fallback) |
| e2e | none — grouping is deterministic and covered above; add a flow only if a regression escapes |
