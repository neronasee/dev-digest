# Improvement plan — 2026-09-19

> Source: full-project audit through the repo's own skills —
> `onion-architecture`, `frontend-architecture`, `react-best-practices`,
> `next-best-practices`, `fastify-best-practices`, `drizzle-orm-patterns`,
> `postgresql-table-design`, `zod`, `typescript-expert`, `security`,
> `react-testing-library` — plus `CLAUDE.md`, `TESTING.md`, and each module's
> `INSIGHTS.md`. 64 verified findings (every one read in code, file:line
> cited), organized into 4 parallelizable tracks.
>
> **Status: Wave 0 ✅ landed 2026-09-19** (all tracks; see the wave board).
> **Live ratchet:** depcruise **0 errors / 14 warnings** — was 125 modules / 375
> deps, now **145 / 454** after R5 made npm edges visible to the rules (same
> 14-warning baseline) → target per wave below.

## 0. How to use this plan

Pick a wave → pick an item in your track → check **Parallel / depends** and
the [conflict map](#2-conflict--ordering-map) before branching.
**One item = one PR** (Conventional Commits, scope in parens when helpful).

House rules (non-negotiable, restated from `CLAUDE.md`):

- Standalone packages — no monorepo/workspace tooling, ever.
- Applied migrations (`server/src/db/migrations/`) and lockfiles are
  untouchable. Schema fixes = **new** migration via `pnpm db:generate`.
- Test lanes stay split by filename: `*.it.test.ts` = DB-backed, rest hermetic.
- The repository-class seam + container getters **are** the house pattern.
  Every item below converges on it — none proposes a "stricter" onion.
- Dependency changes go through the package manager only
  (`pnpm install` / `npm install`). This plan adds exactly two dependencies:
  `@testing-library/user-event` (F19, client devDep) and none in server /
  reviewer-core / e2e.

Verification lanes used in the tables below (full matrix in §7):
**BE-lane** = `cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts'` ·
**BE-db-lane** = `pnpm exec vitest run *.it.test` (needs Docker) ·
**FE-lane** = `cd client && pnpm typecheck && pnpm test` ·
**CORE-lane** = `cd reviewer-core && npm run typecheck && npm test` ·
**depcruise** = `cd server && pnpm depcruise:all` · **e2e** = `./scripts/e2e.sh && (cd e2e && npm test)`.

## 1. Wave board

Waves are ordered by risk and dependency, not severity: restore the safety
net and the ratchet first, restructure second (while the net is green),
harden contracts/tenancy third once module shapes are final.

| Wave | Goal | Items | Tracks | Est. (ideal eng-days) | Status |
|---|---|---|---|---|---|
| **0 — Safety net & ratchet** | Stop active correctness bugs, lock the vendor contract, make regressions mechanically detectable — before any file moves. Unlimited parallelism (all items disjoint). | X1, X3, X4, X8, X9, X10 · B4+B19+B21 (one migration batch), B8+B17 (one PR), B6, B9, B18, B22 · F2 (codemod first!), F7, F8, F9, F10, F14, F17, F18 · R5, R8, R9, R10, R11 | X, BE, FE, CORE | ~9–11 | ✅ 2026-09-19 |
| **1 — Structural burn-down** | Execute the repo's own depcruise ratchet (`enforcement.md`) + the FE equivalents. Parallel by package; sequenced within BE. | BE-A: **B1 cluster** (B1+B2+B10a+B11+B24) → B15 → **B3**; BE-B (2nd engineer): B5+B10b; B13 · FE-A: F3 → F15; FE-B: F4 → F5 → F11 → F12 → F13 · CORE: R6, R7, R12 · e2e: X6 → X5, X7 | BE, FE, CORE, e2e | ~18–22 | ☐ |
| **Wave-1 ratchet event** | Promote `db-confined-to-repositories` and `no-cross-module-internals` to **error** in `server/.dependency-cruiser.cjs`; update the baseline in `onion-architecture/enforcement.md`. **14 → 4 warnings** (only the 4 container-root circulars remain — accepted per §9). | — | BE | 0.5 | ☐ |
| **2 — Contracts, tenancy, test depth** | Harden surfaces now that shapes are stable: response serialization, workspace scoping, and the test infra deferred past the structural churn. Wave gate: full e2e regression. | B7 (final sweep), B12, B14+B23 (one PR), B16, B20 · F19 → F20+X2 (merged) → F21 → F22 | BE, FE | ~8–12 | ☐ |
| 3 — *Optional polish* (not committed — see §9) | Container-cycle policy, segment error boundary, cosmetic alignment. | F16, F6, X11, segment-level `error.tsx` under `pulls/[number]/`, F2 ESLint tooling | — | ~4–6 | ☐ |

**Committed scope (Waves 0–2): ~38–44 ideal engineer-days** — solo part-time
~2–3 months; two parallel streams (one FE, one BE) ~5–6 weeks.

### Why this wave order

- **Wave 0 first**: every item is file-local or additive (new files, one new
  migration, config). X1 removes the loudest live bug (client rejects payloads
  the server emits) and its CI gate makes all later contract work (R12, B7)
  mechanically safe. The B4 index batch de-risks everything DB-heavy that
  follows. F2 (31-file codemod) goes first in FE so F3/F15 don't rebase
  against it daily.
- **Wave 1 before Wave 2**: B7-as-a-sweep and the F19/F20 test work would
  double-touch every file Wave 1 rewrites; B12 needs B3's widened repo
  helpers.
- **Wave 2 last**: response schemas, tenancy scoping, and interaction tests
  should pin the *final* shapes, not intermediate ones.

## 2. Conflict & ordering map

Files/areas shared by multiple items — the reason tracks can't just be run
in arbitrary order. "Single owner" means one person/agent at a time.

| Shared file / area | Items | Resolution |
|---|---|---|
| `server/src/modules/pulls/routes.ts` (+ new service/repository) | B1, B2, B10a, B11, B24, B3-site, B7-pulls | Single owner: **B1 cluster first**, then B3 wraps, B7 declared during the rewrite |
| `server/src/db/schema/*` + `src/db/migrations/meta/*` | B4, B19, B21 | **One migration batch, one engineer** — parallel `pnpm db:generate` guarantees journal conflicts |
| `server/src/app.ts` | B8, B17 | One PR |
| `server/src/modules/reviews/*` | B2 (read surface), B3, B12, B20 | One "reviews pass": B2 → B3 → B12 → B20 (B6 lands in Wave 0, before the pass starts) |
| `server/src/modules/agents/*` | B14, B23 (same file `helpers.ts`); B3, B20 (`repository.ts`) | B14+B23 one PR; B3 before B20 |
| `server/src/platform/container.ts` | B1, B2, B3, B5 | Append-only getters; serialize **B1 → B5 → B3** |
| `server/.dependency-cruiser.cjs` + `onion-architecture/enforcement.md` | R5, B13, rule promotions | Same owner; baseline counts updated atomically with any rule change |
| `client/src/app/repos/[repoId]/pulls/[number]/page.tsx` | F2, F3, F15, (F14 segment = Wave 3) | Strict order **F2 → F3 → F15** |
| `client/src/app/repos/[repoId]/pulls/page.tsx` | F2, F10, F15 | **F2 → F10 → F15** |
| `RunHistory/` + `FindingsTab.tsx` files | F4, F5, F11, F12, F13 | **F4 → F5 → (F11, F12, F13)** |
| `client/src/lib/hooks/reviews.ts` | X2, F20 | Merged into one FE unit (F20+X2) |
| `client/package.json` + lockfile | F19 (only) | Via `pnpm install` only |
| Vendor dirs (`server/src/vendor/shared` ↔ `client/src/vendor/shared`) | X1, R12 | **X1 first** (pure byte-identical sync), R12 in the next wave |
| `scripts/e2e.sh` | X3, X8 | One scripts pass |
| `e2e/run.ts` + `lib/assert.ts` | X6, X5 | X6 before/with X5 (new spec born validated) |

**Zero-conflict parallel sets**: anything in `reviewer-core/src`, `e2e/`,
`scripts/`, `docs/` never conflicts with FE/BE feature work. Within Wave 0,
all items are mutually disjoint by design.

## 3. Track BE — server/ (24 items)

Audit context: depcruise baseline exactly as documented and CI-wired; container
is the sole wiring point; secrets never enter `AppConfig`; zod type provider
global; helmet / single-origin CORS / rate limits / bodyLimit / graceful
shutdown all present; the only raw SQL is parameterized; clean modules follow
the house pattern; test-lane split fully compliant; typecheck clean.

| ID | Sev | Eff | Wave | Finding → Fix | Verify | Parallel / depends |
|---|---|---|---|---|---|---|
| B1 | high | L | 1 | `pulls/routes.ts` runs ~20 drizzle queries across 6 tables directly in routes — largest `db-confined` warn site → extract `PullsService` + `pulls/repository.ts` mirroring the `repos` module shape (routes → service → repository). [Details](#b1--pulls-module-restructure-absorbs-b2-b10a-b11-b24) | BE-lane + BE-db-lane + depcruise (db-confined −1 file) | Single owner of `pulls/routes.ts`; parallel with B5, all FE/CORE/e2e; **B2/B10a/B11/B24/B3/B7-pulls fold into it** |
| B2 | high | M | 1 | `pulls/routes.ts:127-225` reads `t.reviews`/`t.agentRuns`/`t.findings` — another feature's domain tables (the onion skill's named anti-example) → extend `ReviewRepository` read surface (latest score, latest-round cost/findings per PR set); consume via `container.reviewRepo` | BE-lane + BE-db-lane | Folded into B1 |
| B3 | high | L | 1 | **Zero `db.transaction` in server/src** — multi-step writes run as independent statements (`run.repo.ts:83-90`, `agents/repository.ts:104,144,229-235`, `pulls/routes.ts:297-331`, `run-executor.ts:219-235`, `repo-intel/repository.ts:351-384` — half-populated index risk) → wrap each unit in `db.transaction`. [Details](#b3--transactions-on-multi-step-writes) | BE-lane + BE-db-lane + new tx-atomicity tests | After B1+B2 (touch same files); also touches agents/reviews/repo-intel repos — nothing else moves those |
| B4 | high | M | 0 | **Missing indexes on hottest paths**: `reviews` has none at all (queried `pr_id`+`created_at desc`, mutated by `run_id`); `findings.review_id`, `agent_runs` (`pr_id`+`status`, `workspace_id`+`pr_id`, `status='running'`), `pr_files.pr_id`, `pr_commits.pr_id` all unindexed → add `index()` declarations, ONE new `pnpm db:generate` migration, prove with EXPLAIN in a new `.it.test.ts` | BE-db-lane + EXPLAIN assertions | **Part of the single migration batch with B19+B21**; conflicts with nothing else (routes never edit schema) |
| B5 | med | M | 1 | Remaining `db-confined` sites: `polling/routes.ts:22-63`, `workspace/routes.ts:18-21`, `settings/routes.ts:30-65`, `settings/feature-models.ts:41-44` → small `repository.ts` per module (get/upsert, list), route through service; declare B7 `response:` schemas while there | BE-lane + depcruise (db-confined −4 files) | Disjoint modules from B1 — safe for a 2nd BE engineer; serialize `container.ts` edits B1 → B5 |
| B6 | med | S | 0 | `reviews/routes.ts:32` hand-rolls `RunRequest.parse(req.body ?? {})` in the handler — explicit house-rule violation → declare `schema: { params: IdParams, body: RunRequest }`, tolerate absent body (**`z.preprocess((v) => v ?? {}, RunRequest)` — NOT `.default({})`: Fastify 5 validates an absent body as `null`, and zod defaults only fire on `undefined`**), delete the manual parse | BE-lane | Independent; lands before the Wave-2 reviews pass |
| B7 | med | M | 1→2 | **No route declares `schema.response`** — `serializerCompiler` (`app.ts:65`) is dead config; accidental field leaks possible → declare `response:` per route from existing `@devdigest/shared` contracts. Pulls during B1, polling/workspace/settings during B5, agents/repos/repo-intel sweep in Wave 2 | BE-lane (serializer now live — extra fields fail tests) | Rider on B1/B5; final sweep mechanical, one route at a time |
| B8 | med | S | 0 | `app.ts:159-163` leaks raw `e.message` (e.g. Postgres errors) to clients on non-AppError failures → generic `Internal error` for status ≥500/unknown; detail stays in `app.log.error` | BE-lane | One PR with B17 (same file) |
| B9 | med | S | 0 | `platform/sse.ts:76-88` — `complete()` never evicts `buffers`/`seq`/`completed`; every run's full event buffer lives for the process lifetime → on `complete()`, schedule unref'd `setTimeout` (5–15 min) deleting entries; cancel if runId reused | BE-lane | Independent |
| B10 | med | S | 1 | Per-row upsert loops: `pulls/routes.ts:52-80` (B10a → folded into B1), `polling/routes.ts:31-59` + `settings/routes.ts:52-60` (B10b → folded into B5) → single multi-row `insert(...).values(rows).onConflictDoUpdate(...)` with `sql`excluded`` | BE-lane | Folded into B1 / B5 |
| B11 | med | M | 1 | `GET /repos/:id/pulls` performs a full GitHub sync + up to 10 **sequential** `getPullRequest` fetches + per-row updates — side-effectful read path, external N+1 → move sync/stat backfill into the `polling` job (or opportunistic background enqueue); GET becomes a pure read | BE-lane + BE-db-lane | Folded into B1 |
| B12 | med | M | 2 | Unscoped tenancy: `cancelRun`/`getRunTrace` filter by run id only (`reviews/routes.ts:114-126`, `run.repo.ts:94-101,204-207`); repo-intel routes act on any `repoId` (`repo-intel/routes.ts:32-65`). Latent today (LocalNoAuthProvider) but the seam must hold before a real AuthProvider → thread `workspaceId` through; verify repo ownership via scoped `repos` lookup | BE-db-lane | After B3 (uses widened helpers); rides the reviews pass |
| B13 | low | S | 1 | `repos/service.ts:11-14` imports repo-intel job-kind constants — the one `no-cross-module-internals` edge → hoist constants to `modules/_shared/` | depcruise (cross-module edge → 0) | **Gates the Wave-1 ratchet promotion**; same owner as depcruise config changes |
| B14 | low | S | 2 | Genuine import cycle `agents/helpers.ts:3` ↔ `agents/repository.ts:6` → import `AgentRow`/`AgentVersionRow` from `db/rows.ts` in helpers (already exported) — one line | depcruise (circulars 5 → 4) | One PR with B23 (same file) |
| B15 | low | S | 1 | `run-executor.ts:5`, `diff-loader.ts:4`, `repos/helpers.ts:2` import `db/schema.js` just for row types → export `RepoRow` etc. from `db/rows.ts` (its doc-comment says it exists for this) | depcruise (db-confined −3 files) | **Lands just before B3** (B3's tx-widening imports from `db/rows.ts`) |
| B16 | low | S | 2 | 4 files open with bare imports, missing the layer-contract doc-comment (`review.repo.ts`, `pull.repo.ts`, `repos/repository.ts`, `agents/service.ts`) → one-line headers | BE-lane (comment-only) | Independent |
| B17 | low | S | 0 | No pino `redact` paths (`app.ts:50-59`) → `redact: { paths: ['req.headers.authorization', '*.token', '*.apiKey', '*.secret'], censor: '[REDACTED]' }` | BE-lane | One PR with B8 |
| B18 | low | S | 0 | Shutdown has no drain window (`server.ts:12-26`) — long reviews/SSE get one close pass → close-with-grace inline: `setTimeout(() => process.exit(1), 10_000).unref()` around `app.close()`; no new dependency | BE-lane | Independent |
| B19 | low | S | 0 | `settings` unique index `(workspace_id, user_id, key)` with nullable `user_id` — Postgres UNIQUE allows multiple NULLs, so `onConflictDoUpdate` silently never fires for NULL-`user_id` rows (`db/schema/core.ts:41,46`) → **dedup existing `(workspace_id, NULL, key)` duplicates first (keep latest — `CREATE UNIQUE INDEX` fails on pre-existing dupes)**, then a `unique()` **constraint** with `.nullsNotDistinct()` — drizzle-orm 0.38.4 / drizzle-kit 0.30.6 expose `.nullsNotDistinct()` only on constraints, not `uniqueIndex()` (Postgres backs the constraint with a unique index either way; upsert arbiter identical) | BE-db-lane | **Migration batch with B4+B21** |
| B20 | low | S | 2 | `reviewsForPull` awaits `agents.getById` per agent — bounded N+1 (`reviews/service.ts:169-174`) → one `inArray` fetch (extend `AgentsRepository` with `namesByIds`) | BE-lane | After B3; rides the reviews pass |
| B21 | low | S | 0 | `agent_runs.status` is nullable plain text while every writer assumes `running\|done\|failed\|cancelled` (`db/schema/runs.ts:30`; compare `jobs.status` done right in `ops.ts:15-19`) → `text(...,{enum:[...]}).notNull().default('running')` via new migration, backfill NULLs first | BE-db-lane | **Migration batch with B4+B19** |
| B22 | low | S | 0 | Secrets file `JSON.parse` output only shallow-checked — object-ness verified but values not (`adapters/secrets/local.ts:28-29`) → `z.record(z.string()).safeParse` + fallback `{}` | BE-lane | Independent |
| B23 | low | S | 2 | `AgentVersionConfig.parse` throws a raw ZodError inside a GET DTO mapper (`agents/helpers.ts:39`) → misleading 422 "Request validation failed" for corrupt stored data → `safeParse` → `AppError('invalid_agent_version', …, 500)` | BE-lane | One PR with B14 |
| B24 | low | S | 1 | PR-list rollup logic — source of two past INSIGHTS bugs (2026-09-16/17) — is inline in the route, reachable only by DB-backed tests → after B1 extracts it, add hermetic tests with row fixtures (null `multi_run_id`, newest-first partial sums, failed-round exclusion) | BE-lane (new unit tests, no DB) | Folded into B1 |

### B1 — Pulls module restructure (absorbs B2, B10a, B11, B24)

The audit's single biggest item. Everything lives in
`server/src/modules/pulls/routes.ts` (~440 lines): the ~20-query list rollup,
cross-feature table reads, the per-row upsert loop, the side-effectful GET,
and the delete+insert+update sequence that is also a B3 transaction site.

**Steps** (burn-down order per `enforcement.md`):

1. Extract `pulls/repository.ts` — the only file touching
   `pull_requests`/`pr_files`/`pr_commits`; workspace-scoped via `getContext`.
   Declare B7 `response:` schemas for the routes while they thin out.
2. Extract `PullsService` (orchestration), mirroring `repos/service.ts`.
3. For the review/run/findings reads (B2): extend `ReviewRepository` with the
   read surface (latest-review score, latest-round cost/findings per PR set)
   and consume it via `container.reviewRepo` — never query those tables here.
4. Move the GitHub sync + stat backfill off the read path (B11) into the
   `polling` job or an opportunistic background enqueue.
5. Batch the upserts (B10a) into one multi-row `onConflictDoUpdate`.
6. Add B24's hermetic rollup tests with row fixtures.
7. Add the `pulls` getter wiring in `platform/container.ts` (append-only).

**Done when**: `pulls/routes.ts` is transport-only; depcruise
`db-confined-to-repositories` count drops by 1 file; the rollup has hermetic
tests; `GET /repos/:id/pulls` is a pure read.

**Parallel-safe with**: B5 (disjoint modules), all FE/CORE/e2e work.
**Serialized with**: B3 (after), `container.ts` edits (B1 → B5 → B3).

### B3 — Transactions on multi-step writes

Five write units currently run as independent statements; a mid-unit failure
leaves partial rows (worst case: a half-populated repo-intel index whose
`repo_index_state` claims `full`).

**Steps**:

1. B15 first: move row-type imports to `db/rows.ts` so nothing imports
   `db/schema` just for types.
2. Widen the `.repo.ts` helper signatures to accept `Db | PgTransaction<…>`
   and pass `tx` through the `ReviewRepository` facade methods.
3. Wrap each unit in `db.transaction`: review deletion cascade, agent
   create/update + version snapshot, `setSkills` delete-then-insert, PR
   files/commits replace, review + findings + markReviewed, repo-intel
   `replace*` batches.

**Done when**: every multi-step write is atomic; new tx-atomicity tests force
a failure mid-unit (constraint-violating final insert) and assert zero
partial rows.

### B4+B19+B21 — one schema-hardening migration batch

All three change `server/src/db/schema/*`; each `pnpm db:generate` rewrites
`migrations/meta/_journal.json` + snapshots, so these MUST be one engineer,
one batch (sequential generations into one or tightly ordered migrations).
B21's NULL backfill and B19's duplicate purge (keep the latest row per
`(workspace_id, NULL, key)` — `CREATE UNIQUE INDEX` fails on pre-existing
dupes) are the only data-migration steps; both are hand-added to the generated
SQL before the constraint/DDL they protect. Verify with a new
`.it.test.ts` running `EXPLAIN` on the hot queries
(`reviews by pr_id+created_at desc`, `agent_runs by status='running'`, …)
asserting index scans — the migration is proven, not just generated.

## 4. Track FE — client/ (21 items; X2 implemented here)

Audit context: route colocation exemplary (`_components/<Name>/` + barrels);
clean import boundaries; no junk drawers; one typed `api.ts` with `ApiError`
normalization; effects/listeners cleaned up; vendored UI kit reused (no
parallel primitives); behavior-driven tests with role queries; typecheck
clean.

| ID | Sev | Eff | Wave | Finding → Fix | Verify | Parallel / depends |
|---|---|---|---|---|---|---|
| F14 | high | S–M | 0 | **Zero `error.tsx`/`global-error.tsx` anywhere** — any render error (mermaid, recharts, markdown, a bad optional chain) takes the whole route to Next's default page with no recovery → add `app/error.tsx` + `app/global-error.tsx` (client components, Try-again/`reset`) | FE-lane + a test rendering a throwing child asserting fallback + reset | New files only — no conflicts; segment-level boundary under `pulls/[number]/` is Wave 3 |
| F2 | med | S | 0 | ~60 deep relative imports (3+ `../`) across 31 files (landed: 49 specifiers across 25 files rewritten; the 11 `messages/en/*.json` imports stay relative — they resolve outside `src/`, unreachable by `@/*`) though `@/*` is configured (worst: `pulls/[number]/page.tsx:11-23`; 7-level `vi.mock` paths) → mechanical codemod to `@/lib/…`, `@/components/…` | FE-lane (typecheck proves the alias resolves) | **First FE item** — every later FE change rebases against it otherwise. The ESLint `no-restricted-imports` half is Wave 3 (client has no ESLint installed today — new tooling + lockfile) |
| F3 | med | M–L | 1 | `pulls/[number]/page.tsx` (188 lines) is not a thin page: id resolution (number→uuid via full list fetch), live-run orchestration, invalidation wiring, tab routing; `useMemo` dep mismatch at :72-75 (`[reviews]` vs `runs`) → extract `PrDetailView` into `_components/` (mirror `AgentsListView`); page becomes a shell; fix the dep mismatch | FE-lane | Strict order F2 → **F3** → F15 (same file) |
| F4 | med | S | 1 | `RunHistory/` has no `index.ts` barrel → deep import `'../RunHistory/RunHistory'` in `FindingsTab.tsx:6` → add barrel, import from `'../RunHistory'` | FE-lane | First of the RunHistory cluster |
| F5 | med | M | 1 | `RunHistory.tsx` (230 lines) mixes timeline merge, two inline row renderers, module-level styles — siblings all ship colocated `styles.ts`/`helpers.ts` → extract `RunRow/`, `CommitRow/`; `outcomeOf`/`tsOf` → `helpers.ts`; styles → `styles.ts` | FE-lane | After F4; before F11/F12/F13 |
| F8 | med | S | 0 | ConfigTab stores 9 props-derived states + a reset `useEffect` with `eslint-disable react-hooks/exhaustive-deps` (`ConfigTab.tsx:18-39`) — "derive, don't store" violation → remount on agent switch: `<ConfigTab key={agent.id} …>` in `AgentEditor.tsx:23`, delete the effect | FE-lane | Independent |
| F9 | med | S | 0 | Index key on a mutable list (`DiffViewer.tsx:28` `key={i}`) — a refetch after new commits reshuffles files and bleeds row state → `key={f.path}` | FE-lane | Independent, one line |
| F15 | med | M–L | 1 | Page-level `'use client'` on 5 routes blocks `metadata` (root, onboarding, pulls list, pulls detail, agents/[id]) → mirror the `agents/page.tsx` thin-server-page shape (params/searchParams handling moves into the view); enables per-route titles via `title.template` | FE-lane + `pnpm build` (Next validates the RSC boundary at build time) | After F3 (same files); [details](#f15--thin-server-pages--metadata) |
| F19 | med | M | 2 | `fireEvent` everywhere (16 call sites / 4 files); `@testing-library/user-event` not installed → add the devDep (`pnpm install` — the only FE lockfile touch), convert click/hover/keyboard (synthetic `fireEvent.scroll` may remain) | FE-lane | After structure settles (tests move with F3/F5) |
| F20 | med | M | 2 | The "fetch mocked" convention has **no implementation** — no stub/MSW anywhere; a missed mock hits `localhost:3001` for real; `useRunEvents` SSE accumulation untested → default fetch stub in `src/test/setup.ts` that fails tests hitting real URLs + `renderHook` test for `useRunEvents` with a fake `EventSource`; **merge with X2** (same file) | FE-lane + new hook test | After F19; [details](#f20x2--fetch-stub--sse-validation-merged-unit) |
| F10 | low | S | 0 | Filter/sort state split URL vs `useState`, contradicting the file's own comment (`pulls/page.tsx:2` vs :46-47) → move `sort` (± `q`) into `searchParams` like `status` | FE-lane | After F2, before F15 (same file) |
| F11 | low | S–M | 1 | Nonce-driven effect chain timeline→accordion scroll (`FindingsTab.tsx:70-73` → `ReviewRunAccordion.tsx:47-53`) → the accordion already renders `id="review-run-<runId>"`; scroll directly via `document.getElementById(...)?.scrollIntoView()` on click, delete the nonce prop through both components | FE-lane | After F5 |
| F12 | low | S | 1 | Pass-through `useCallback` wrappers (`FindingsTab.tsx:45-65`, `PrDetailHeader.tsx:31-37`) → pass props directly | FE-lane | After F5 |
| F13 | low | S | 1 | Non-focusable delete control (`RunHistory.tsx:215-223` `<span role="button">` without tabIndex/keyboard) → use the vendored `IconBtn` (as `AddRepoView.tsx:74` does) | FE-lane | After F5 |
| F16 | low | opt | 3 | Root route redirects via client fetch + effect (`page.tsx:13-19`) → server-fetch + `redirect()` would fix it but conflicts with the TanStack-only data convention | — | **Decision log: skip** |
| F17 | low | S | 0 | Inter webfont never actually loaded (`globals.css:7-12` — `src: local("Inter")` only resolves if the user has it installed) → `next/font` (`google` or `local`) exposed as a CSS variable | FE-lane | Independent |
| F18 | low | S | 0 | No `not-found.tsx` anywhere → add root `not-found.tsx` wrapped in the app shell | FE-lane | Independent |
| F21 | low | S | 2 | `vi.mock` with 5–7-level relative paths (the alias resolves in vitest config) → use `@/lib/hooks/…` in mocks | FE-lane | Ride with F19 |
| F22 | low | M | 2 | Render-only smokes for interaction-critical components (`RunReviewDropdown`, `AgentEditor`, `VerdictBanner`) → add "open dropdown → choose agent → mutate called" flow tests | FE-lane | After F20 |
| F6 | low | opt | 3 | Shared-component folder shape inconsistent (flat files vs `<Name>/` subfolder+barrel in `src/components/`) | — | **Decision log: skip** (low value, many moves) |
| F7 | low | S | 0 | `src/components/showcase` is test-only code in the shared layer with a stale header comment (`Showcase.tsx:2` claims a `/showcase` route that doesn't exist) → relocate under `src/test/`, fix the comment | FE-lane | Independent |

### F15 — Thin server pages + metadata

Five routes carry page-level `'use client'`, so none can export `metadata`
and only the root layout title exists. Mirror the existing `agents/page.tsx`
shape: a thin server page exporting `metadata` + rendering the view component;
params/`searchParams` handling moves into the view. Order strictly after F3
(same files). **Proof**: `pnpm build` — Next validates the server/client
boundary at build time; a stale `'use client'` fails the build, not production.

### F20+X2 — Fetch stub + SSE validation (merged unit)

Both live in `client/src/lib/hooks/reviews.ts` and fix the same class of gap:
- X2: `reviews.ts:184` does `JSON.parse(ev.data) as RunEvent` although a zod
  `RunEvent` schema exists in the vendored `trace.ts` (imported as type-only).
  → `RunEvent.safeParse(...)`, skip non-matching frames.
- F20: add the default fetch stub in `src/test/setup.ts` (throws on real
  URLs — makes the "fetch mocked" convention enforceable instead of
  aspirational) and one `renderHook` test for `useRunEvents` with a fake
  `EventSource` asserting accumulation + malformed-frame skipping — which is
  X2's regression test.

## 5. Track CORE — reviewer-core/ (8 items)

Audit context: typecheck clean; 23/23 hermetic tests pass in <1 s with a
stubbed `LLMProvider`; zero `node:` imports; zero `any`/`ts-ignore` across
all four packages; `core-is-pure` gates in CI.

| ID | Sev | Eff | Wave | Finding → Fix | Verify | Parallel / depends |
|---|---|---|---|---|---|---|
| R5 | high | S | 0 | `core-is-pure` blind spot: the rule bans `^node:fs` but not `^openai` or `node:child_process\|net\|http\|os\|process`; `llm/openrouter.ts:1,124` (openai SDK + raw `fetch`) is a real network-I/O exception **absent from the ledger** in `enforcement.md` → **landed with corrections**: the old patterns were partially vacuous (`exclude: node_modules` hid npm edges entirely; builtins render without the `node:` prefix, so `^node:fs` never fired; npm deps resolve as `…/node_modules/<pkg>/…`). Fix: keep node_modules in the graph (doNotFollow only), ban `(node:)?fs` + `(node:)?(child_process\|net\|http\|os\|process)` + `openai` in both path shapes, and ledger **two** exceptions — `openrouter.ts` AND `structured.ts` (imports `openai/helpers/zod`, a pure zod→JSON-Schema converter). Module/deps counts become 145/454 with the same 14 warnings | `cd server && pnpm depcruise:all` (still 0 errors; the exception is now enforced, not invisible) | Same owner as B13/depcruise config; strengthens the gate, never weakens |
| R6 | med | S | 1 | Map-reduce golden path untested (`src/review/run.ts:115-121`): no test forces chunking, multi-chunk cost accumulation, or sessionId-per-chunk → run.test.ts case: 2-file diff, `mapThresholdLines: 0`, counting stub asserting ≥2 `completeStructured` calls + merged result | CORE-lane | Independent |
| R7 | med | M | 1 | Grounding/structured edge branches untested: `FULL_FILE_KINDS` exemption (`grounding.ts:16`), `buildLineIndex` `newLineNumbers`-absent fallback (`:31-34`), `extractJson` fence/brace edges (`llm/structured.ts:25-48`), `parseWithRepair` reprompt payloads, score clamping → new `test/grounding.test.ts` + `test/structured.test.ts` | CORE-lane | Independent |
| R8 | low | S | 0 | `sliceDiff` fallback can synthesize a `diff --git` header with **no hunks** → silent empty review chunk (`review/reduce.ts:69-71`) → reconstruct from `f.hunks` in the fallback (or throw) | CORE-lane | Independent |
| R9 | low | S | 0 | Final OpenRouter failure discards the zod reprompt detail (`llm/openrouter.ts:115` vs `structured.ts:76-83`) → carry the last `parsed.error` into the thrown message | CORE-lane | Independent |
| R10 | low | S | 0 | `--passWithNoTests` in reviewer-core's test script — a broken include glob would pass CI green → drop the flag | CORE-lane (empty suite now fails) | Independent |
| R11 | low | S | 0 | PR-description truncation at 4000 chars has no marker (`prompt.ts:100-102`) — the model can't tell cut-off untrusted input from complete → append an explicit `[truncated]` marker inside the wrapped block | CORE-lane | Independent |
| R12 | low | M | 1 | `UnifiedDiff` is a plain interface, never runtime-validated (`vendor/shared/adapters.ts:185-188`); malformed hunks silently degrade grounding → zod-ify `DiffHunk`/`UnifiedDiff` in shared; `safeParse` once at the run entry (stays pure) | CORE-lane + malformed-hunk fixture asserting the failure surfaces at entry | **After X1** (second vendor churn — safe only once the CI gate exists); touches both vendor dirs |

## 6. Track X — cross-cutting (11 items; X2 lives in FE)

Audit context: depcruise baseline matches the docs and runs in CI; tsconfigs
equally strict in server/client/reviewer-core; secrets clean (only
`.env.example` tracked, CORS single-origin); docs convention fully met; e2e
deterministic (no sleeps, `execFile`, teardown traps).

| ID | Sev | Eff | Wave | Finding → Fix | Verify | Parallel / depends |
|---|---|---|---|---|---|---|
| X1 | high | S | 0 | **Vendored shared drift, committed**: 5 of 11 contract files differ server↔client (`adapters.ts`, `contracts/{eval-ci,knowledge,productionize,trace}.ts`). Server is ahead by `StructuredRequest.sessionId`, `CommitFile(s)`, `AgentManifest`, `AgentVersionConfig`; client `PluginAgent.provider` (in `contracts/productionize.ts`) lacks `'openrouter'` — the **one runtime rejection site** (zod enum rejects the value; the other drift is type-level or comments) → **the client zod schema rejects payloads the server emits**. Re-verified via `diff -rq` (exit 1) → pure re-vendor server→client (5 files, byte-identical) + CI step `diff -rq server/src/vendor/shared client/src/vendor/shared` in **BOTH** `server-unit.yml` and `client.yml` (both are path-filtered to their own package — one gate is blind to the other side) | `diff -rq server/src/vendor/shared client/src/vendor/shared` returns empty; CI gate red on any future drift | **Gates R12 and B7 contract work — first PR of Wave 0**. Pure sync: reviewable as "no semantic change" |
| X2 | med | S | 2 | SSE frame cast in client: `lib/hooks/reviews.ts:184` `JSON.parse(ev.data) as RunEvent` though a zod `RunEvent` exists in vendored `trace.ts` → `RunEvent.safeParse`, skip non-matching frames | FE-lane + the F20 hook test | Implemented inside Track FE, merged with F20 (same file) |
| X3 | low | S | 0 | Dev Postgres published on all interfaces (`docker-compose.yml:12-13` `"5432:5432"`, `scripts/e2e.sh:91`) — LAN-exposed dev DB with known creds → bind loopback: `"127.0.0.1:5432:5432"` / `-p 127.0.0.1:${PG_PORT}:5432` | e2e (stack boots on loopback; `e2e-web.yml` exercises the compose file) | One scripts pass with X8 |
| X4 | low | S | 0 | `skills-lock.json` pins two skills that don't exist (`architecture-patterns`, `github-workflow-automation`) → prune the stale entries | `jq` lint / visual | Independent |
| X5 | med | M | 1 | No e2e flow for the `/agents/[id]` editor route — specs 01–08 cover every other route, and agent editing is a day-1 journey in the root README → add `specs/09-agent-editor.flow.json` (open `/agents`, click the seeded card, assert the config tab renders; read-only, no save — respects the no-mutation rule) | e2e | After X6 (new spec born validated) |
| X6 | med | S | 1 | Flow specs are cast, not validated: `e2e/run.ts:59` `JSON.parse(…) as Flow` — a typo'd key surfaces as a confusing mid-suite crash instead of a named spec error → small zod `FlowSchema` in `lib/assert.ts`; `safeParse` in `loadFlows` with the filename in the error | e2e (a deliberately broken spec copy fails with its filename) | Before/with X5 |
| X7 | low | S | 1 | e2e tsconfig is the least strict of the four packages (no `noUncheckedIndexedAccess`, `isolatedModules`, `moduleDetection`, `forceConsistentCasingInFileNames`) → copy the reviewer-core flag set verbatim | `cd e2e && npm run typecheck` | Independent |
| X8 | low | S | 0 | `agent-browser` CLI unpinned, though e2e INSIGHTS documents version-sensitive behavior (0.27 `wait --text` CSS-uppercased matching) — a 0.28 change could flake every locator → pin in README (`npm i -g agent-browser@0.27.x`) + `e2e.sh` echoes `agent-browser --version` | e2e | One scripts pass with X3 |
| X9 | med | S | 0 | `scripts/dev.sh` launches API/web blind — a stale server yields a deep `EADDRINUSE` inside pnpm output (README troubleshoots only 5432) → pre-check 3000/3001 with `lsof`/`ss`, fail with a message naming the stale process (e2e.sh already demonstrates the house pattern) | Run `./scripts/dev.sh` twice — second run fails fast and clear | One scripts pass with X10 |
| X10 | low | S | 0 | `dev.sh` cleanup captures only `SERVER_PID` — `next dev` grandchildren can orphan (exactly what e2e.sh's `kill_tree` solves) → capture `CLIENT_PID`, reuse the `kill_tree` pattern (hoist to a shared snippet or duplicate with attribution) | `./scripts/dev.sh` → Ctrl-C → `ss -tlnp \| grep -E '3000\|3001'` empty | One scripts pass with X9 |
| X11 | low | S | 3 | reviewer-core `specs/`+`docs/` index tables say "_none yet_" though decided, non-obvious behaviors exist (deterministic score-from-survivors, shared INJECTION_GUARD, `FULL_FILE_KINDS` grounding exemption) → backfill 2–3 numbered spec entries from README/code comments | — | Decision log: optional polish |

## 7. Verification matrix

Global invariant: **all five CI workflows stay green after every item**
(`server-unit`, `server-integration`, `reviewer-core`, `client`,
`e2e-web` — each is path-filtered, so a track's changes auto-run its own
lane plus dependent lanes).

| Track | Standing checks (per PR) | New checks this plan adds |
|---|---|---|
| BE | `cd server && pnpm typecheck` · unit lane `pnpm exec vitest run --exclude '**/*.it.test.ts'` · DB lane `pnpm exec vitest run *.it.test` (Docker; required for B3/B4/B11/B12/B19/B21) · `pnpm depcruise:all` — **0 errors always; warning count only falls** | EXPLAIN assertions for B4 (index scans proven, not assumed); tx-atomicity tests for B3 (fail mid-unit → zero partial rows); B24 hermetic rollup fixtures; optional `--output-type json` warning-count assertion (≤ committed number, lowered each wave) |
| FE | `cd client && pnpm typecheck && pnpm test` · `pnpm build` after F15 | F14: test rendering a throwing child asserts fallback + reset. F20: default fetch stub that **fails any test hitting a real URL**; `useRunEvents` renderHook test with fake `EventSource` (X2's regression test) |
| CORE | `cd reviewer-core && npm run typecheck && npm test` (R10 makes an empty suite fail again) · `cd server && pnpm depcruise:all` covers `core-is-pure` incl. R5's new paths | R6: map-reduce chunking test (≥2 `completeStructured` calls, merged result). R7: grounding/structured edge-branch pins. R12: malformed-hunk fixture asserting the error surfaces at run entry |
| X / e2e | `diff -rq server/src/vendor/shared client/src/vendor/shared` empty · `cd e2e && npm run typecheck` | X1's `diff -rq` CI step in **both** `server-unit.yml` and `client.yml`; X6's FlowSchema makes a typo'd spec a named, file-attributed error |
| Wave gate | — | After **every** wave: full `./scripts/e2e.sh && (cd e2e && npm test)` — the only suite that exercises server contracts and client rendering together, i.e. exactly where X1/B7/F15 regressions surface |

## 8. Ratchet ledger

The depcruise warning baseline is a burn-down commitment
(`.claude/skills/onion-architecture/enforcement.md`), not a permission.
Update this table in the same PR as any rule change.

| Rule | Baseline (2026-09-19) | After Wave 1 | After Wave 2 | Promoted to error? |
|---|---|---|---|---|
| `db-confined-to-repositories` | 8 files | **0** (B1, B5, B15) | 0 | ✅ at Wave-1 ratchet event |
| `no-cross-module-internals` | 1 edge | **0** (B13) | 0 | ✅ at Wave-1 ratchet event |
| `no-circular` | 5 cycles | 5 | **4** (B14 fixes `agents/helpers ↔ repository`) | Remaining 4 container-root cycles: **accepted at the composition root** (§9), stay `warn` |
| **Total warnings** | **14** | **5** | **4** (final floor) | — |

## 9. Decision log — what we deliberately do NOT do

Recorded so a future session doesn't re-litigate. Each entry: the item, the
reason, and the condition that would reopen it.

| Item | Decision | Why | Reopen when |
|---|---|---|---|
| 4 container-root circulars (`repo-intel/service\|pipeline ↔ container`) | Keep, ledger as accepted exception | Eliminating them means inverting the composition root's lazy getters — fighting the house pattern ("container getters ARE the seam"). High ripple, zero bug-risk reduction | A second consumer of repo-intel appears |
| F16 (server-side root redirect) | Skip | Conflicts with the deliberate TanStack-only data convention | The convention itself changes |
| F6 (shared-component folder-shape alignment) | Skip | Many moves, low value; both shapes are readable | A large `src/components/` reorg happens anyway |
| X11 (reviewer-core spec backfill) | Deferred to Wave 3 | Docs-only, no runtime value | Next substantive reviewer-core change (do it then) |
| Segment-level `error.tsx` under `pulls/[number]/`, F2 ESLint tooling | Optional follow-ups | Root boundary (F14) covers the acute risk; ESLint means new tooling + lockfile for one rule | Repeated review churn on those specific mistakes |
| Aggressive scope (full warning zero, metadata-everywhere extras) | Not committed | See §10 | After Waves 0–2 land, if capacity remains |

## 10. Why "Moderate" — the drastic-ness analysis

Three scopes were priced from the same findings:

| Option | Contents | Est. | What it leaves behind |
|---|---|---|---|
| A — Conservative | Wave 0 only: safety/correctness, file-local fixes, the migration batch | ~15–18 d | All 14 depcruise warnings (the burn-down this repo's own `enforcement.md` commits to), zero transactions, the side-effectful GET, thin pages, test depth. The rollup logic behind two past bugs stays inline and DB-test-only |
| **B — Moderate ✅** | A + Waves 1–2: the depcruise burn-down + targeted structural fixes (pulls restructure, error boundaries, thin pages) + test depth | **~38–44 d** | Only the container circulars (ledgered) and cosmetic items |
| C — Aggressive | B + full circular elimination, F16, F6, segment boundaries, lint tooling | ~48–55 d | Nothing — but the added ~10 days buy the riskiest work with the weakest payoff (container-cycle surgery at the composition root) |

B is committed because:

1. **It executes the repo's own plan, not a new architecture.** The
   warn → burn-down → promote ratchet is already written into
   `enforcement.md` with a named order. Stopping at A re-legitimizes the
   warning baseline the repo explicitly calls "never permission to add
   violations".
2. **The structural items map to demonstrated pain**: the pulls rollup caused
   two recorded INSIGHTS bugs; the cross-feature table reads are the onion
   skill's literal named anti-example; a render error anywhere takes down a
   whole route (F14); the client rejects payloads the server emits (X1).
3. **House-pattern convergence**: B1/B5 extend the repository-class +
   container-getter seam the clean modules already use — refactors that make
   the codebase *more* like its own stated pattern, not less.
4. **The riskiest refactors sit on the strongest safety net**: B1/B3 are
   exactly the modules with existing `*.it.test.ts` lifecycle coverage, and
   this plan adds atomicity/EXPLAIN/rollup tests before relying on them.
