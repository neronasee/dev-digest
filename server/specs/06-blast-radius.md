# 06 — Blast Radius: what else a change can affect

Status: **implemented** (2026-09-28) · Scope: `server/` · `client/` · `mcp/` · shared contracts
Related: [`05-smart-diff.md`](05-smart-diff.md) — same Overview-tab surface;
repo-intel (the index this feature reads) is documented in
`src/modules/repo-intel/`.

The PR Overview tab shows a "Blast radius" block — changed symbols, their
downstream callers as `file:line` links pinned to the PR's head sha, and the
HTTP endpoints / cron jobs reachable from the callers — with a collapsible
"Prior PRs touching these files" section folded into the card's bottom. An
MCP tool (`get-blast-radius`) exposes
the same map to coding agents. No LLM anywhere: both routes are pure reads
over the finished repo-intel index and persisted PR rows.

## 1. Decisions taken

| # | Decision | Consequence |
|---|----------|-------------|
| D1 | The vendored `BlastRadius` contract was **extended in place** (optional `degraded` + `reason: BlastDegradedReason`), not wrapped | the route response validates against `BlastRadius` itself and fastify-type-provider-zod's serializer safeParses/strips unknown keys — a wrapper would fail both; optional fields keep every existing `PrBrief.blast` producer valid |
| D2 | Exactly **ONE `getBlastRadius` + ONE `getIndexState`** facade call per blast request | no clone access, no `codeIndex`, no re-parse on the hot path; the API log line (`blast radius served from repo-intel index`) is the P2 evidence |
| D3 | **Zero-caller symbols keep a `DownstreamImpact`** with `callers: []` | "this changed symbol has no downstream callers" is information, not an error; the UI renders an honest no-callers row |
| D4 | **Facts attribution = union over caller files**: a symbol's `endpoints_affected`/`crons_affected` are the ordered-dedup union of its caller files' `factsByFile` entries | endpoints/crons land on the symbol whose callers can reach them, without inventing per-caller edges the index doesn't store; `[]` when `factsByFile` is absent (degraded path) |
| D5 | The **self-caller filter is defensive** (in blast's mapping), not SQL-enforced | the ripgrep facade path already skips same-file refs; the persistent path's SQL has no `from_path <> decl_file` guard — filtering at the consumer keeps both paths safe without touching repo-intel's owned queries |
| D6 | `degraded` combines the result's own flag with **index partial-ness derived from the one `getIndexState` read**; reason precedence: result `reason` → `index_partial` (partial state) → state `degradedReason` → `index_failed` (failed state) → `no_data` | the persistent facade path reports `degraded: false` even for a `partial` index — the UI would otherwise show a confident map over an incomplete index |
| D7 | **No module-owned tables**: blast has no `repository.ts`; PR rows/files come via `container.pullsRepo`, the blast map via `container.repoIntel`; the overlap query was ADDED to the owning pulls module's `PullsRepository` read surface | respects the onion dependency rule (no sibling-module imports, depcruise error-severity gate stays clean) while keeping `pull_requests`/`pr_files` queries in the module that owns them |
| D8 | `summary` uses a fixed template (`S changed symbol(s), C downstream caller(s), E impacted endpoint(s), J impacted cron job(s)`) and `downstream` is ordered by the group's **max caller rank, desc** (stable tie-break = changed-symbol order) | the counts are recomputed server-side (single source of truth), and the highest-blastword symbol reads first |
| D9 | Prior PRs ride a **separate `GET /pulls/:id/history` route**, are computed **local-first over `pr_files`** (merged, same repo, lower number, path overlap; `.limit(200)` rows before grouping, cap 5 groups), with `merged_at = updated_at ?? opened_at ?? epoch` (no `merged_at` column) and `notes` derived | folding history into `/blast` would either break "response validates against `BlastRadius`" or widen that contract with foreign fields; no GitHub adapter on this path — revisit only if PR retention shrinks |
| D10 | The UI tree/graph is **hand-rolled** (disclosure rows + layered SVG; no chart dependency), and collapse state stays **local per symbol group**. The block-level `noDownstream` empty state renders in **tree view only** — at zero callers the graph view stays reachable and shows its own `graph.empty` state instead | zero new client dependencies; view state never leaves the block; counts derive during render (never `useState`); the view toggle must remain operable when there is nothing to graph (resolves the plan's Task 5 wording vs Task 6 case (d) contradiction) |
| D11 | Changed symbols declaring the **same name in different changed files collapse into one `downstream` group** (the contract and the facade's `viaSymbol` key impact by bare name — neither can disambiguate declarations) | two groups would duplicate the same caller list and make the summary's flat caller count diverge from the per-group sum the UI stats show; `changed_symbols` still lists every declaration |
| D12 | The graph view **caps before layout** (deterministic, no measurement effects): top **8** symbol groups in server rank order, ≤ **6** caller and ≤ **5** endpoint/cron pills per group, and trailing groups dropped while > 3 groups exceed a **48-row** budget — capped maps render a `graph.trimmed` note pointing back at the tree view, which never caps. Edges connect each symbol to its callers and group-level endpoint/cron pills, never a caller to a pill (D4). The tree's endpoint pills preview **5** with a `+N more` expander; impact badges (and count badges inside header buttons) are **`<span>`s, never `Chip`s** — `Chip` renders a `<button>`, and a button nested in the group-header disclosure `<button>` is invalid HTML | live worst case was 80 endpoints in one group (`logger` on hono #5402) — uncapped, the SVG and the pill row both drown the signal; the caps mirror the server's rank order so tree and graph agree on what matters |

## 2. What already existed (do not rebuild)

| Layer | Already there | File |
|-------|---------------|------|
| Facade | `getBlastRadius(repoId, changedFiles)` (flat callers w/ `viaSymbol` + `rank`, `factsByFile`, degraded flags; limits clamped inside), `getIndexState` | `modules/repo-intel/types.ts`, `service.ts` |
| Contracts | `BlastRadius` (pre-extension), `DownstreamImpact`, `PrHistory`/`PrHistoryItem` | `vendor/shared/contracts/brief.ts` (both copies) |
| Persistence | `pull_requests` (status incl. `merged`, `number`, `updated_at`), `pr_files` (path), `PullsRepository.getPull/listFiles` | `db/schema/pulls.ts`, `modules/pulls/repository.ts` |

The only contract change: `BlastRadius` grew optional `degraded`/`reason`
(+ `BlastDegradedReason` enum), mirrored byte-identically into both vendored
copies (D1).

## 3. Server — `src/modules/blast/`

`helpers.ts` (pure): `toBlastRadius` (the D3–D6, D8 mapping) and `toPrHistory`
(D9 grouping/cap/intersection/`merged_at` fallback). `service.ts`:
`BlastService.forPull` (D2: resolve PR workspace-scoped → `listFiles` →
`Promise.all([getBlastRadius, getIndexState])` → map → log) and
`historyForPull` (overlap read → map → log). `routes.ts`: the two GETs above,
zod `params` + `response` schemas only.

```
GET /pulls/:id/blast    → BlastRadius  (uuid params; one facade call each)
GET /pulls/:id/history  → PrHistory    (uuid params; pullsRepo overlap only)
```

`PullsRepository.findOverlappingPrs(repoId, beforeNumber, paths)` — one
inner-join select over `pull_requests` ⋈ `pr_files`
(`repoId` + `status='merged'` + `number < beforeNumber` + `path IN paths`),
`orderBy(number desc)`, `.limit(200)`.

## 4. Client

`usePrBlastRadius` / `usePrHistory` (`lib/hooks/blast.ts`) both feed
`BlastRadiusCard` on the Overview tab (under `IntentCard`): the stats row
(derived at render, one leading icon per stat) with the collapsible symbol
tree (`<>` symbol headers, `↳` caller connectors, endpoint pills with a
`+N more` expander and amber cron pills), the graph view (rounded-rect node
pills, cubic-bezier edges without arrowheads, legend row, caps + `trimmed`
note — D12), the degraded badge + `Resync index` via `useResyncRepoIntel`,
the `noDownstream`/`graph.empty` honest empties, and — folded in behind a
divider where a standalone `PrHistoryCard` used to sit — `PrHistorySection`
(collapsible "Prior PRs touching these files" row with a count badge;
GitHub-linked items, shared-file chips, honest empty, `+N more` past 5).
All copy lives in `messages/en/blast.json`.

## 5. MCP

`get-blast-radius` (`mcp/src/tools/get-blast-radius.ts`) wraps
`GET /pulls/:id/blast`: `repo` + `pr_number` input, resolver chain
(`resolveRepoId` → `resolvePullId`), payload passed through unchanged
(facade-capped), `readOnlyHint: true`. It deliberately does NOT expose prior
PRs — blast-map parity only; history is human context on a second route.

## 6. Tests

Hermetic: `server/test/blast-mapping.test.ts` (mapping + degraded matrix +
contract safeParse), `server/test/blast-service.test.ts` (one-call-per-facade,
404 scoping, log lines), `server/test/blast-history.test.ts` (grouping/cap/
intersection/`merged_at` fallback + service), `client/.../BlastRadiusCard.test.tsx`
(stats + icons, caller links, pill styles + expander, collapse, tree/graph
toggle incl. pill/edge/legend structure and the 12-group cap, degraded,
headSha-null, empties, prior-PR section expand/empty/plain-text — the
`PrHistoryCard` suite was folded in when the card was), `mcp/test/tools.test.ts`
(+ server.test.ts resolver-chain case). DB-backed:
`server/test/blast-history.it.test.ts` (Testcontainers; merged/open/disjoint
fixtures over the real overlap SQL).
