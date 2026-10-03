# Development Plan — Blast Radius (course L04), all P3 in scope

## Goal
Show a PR reviewer what else the repo a change can affect: a "Blast radius" block on the PR Overview tab (collapsible symbol tree, hand-rolled graph view, resync action) plus "Prior PRs touching these files", and an MCP tool — all fed by read-only routes that map already-computed repo-intel / persisted-PR data into shared contracts. No new analysis, no LLM, no new tables.

## Context
- Facade (verified): `getBlastRadius(repoId, changedFiles): Promise<BlastResult>` — `server/src/modules/repo-intel/types.ts:147`, shape at `types.ts:74-87` (flat `callers` w/ `viaSymbol` + `rank`; `factsByFile?`; `degraded?`/`reason?`). Never throws. Limits already clamped by the facade (`repo-intel/constants.ts`).
- Self-caller guarantee (verified): ripgrep path skips same-file refs (`repo-intel/service.ts:288`); persistent path has NO SQL `from_path <> decl_file` guard (`repository.ts:534-562`) — blast MUST filter defensively.
- Degraded nuance (verified): persistent path returns `degraded: false` even for `state.status === 'partial'` (`service.ts:330-406`); `tryGetIndexState` flags only `degraded|failed` — partial-ness is derived from one `getIndexState` read.
- Onion gate (verified): depcruise `no-cross-module-internals` is ERROR severity — blast MUST NOT import `../repo-intel/*` or `../pulls/*`. Facade via `container.repoIntel`, PR rows via `container.pullsRepo`, types derived via `Container['repoIntel']` (the `reviews/run-executor.ts` pattern).
- Server INSIGHTS 2026-09-20: derive DTOs with `z.infer` from the SAME schema declared in `response:`; `z.enum()` needs a literal tuple; Fastify's zod serializer safeParses the return and strips unknown keys — every UI-needed field MUST be in the response schema.
- Prior-PRs data source (verified): `pr_files` is a local table (`db/schema/pulls.ts:36-48`, `path` persisted; `PullsRepository.listFiles` reads the DB — `modules/pulls/repository.ts:221-223`). `pull_requests` has `status` incl. `'merged'` (`PrStatus` enum, `contracts/platform.ts:155`), `number`, `opened_at`, `updated_at` — NO `merged_at` column. Local-first overlap query needs NO GitHub adapter surface.
- Client INSIGHTS 2026-09-25: next-intl resolves a namespace at hook-mount — test providers must include `blast`. Fetch stubbed per test (throwing default in `src/test/setup.ts`).
- MCP house pattern: `mcp/src/tools/get-findings.ts`; hermetic route-stub tests in `mcp/test/tools.test.ts`.
- No blast spec exists (`server/specs/` = 01–05) → create `06-blast-radius.md`. Copy base: `client/messages/en/blast.json` (`stat.*`, `callerCount`, `noDownstream`, `view.tree/graph`, `graph.empty/ariaLabel`).
- Seeded demo gap (verified): experiment PRs #483/#484 are `needs_review` (not `merged`) with disjoint files (`db/seed.ts:541-573`) — the prior-PRs demo needs a merged PR sharing files (see demo step 5).
- Git state: branch `homework4/01-mcp`, clean. Tool name is `get-blast-radius` (homework's `get-blast_radius` is a typo).

## Affected modules
| Module | Why it changes | Its package checks |
|---|---|---|
| `server/` | New `blast` module (2 routes), vendored contract edit, `pulls` repository read-surface extension | `pnpm typecheck`; `pnpm exec vitest run --exclude '**/*.it.test.ts'`; `pnpm depcruise`; `pnpm exec vitest run .it.test` (Docker, history lane) |
| `client/` | Vendored contract edit (mirror), hooks, BlastRadiusCard + BlastGraph, PrHistoryCard, copy | `pnpm typecheck`; `pnpm test` |
| `mcp/` | Replace stub tool + api-client method | `npm run typecheck`; `npm test` |
| `reviewer-core/`, `e2e/` | Untouched | — |

## Binding constraints
- Onion: routes = transport only; service = orchestration via container only; blast owns NO tables (no `repository.ts`) — PR data via `container.pullsRepo`; the overlap query is added to the OWNING module's `PullsRepository` (sanctioned by the onion skill's "extend the owning module's repository read surface"). No imports from sibling modules.
- Facade discipline: exactly ONE `getBlastRadius` + ONE `getIndexState` per blast request; no clone access, no `codeIndex`, no LLM; no limits hardcoded in blast (facade clamps; blast renders as-is).
- Vendor sync: both `contracts/brief.ts` copies edited identically; `diff -r server/src/vendor/shared client/src/vendor/shared` empty; typecheck BOTH packages.
- No migrations, no npm/pnpm dependency changes (graph is hand-rolled SVG — no chart lib), no lockfile edits.
- Naming: PascalCase components + barrels; kebab server modules; hermetic server tests never end `.it.test.ts`; the history DB test MUST (it imports `test/helpers/pg.ts`).
- All user-visible copy via next-intl in `client/messages/en/blast.json` — never inline.
- Spec rule: create `server/specs/06-blast-radius.md` in this same change.

