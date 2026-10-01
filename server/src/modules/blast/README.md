# blast — what else can this change affect?

L04's read-only feature: serves the "Blast radius" block on the PR Overview
tab and the "Prior PRs touching these files" block below it. Data-only by
design — **no LLM, no clone access, no new tables**; it maps already-computed
repo-intel index data and already-persisted PR rows into shared contracts.

## Routes

| Route | Response | Source |
|---|---|---|
| `GET /pulls/:id/blast` | `BlastRadius` (vendored `contracts/brief.ts`) | ONE `repoIntel.getBlastRadius` + ONE `repoIntel.getIndexState` facade call |
| `GET /pulls/:id/history` | `PrHistory` (vendored `contracts/brief.ts`) | `pullsRepo` overlap query over `pull_requests` ⋈ `pr_files` |

Both routes resolve the PR workspace-scoped first (`pullsRepo.getPull`) — a
foreign PR 404s identically to a missing one (B12).

## Flat → grouped mapping (`helpers.ts#toBlastRadius`)

The repo-intel facade returns a FLAT result: changed symbols plus caller rows
carrying `viaSymbol` (which changed symbol the caller reaches) and `rank`.
`toBlastRadius` regroups it:

- **Self-caller filter (defensive)** — drops caller rows whose file declares
  the symbol they reach, and rows whose `viaSymbol` matches no changed symbol.
  The ripgrep facade path already skips same-file refs; the persistent SQL
  path does not — blast filters here so both paths are safe.
- **Grouping** — one `DownstreamImpact` per changed symbol (zero-caller
  symbols keep their entry with `callers: []`), callers in facade order.
- **Facts attribution** — a symbol's `endpoints_affected` / `crons_affected`
  are the ordered-dedup UNION of its caller files' precomputed facts
  (`factsByFile`; `[]` when absent, i.e. on the degraded path).
- **Ordering** — `downstream` sorted by each group's max caller rank, desc
  (stable sort keeps changed-symbol order on ties).
- **Degraded/reason** — `degraded` is set when the facade result flags it OR
  the index state is not `full` (the persistent path reports `degraded: false`
  even for a `partial` index; one `getIndexState` read derives partial-ness
  here). Reason precedence: the result's own `reason`, else `index_partial`
  for a partial index, else the state's `degradedReason`, else `index_failed`
  for a failed index, else `no_data`.

Limits are NOT re-clamped here — the facade already clamps; blast renders
its result as-is.

## Prior-PR overlap (`helpers.ts#toPrHistory` + `PullsRepository.findOverlappingPrs`)

The overlap is one local DB query (no GitHub adapter): merged PRs of the same
repo with a lower number sharing at least one of the current PR's `pr_files`
paths, bounded by `.limit(200)` rows before grouping, capped at 5 PR groups in
the response. `merged_at` comes from `updated_at ?? opened_at ?? epoch`
(`pull_requests` has no `merged_at` column — spec decision D9). The query
lives in the OWNING pulls module's repository (its own tables); blast owns no
tables and no `repository.ts`.

Design decisions and their rationale: [`specs/06-blast-radius.md`](../../../specs/06-blast-radius.md).
Session learnings: [`INSIGHTS.md`](../../../INSIGHTS.md).