## Tasks

### Task 1 — Extend the vendored `BlastRadius` contract with degraded/reason
- **Files** — `server/src/vendor/shared/contracts/brief.ts` (edit); `client/src/vendor/shared/contracts/brief.ts` (edit: byte-identical mirror).
- **Change** — decision BOUND (extension, not a wrapper): P2 requires the route response to validate against `BlastRadius` itself, and the zod serializer strips unknown keys — a wrapper fails both; optional fields keep every `PrBrief.blast` producer valid. In both copies:
  ```ts
  export const BlastDegradedReason = z.enum([
    'flag_off', 'index_failed', 'index_partial', 'repo_too_large', 'no_data',
  ]);
  export type BlastDegradedReason = z.infer<typeof BlastDegradedReason>;
  export const BlastRadius = z.object({
    changed_symbols: z.array(ChangedSymbol),
    downstream: z.array(DownstreamImpact),
    summary: z.string(),
    degraded: z.boolean().optional(),
    reason: BlastDegradedReason.optional(),
  });
  ```
  Literals mirror repo-intel's `DegradedReason` (identical strings); do NOT import server types into the vendor copy.
- **Interfaces** — Produces: `BlastRadius` (+ optional `degraded`/`reason`), `BlastDegradedReason`. Consumed by Tasks 2–7, 9.
- **Skills** — zod.
- **Verify** — `diff -r server/src/vendor/shared client/src/vendor/shared` (empty); `cd server && pnpm typecheck`; `cd client && pnpm typecheck`.

### Task 2 — Server `blast` module: mapping (incl. rank sort), service, routes, registration
- **Files**
  - `server/src/modules/blast/helpers.ts` (create): pure mapping + local types.
  - `server/src/modules/blast/service.ts` (create): `BlastService`.
  - `server/src/modules/blast/routes.ts` (create): default Fastify plugin — `GET /pulls/:id/blast` (history route added in Task 7).
  - `server/src/modules/index.ts` (edit: `import blast from './blast/routes.js'` + `blast` entry).
- **Change**
  - `helpers.ts`:
    ```ts
    type RepoIntel = Container['repoIntel'];
    export type BlastResult = Awaited<ReturnType<RepoIntel['getBlastRadius']>>;
    type IndexState = Awaited<ReturnType<RepoIntel['getIndexState']>>;
    export type BlastRadiusDto = z.infer<typeof BlastRadius>;  // from '@devdigest/shared'
    export interface Logger { info(o: object, m?: string): void; warn(o: object, m?: string): void; error(o: object, m?: string): void; debug(o: object, m?: string): void }
    export function toBlastRadius(result: BlastResult, state: IndexState): BlastRadiusDto
    ```
    Mapping algorithm (exact):
    1. `declFiles: Map<string, Set<string>>` (symbol name → declaring changed files) from `result.changedSymbols`.
    2. Self-caller filter: drop rows whose `row.file` ∈ `declFiles.get(row.viaSymbol)`; drop rows whose `viaSymbol` has no entry.
    3. Group survivors by `viaSymbol`; emit one `DownstreamImpact` per changed symbol (zero-caller symbols included, `callers: []`): `callers` = `{name: row.symbol, file: row.file, line: row.line}` (facade order); `endpoints_affected`/`crons_affected` = ordered-dedup UNION of `result.factsByFile?.[row.file]?.endpoints|.crons` over the group's caller files (`[]` when `factsByFile` absent). **Rank sort (P3, mandatory): order `downstream` by `max(rank)` of each group's caller rows desc, tie-break `changedSymbols` order.**
    4. `changed_symbols` = identity `{name, file, kind}`.
    5. `summary` = `` `${S} changed symbol(s), ${C} downstream caller(s), ${E} impacted endpoint(s), ${J} impacted cron job(s)` `` (S = symbols, C = post-filter flat callers, E/J = distinct union sizes across groups).
    6. `degraded = result.degraded === true || state.status !== 'full'`; when degraded: `reason = result.reason ?? (state.status === 'partial' ? 'index_partial' : state.degradedReason ?? (state.status === 'failed' ? 'index_failed' : 'no_data'))`; else omit both.
  - `service.ts` — `class BlastService { constructor(private container: Container) {} }`, `async forPull(workspaceId, prId, log): Promise<BlastRadiusDto>`: `container.pullsRepo.getPull(workspaceId, prId)` → `NotFoundError('Pull request not found')` (B12 scoping here); `listFiles(pr.id)` → paths; `Promise.all([getBlastRadius(pr.repoId, files), getIndexState(pr.repoId)])` (one call each); `log.info({ repoId, files: n, degraded }, 'blast radius served from repo-intel index')` (P2 evidence); return `toBlastRadius(...)`. Doc-comment: no HTTP, no raw SQL, facade-only.
  - `routes.ts` — mirror `modules/pulls/routes.ts`:
    ```ts
    app.get('/pulls/:id/blast',
      { schema: { params: IdParams, response: { 200: BlastRadius } } },
      async (req) => {
        const { workspaceId } = await getContext(app.container, req);
        return new BlastService(app.container).forPull(workspaceId, req.params.id, req.log);
      });
    ```
- **Interfaces** — Consumes: Task 1 schema; `container.pullsRepo`, `container.repoIntel`. Produces: `GET /pulls/:id/blast` → `BlastRadius` (Tasks 5, 9); `toBlastRadius` (Task 3).
- **Skills** — onion-architecture, fastify-best-practices, zod, security.
- **Constraints** — no `repository.ts` in blast; no sibling-module imports; depcruise stays 0 errors.
- **Verify** — `cd server && pnpm typecheck && pnpm depcruise`.

### Task 3 — Server hermetic tests (mapping + service)
- **Files** — `server/test/blast-mapping.test.ts` (create); `server/test/blast-service.test.ts` (create).
- **Change**
  - `blast-mapping.test.ts` — pure `toBlastRadius`: (a) happy path: 2+ changed symbols, flat callers incl. a self-caller row and an unknown-`viaSymbol` row, `factsByFile` over two caller files with overlapping endpoints + a cron → assert grouping, dropped rows, per-group endpoints/crons = union of its callers' files' facts, summary string exact, `downstream` rank ordering (give group B a higher-rank caller than group A → B first), `BlastRadius.safeParse(dto).success === true`; (b) degraded result (no `factsByFile`, `degraded: true, reason: 'no_data'`, state `full`) → empty endpoints/crons, flags pass through; (c) clean result + `state.status: 'partial'` → `degraded: true, reason: 'index_partial'`; (d) `state.status: 'failed'` → reason `'index_failed'`; (e) zero-caller symbol keeps its entry with `callers: []`.
  - `blast-service.test.ts` — stub container `as never` (pattern: `server/test/repo-intel-facade-degraded.test.ts`): `{ pullsRepo: { getPull, listFiles }, repoIntel: { getBlastRadius: vi.fn(), getIndexState: vi.fn() } }`. Assert: each facade method called exactly once with the right args; missing PR → `NotFoundError`; log line emitted.
- **Skills** — none (Table A `server/test/**`).
- **Constraints** — hermetic; no `test/helpers/pg.ts`; NOT `.it.test.ts`.
- **Verify** — `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`.

### Task 4 — Client hooks, types, copy
- **Files** — `client/src/lib/hooks/blast.ts` (create); `client/src/lib/hooks/index.ts` (edit: `export * from "./blast";`); `client/src/lib/types.ts` (edit: `export type { BlastRadius, BlastDegradedReason, ChangedSymbol, DownstreamImpact, BlastCaller, PrHistory, PrHistoryItem } from "@devdigest/shared";`); `client/messages/en/blast.json` (edit: add keys, keep existing).
- **Change**
  - `usePrBlastRadius(prId: string | null | undefined)` — `useQuery({ queryKey: ["blast", prId], queryFn: () => api.get<BlastRadius>(`/pulls/${prId}/blast`), enabled: !!prId })` (mirrors `hooks/intent.ts`; no 404 special-case).
  - `usePrHistory(prId: string | null | undefined)` — same shape, `queryKey: ["pr-history", prId]`, `api.get<PrHistory>(`/pulls/${prId}/history`)`.
  - New message keys: `title`, `subtitle` ("What this change can affect, from the repo index"), `noCallers` ("No downstream callers."), `error` ("Couldn't load the blast radius."), `degraded.label` ("Partial index"), `degraded.reason.{flag_off,index_failed,index_partial,repo_too_large,no_data}` ("Repo intel is switched off" / "Indexing failed" / "Index is incomplete" / "Repository too large to index" / "No index data yet"), `resync` ("Resync index"), `history.title` ("Prior PRs touching these files"), `history.empty` ("No prior PRs touch these files."), `history.merged` ("merged {date}"), `history.sharedFiles` ("{count} shared file(s)").
- **Interfaces** — Consumes: Task 1 contracts, Tasks 2 + 7 routes. Produces: both hooks + types for Tasks 5, 6, 8.
- **Skills** — react-best-practices, next-best-practices.
- **Verify** — `cd client && pnpm typecheck`.

### Task 5 — `BlastRadiusCard`: stats, collapsible tree, graph view, resync
- **Files**
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusCard/BlastRadiusCard.tsx` (create).
  - `.../BlastRadiusCard/BlastGraph.tsx` (create: colocated subcomponent).
  - `.../BlastRadiusCard/styles.ts` (create) and `.../BlastRadiusCard/index.ts` (create: `export { BlastRadiusCard, BlastRadiusCard as default } from "./BlastRadiusCard";`).
  - `.../OverviewTab/OverviewTab.tsx` (edit: props + render) and `.../PrDetailView/PrDetailView.tsx` (edit: pass `repoFullName`, `headSha={pr.head_sha}`, `repoId` down to OverviewTab).
- **Change**
  - `BlastRadiusCard({ prId, repoId, repoFullName, headSha }: { prId: string | null; repoId: string | null; repoFullName: string | null; headSha: string | null })` — states: `!prId` → null; loading → Skeletons; error → `t("error")` (+ ApiError message); data → Card + `SectionLabel icon="GitBranch"` + `t("title")`:
    - summary row — four counts DERIVED during render: symbols = `changed_symbols.length`, callers = `Σ downstream[].callers.length`, endpoints/crons = distinct unions; labels `stat.*`.
    - degraded badge — Chip with `t("degraded.label")` + `t(\`degraded.reason.${reason ?? "no_data"}\`)`; beside it the **resync button** (P3): `Button kind="tertiary" size="sm"` labelled `t("resync")`, calling the existing `useResyncRepoIntel(repoId)` (`client/src/lib/hooks/repo-intel.ts`), loading state from `isPending`; on success `qc.invalidateQueries({ queryKey: ["blast", prId] })` — indexing is async, so the refreshed map lands on the next refetch (no polling; a one-line note under the button is enough).
    - **view toggle** (P3): local `useState<"tree" | "graph">("tree")`; two small buttons labelled `t("view.tree")` / `t("view.graph")` (aria-pressed); tree renders the symbol list, graph renders `<BlastGraph downstream={downstream} />`.
    - **collapsible tree** (P3): one disclosure row per `downstream` entry — an in-file `SymbolGroup` subcomponent owning its own `useState<boolean>(true)` (default EXPANDED): header button (`aria-expanded`) shows symbol + kind/file + `callerCount`; expanded body shows callers as `file:line` anchors `href={githubBlobUrl(repoFullName, headSha, file, line)}` `target="_blank" rel="noreferrer"` (plain `file:line` text when `repoFullName`/`headSha` null — caller files aren't in the diff; links pin the head blob), plus endpoint/cron chips from `endpoints_affected`/`crons_affected`; `t("noCallers")` when empty (empty groups render no collapse control).
    - block-level empty state when caller total = 0 and symbols > 0: `t("noDownstream", { count })`.
  - `BlastGraph.tsx` — `export function BlastGraph({ downstream }: { downstream: DownstreamImpact[] })` (P3, hand-rolled SVG — NO new deps): when every group has 0 callers render the `t("graph.empty")` empty state; else a `<svg role="img" aria-label={t("graph.ariaLabel")}>` layered node-link: three columns at `x = 16 / 240 / 464` — left = changed-symbol nodes, middle = caller nodes (`file:line`, grouped vertically under their symbol, 26px row pitch), right = endpoint/cron chips (text nodes prefixed `EP:`/`CRON:` deduped per symbol); `<line>` edges symbol→its callers and caller→its chips; `viewBox` height = `max(total caller nodes, symbols) * pitch + 32`, width 640; deterministic layout, plain `<text>` labels, `vectorEffect="non-scaling-stroke"` on lines. Keep under ~120 lines.
  - OverviewTab: props `{ prBody, prId, repoId, repoFullName, headSha }`; render `<BlastRadiusCard ... />` between `IntentCard` and Description; Task 8 adds `PrHistoryCard` below it.
  - Use `@devdigest/ui` primitives (`Card`, `SectionLabel`, `Chip`, `Skeleton`, `EmptyState`, `Button`), `githubBlobUrl` from `@/lib/github-urls`. Keep each file < 200 lines.
- **Interfaces** — Consumes: Task 4 hooks/types/messages; `githubBlobUrl`; `useResyncRepoIntel`. Produces: the P1/P3 block.
- **Skills** — frontend-architecture, react-best-practices, next-best-practices.
- **Constraints** — derive counts, never `useState` them; collapse/toggle state stays local (push state down); no inline strings; no chart library.
- **Verify** — `cd client && pnpm typecheck`.

### Task 6 — Client component test (BlastRadiusCard)
- **Files** — `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusCard/BlastRadiusCard.test.tsx` (create).
- **Change** — follow `IntentCard.test.tsx`: `vi.stubGlobal("fetch", ...)` route stub for `/pulls/:id/blast`, `QueryClientProvider` (retry false) + `NextIntlClientProvider messages={{ blast: messages }}` (`import messages from "<deep-relative>/messages/en/blast.json"`). Cases: (a) one flow test — renders title + four stat counts, a caller anchor with `href` equal to `githubBlobUrl("acme/payments-api", "sha1", "src/routes/orders.ts", 42)`, endpoint chip under the right symbol, higher-rank symbol ordered first; (b) collapse — click the symbol header (`aria-expanded` flips) and its caller link leaves the document; re-expand restores it; (c) graph toggle — click `t("view.graph")` → `svg[aria-label]` present and tree callers hidden; back to tree restores them; (d) graph empty — no-callers fixture + graph view → `t("graph.empty")` rendered; (e) degraded fixture → badge with the index-partial reason text + resync button present; (f) `headSha={null}` → `file:line` text without an anchor; (g) zero-caller symbol shows `t("noCallers")`; block-level `noDownstream` when total = 0; (h) non-404 error renders `t("error")`.
- **Skills** — react-testing-library, react-best-practices.
- **Constraints** — assert DOM/behavior, never hook internals; provider MUST carry `blast` (client INSIGHTS 2026-09-25).
- **Verify** — `cd client && pnpm test`.

### Task 7 — Prior PRs (server): overlap query, service, route
- **Files**
  - `server/src/modules/pulls/repository.ts` (edit: add one read method — the OWNING module's read surface, onion rule 6).
  - `server/src/modules/blast/service.ts` (edit: add `historyForPull`).
  - `server/src/modules/blast/helpers.ts` (edit: add `toPrHistory` pure mapping).
  - `server/src/modules/blast/routes.ts` (edit: add `GET /pulls/:id/history`).
  - `server/test/blast-history.test.ts` (create, hermetic) and `server/test/blast-history.it.test.ts` (create, DB-backed).
- **Change** — approach BOUND (local-first, no GitHub): files are persisted in `pr_files`, so the overlap is one DB query.
  - `PullsRepository.findOverlappingPrs(repoId: string, beforeNumber: number, paths: string[]): Promise<PullRow & { sharedPath: string }[]>` — one select over `pull_requests` inner-join `pr_files` on `prId`, `where repoId = repoId AND status = 'merged' AND number < beforeNumber AND prFiles.path IN paths`, `orderBy(number desc)`, `.limit(200)`; return flat `{...pullFields, sharedPath}` rows. Table-ownership comment updated (reads its own tables only).
  - `helpers.ts` — `toPrHistory(rows, currentPaths): PrHistory` (PrHistory DTO via `z.infer<typeof PrHistory>`): group rows by `id` preserving `number desc`; per group `files_overlap` = ordered dedup of `sharedPath` ∩ `currentPaths`; `merged_at = (updatedAt ?? openedAt ?? new Date(0)).toISOString()` (no `merged_at` column — documented spec decision); `notes` = `` `shares ${files_overlap.length} file(s) with this PR` ``; cap 5 groups; empty input → `{ history: [] }`.
  - `BlastService.historyForPull(workspaceId, prId, log): Promise<PrHistory>` — `getPull` (NotFoundError), `listFiles` → paths, `findOverlappingPrs(pr.repoId, pr.number, paths)`, `toPrHistory(rows, paths)`; one `log.info({ repoId, overlap: n }, 'prior-PR overlap served from persisted pr_files')`.
  - Route: `app.get('/pulls/:id/history', { schema: { params: IdParams, response: { 200: PrHistory } } }, ...)` — same getContext/service shape as `/blast`.
  - Route-shape decision BOUND (separate route, not a `/blast` field): folding `PrHistory` into `BlastRadius` would either break the P2 criterion "response validates against the BlastRadius contract" or force widening that contract with foreign fields; `PrHistory` is already a standalone contract, so a sibling route keeps BOTH responses contract-valid.
  - Tests: hermetic `blast-history.test.ts` — `toPrHistory` grouping/cap/intersection/`merged_at` fallback + `PrHistory.safeParse`; service test additions in the same file with stubbed `pullsRepo` (one `findOverlappingPrs` call, NotFoundError). DB-backed `blast-history.it.test.ts` — testcontainers (`test/helpers/pg.ts`), migrate + seed, upsert fixture PRs via `PullsRepository` (a merged #470 touching `src/payments/refund.ts`, a merged #471 touching an unrelated file, an open #472 touching it), assert `GET /pulls/:id/history` via `app.inject` for the PR sharing the file returns exactly #470 with `files_overlap: ["src/payments/refund.ts"]`, and the unrelated-PR case returns `{ history: [] }`. Self-skips without Docker.
- **Interfaces** — Consumes: Task 1 (`PrHistory` already in vendor `brief.ts` — NO vendor edit needed for this task), `container.pullsRepo`. Produces: `GET /pulls/:id/history` → `PrHistory` (Tasks 4, 8).
- **Skills** — onion-architecture, drizzle-orm-patterns (repository hunk), fastify-best-practices + zod + security (route hunk).
- **Constraints** — repository method reads only `pull_requests`/`pr_files` (pulls-owned tables); no GitHub client anywhere in this path; `.limit(200)` guard before grouping.
- **Verify** — `cd server && pnpm typecheck && pnpm depcruise && pnpm exec vitest run --exclude '**/*.it.test.ts'`; `pnpm exec vitest run .it.test` needs Docker.

### Task 8 — Prior PRs (client): `PrHistoryCard`
- **Files**
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/PrHistoryCard/PrHistoryCard.tsx` (create) + `styles.ts` (create) + `index.ts` (create: `export { PrHistoryCard, PrHistoryCard as default } from "./PrHistoryCard";`) + `PrHistoryCard.test.tsx` (create).
  - `.../OverviewTab/OverviewTab.tsx` (edit: render `<PrHistoryCard prId={prId} repoFullName={repoFullName} />` below `BlastRadiusCard`).
- **Change** — `PrHistoryCard({ prId, repoFullName })`: `usePrHistory(prId)`; loading → Skeletons; error → minimal error text; empty (`history.length === 0`) → `EmptyState` with `t("history.empty")` (honest empty is a legit state); else a Card listing up to 5 items: `#number title` linking to `githubPrUrl(repoFullName, number)` (new tab; plain text when `repoFullName` null), author, `t("history.merged", { date: merged_at })`, shared-file chips (`files_overlap`, collapsed to `t("history.sharedFiles", { count })` when > 3), and `notes` as muted text. Copy via `useTranslations("blast")` (`history.*` keys from Task 4).
  - Test: fetch-stubbed, provider with `blast` namespace — (a) renders item title/link (`href` = `githubPrUrl("acme/payments-api", 470)`), shared-file chip, notes; (b) `{ history: [] }` → empty text; (c) `repoFullName={null}` → no anchor.
- **Interfaces** — Consumes: Task 4 `usePrHistory`/copy, `githubPrUrl` (`client/src/lib/github-urls.ts:16`).
- **Skills** — frontend-architecture, react-best-practices, next-best-practices; test: react-testing-library.
- **Verify** — `cd client && pnpm typecheck && pnpm test`.

### Task 9 — MCP `get-blast-radius` tool + api-client method
- **Files** — `mcp/src/api-client.ts` (edit); `mcp/src/tools/get-blast-radius.ts` (edit: full stub rewrite); `mcp/test/tools.test.ts` (edit: new `describe`); `mcp/README.md` (edit: tools-table row 5).
- **Change**
  - api-client: type-only `BlastRadius` import; `getBlastRadius(prId: string): Promise<BlastRadius>` → `get<BlastRadius>(`/pulls/${prId}/blast`)`.
  - Tool (pattern of `get-findings.ts`): zod-v4 input `{ repo: z.string().describe('Repository full_name or bare name'), pr_number: z.number().int().positive().describe('PR number, e.g. 482') }`; description: `'Blast radius of a pull request: changed symbols, their downstream callers as file:line, and affected HTTP endpoints and cron jobs. Call before reviewing or editing files a PR touches to see what else the change can impact.'`; `annotations: { readOnlyHint: true }`; handler `resolveRepoId` → `resolvePullId` → `client.getBlastRadius(prId)`; `structuredContent = { repo, pr_number, ...blast }` passed through unchanged (facade-capped); `content: [{ type: 'text', text: JSON.stringify(structuredContent) }]`; try/catch → `fail(e)` so unknown repo/PR returns a useful `isError` listing candidates. Decision BOUND: the tool does NOT expose prior PRs — homework P1 parity is the blast map itself; history is human context on a second route and would double the tool's output noise.
  - Tests: happy path (routes `{...baseRoutes, '/pulls/pr-482/blast': fixture}` — call order `GET /repos`, `GET /repos/repo-1/pulls`, `GET /pulls/pr-482/blast`, structuredContent passthrough incl. `degraded`/`reason`); unknown PR → `isError` with the ResolveError text.
  - README row: `| 5 | get-blast-radius | repo, pr_number | GET /pulls/:id/blast | yes |`.
- **Skills** — typescript-expert, zod.
- **Constraints** — type-only imports from `@devdigest/shared`; `tools/index.ts` needs no edit.
- **Verify** — `cd mcp && npm run typecheck && npm test`.

### Task 10 — Docs: module README, spec, API maps
- **Files**
  - `server/src/modules/blast/README.md` (create): what it does (reads finished repo-intel + persisted PR data, no LLM), both routes, the flat→grouped mapping rule (group by `viaSymbol`; group endpoints/crons = union of its callers' files' facts), degraded/reason derivation, prior-PR overlap rule, pointer to the spec.
  - `server/specs/06-blast-radius.md` (create): `05-smart-diff.md` format — decisions: D1 contract extension over wrapper (serializer strips unknown keys; response must validate against `BlastRadius`); D2 one `getBlastRadius` + one `getIndexState` call; D3 zero-caller symbols keep a `DownstreamImpact`; D4 facts attribution = union over caller files; D5 defensive self-caller filter (facade guarantee is implicit, not SQL-enforced); D6 degraded derivation incl. partial; D7 no module-owned tables — reads via `container.pullsRepo`, overlap query added to `PullsRepository` (owning-module read surface); D8 summary template + rank ordering; D9 prior PRs on a separate `/history` route (keeps both responses contract-valid), local-first over `pr_files`, `merged_at` from `updated_at ?? opened_at` (no column), cap 5, `notes` derived; D10 UI tree/graph hand-rolled (no chart dependency), collapse state local per symbol.
  - `server/README.md` (edit: API map — add `blast` node with `/pulls/:id/blast · /pulls/:id/history`).
  - `client/README.md` (edit: PR-detail row's API list gains both GETs).
- **Interfaces** — none.
- **Skills** — none (docs row).
- **Constraints** — AGENTS.md / `docs/architecture.md` need NO change (blast is a server-internal module, not a package; repo-intel itself is only linked).
- **Verify** — `cd server && pnpm typecheck`.

## Out of scope
- LLM summarization of the map or history — the feature is data-only by design (P2).
- Any repo-intel facade change (incl. a SQL self-caller guard) — blast filters defensively; facade edits belong to the repo-intel owner.
- New tables/migrations — files and PRs are already persisted.
- e2e browser flows — component tests cover the new blocks; flows default to none.
- Prior PRs in the MCP tool output — bound in Task 9 (blast-map parity only).
- GitHub-backed history (searching closed PRs via the adapter) — unnecessary while `pr_files` is local; revisit only if PR retention shrinks.

## Verification (end-to-end)
Implementer runs (hermetic):
```sh
cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm depcruise
diff -r server/src/vendor/shared client/src/vendor/shared   # repo root — must be empty
cd client && pnpm typecheck && pnpm test
cd mcp && npm run typecheck && npm test
```
Docker lane (history SQL): `cd server && pnpm exec vitest run .it.test` — self-skips when Docker is absent.
User-run demo (NOT executed by the implementer; needs `./scripts/dev.sh`):
1. Open a seeded PR changing a shared helper → Blast radius block: ≥ 2 real callers, ≥ 1 endpoint chip, summary counts (P1).
2. Click a caller `file:line` → opens exactly that line pinned at head sha (P1).
3. Collapse a symbol (header click) → callers hide, count stays; toggle to graph → layered SVG with aria-label; back to tree (P3).
4. Degraded/partial badge + Resync button: set a repo partial (or stop the index job) → badge with reason; click Resync → job enqueues, map refreshes after indexing (P3).
5. Prior PRs: seeded experiment PRs are `needs_review` with disjoint files, so first make one qualify — `psql -c "update pull_requests set status='merged' where number=483"` after importing/seeding PRs sharing a path (or import a real repo) → `PrHistoryCard` lists it with the shared file; unrelated PR shows the honest empty state (P3).
6. `curl -s localhost:3001/pulls/<pr-uuid>/blast | jq` — payload matches the UI map, `summary`, `degraded` absent-or-reasoned; `curl -s localhost:3001/pulls/<pr-uuid>/history | jq` → `{history:[…]}`; API logs show both "served from" lines and no clone-parse activity (P2).
7. MCP Inspector (`cd mcp && npm run inspect`) → `get-blast-radius` `{repo: "acme/payments-api", pr_number: 482}` — same map; unknown PR → isError listing candidates (P1/P2).

Criterion → check matrix:
| Criterion | Check |
|---|---|
| P1 block + summary counts | Task 6 (a); demo 1 |
| P1 per-symbol callers + endpoints | Task 6 (a); demo 1 |
| P1 ≥2 callers / ≥1 endpoint on shared-helper PR | demo 1 |
| P1 links open exact line | Task 6 (a) href; demo 2 |
| P1 no-caller / empty text | Task 6 (g) |
| P1 degraded badge w/ reason | Task 6 (e); Task 3 (b)–(d) |
| P1 MCP parity + readOnlyHint | Task 9 tests; demo 7 |
| P2 single facade call, no re-parse | Task 3 service test; demo 6 logs |
| P2 response validates vs contract | `response:{200: BlastRadius}` + Task 3 `safeParse` |
| P2 flat→grouped unit test | Task 3 (a) |
| P2 no LLM | no llm import anywhere in blast (grep) |
| P2 no self-caller | Task 3 (a) fixture |
| P2 limits not hardcoded | Task 2 constraint |
| P2 degraded+reason reach UI | Task 1 + Task 6 (e) |
| P2 MCP lab rules | Task 9 |
| P3 rank sort | Task 2 step 3 + Task 3 (a) ordering assert |
| P3 resync button | Task 5 + Task 6 (e); demo 4 |
| P3 collapsible tree | Task 5 + Task 6 (b); demo 3 |
| P3 tree/graph toggle + graph.empty + ariaLabel | Task 5 + Task 6 (c)(d); demo 3 |
| P3 prior PRs block (overlap, cap, empty state) | Task 7 tests (+ it-test) + Task 8 test; demo 5 |

## Advised reviews
Architecture review advisable (new module + two routes + owning-module repository extension + vendored contract change): probe (1) sibling-module imports (depcruise error), (2) DB access outside `container.pullsRepo` / tables blast doesn't own, (3) vendor-copy drift, (4) the overlap query's status/number predicates and `.limit(200)` guard. Security review light-touch (two new GET routes, no auth surface beyond `getContext`): probe that `getPull(workspaceId, …)` precedes every query so a foreign PR 404s identically on both routes. Run `plan-verifier` over the implemented result before PR. `pr-self-review` remains the main agent's pre-PR gate (not planned here).
