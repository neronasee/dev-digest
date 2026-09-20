# server/ — INSIGHTS

Non-obvious knowledge you can't infer from the code or git history: gotchas hit
in practice, "why it's built this way", debugging dead ends.

Contract:

- Append only — never rewrite, reword, or prune existing entries.
- One dated bullet per insight, newest on top of its section:
  `- YYYY-MM-DD — one actionable sentence. (<file>:<line> or dir/PR ref)`
- If it belongs in the README, `docs/`, or a `specs/` file instead — put it there.

## What Works

<!-- newest on top -->

- 2026-09-20 — Forcing a mid-transaction failure in a test needs NO schema changes: a duplicate conflict key inside one multi-row insert (unique-violation 23505) deterministically kills any delete-then-insert unit whose target has a composite PK (file_edges/file_rank/file_facts); only where no natural constraint exists (pr_files, agent_versions, agent_runs) drop a temporary `BEFORE INSERT/DELETE … RAISE EXCEPTION` trigger around the call instead. (test/tx-atomicity.it.test.ts)
- 2026-09-20 — A fire-and-forget JobRunner enqueue must attach `.catch` to the returned `job.done` (as `enqueueSyncIfStale` does) — JobRunner rethrows handler failures out of `done` after marking the jobs row failed, so an unwatched rejected `done` is an unhandled rejection that can take the API down. (src/modules/pulls/service.ts)

## What Doesn't Work

<!-- newest on top -->

- _none yet_

## Codebase Patterns

<!-- newest on top -->

- 2026-09-20 — There is NO polling scheduler anywhere: `polling_interval_min` is a stored-but-unconsumed setting and POST /repos/:id/poll is manual — so the B11 read-path sync moved to an opportunistic `pulls-sync` JobRunner job enqueued by GET /repos/:id/pulls, gated by `repos.last_polled_at` staleness (SYNC_STALE_MS = 5 min) which the job itself bumps (markSynced), so reads self-throttle instead of enqueueing per request. (src/modules/pulls/service.ts)
- 2026-09-20 — The PR-list rollup's correctness now spans two modules: the NEWEST-FIRST ordering lives in the reviews read surface (`doneRunsForPrs` ran_at desc, `latestReviewScores` created_at desc) while the sum/pick logic lives in `pulls/helpers.ts` — dropping the ORDER BY over there silently mis-sums costs/scores over here; the hermetic fixtures in `pulls/helpers.test.ts` feed rows in query order to pin this. (src/modules/pulls/helpers.ts, src/modules/reviews/repository/)
- 2026-09-20 — EXPLAIN assertions in `.it.test.ts` assert "an index was used, no seq scan" — never a specific index or a sort-free plan: at ~2.5% selectivity the planner legitimately picks bitmap+sort, and which of two equally-selective indexes wins is a cost-model choice, not a schema property. (test/schema-hardening.it.test.ts)
- 2026-09-19 — The onion-architecture gate: `pnpm depcruise` (also a CI step in server-unit.yml) fails on error-severity rules; its 14 warnings are a tracked burn-down baseline (8 fat-route db imports, 1 cross-module edge, 5 cycles) that must shrink, never grow — severities, baseline, and the exception ledger live in `.claude/skills/onion-architecture/enforcement.md`. (.dependency-cruiser.cjs)
- 2026-09-17 — PR-list latest-round cost/findings resolve from status='done' runs ONLY — the runRows select filters `eq(t.agentRuns.status, 'done')` up front, so "successful-only" is query-enforced (not emergent from the executor nulling cost on failure) and a newer failed/cancelled round can no longer mask an older successful round's cost/findings. (src/modules/pulls/routes.ts:157)
- 2026-09-17 — The seeded review historically had `run_id` NULL and NO `agent_runs` row — any feature that resolves reviews through runs (PR-list latest-round findings, timeline severity pills) silently shows nothing in seeded/e2e environments; `seed.ts` now back-fills one `agent_runs` + `multi_agent_runs` round and links the review (idempotent, fires only while `runId` is null), so re-seeding an older dev DB repairs it too. (src/db/seed.ts:241)
- 2026-09-16 — PR-list cost is the SUM of the latest review round, keyed by `agent_runs.multi_run_id` (one `multi_agent_runs` row per "Run Review" trigger, created in `runReview`); rows with a null `multi_run_id` (pre-grouping) are their own round, and the per-PR round must be picked only AFTER all rounds are summed — rows come newest-first, so a round's rows keep arriving after its newest run was seen, and picking early yields a partial sum. (src/modules/pulls/routes.ts, src/modules/reviews/service.ts)

## Tool & Library Notes

<!-- newest on top -->

- 2026-09-20 — In drizzle-orm 0.38 (postgres-js) a `PostgresJsTransaction` is structurally ASSIGNABLE to `PostgresJsDatabase`, so repository helpers typed `db: Db` already accept a `tx` unchanged — the `DbOrTx = Db | Tx` union in `db/client.ts` is intent documentation plus a tripwire: if a drizzle bump breaks the aliasing, the union is where the compile fails first. (src/db/client.ts)
- 2026-09-20 — In a multi-row drizzle `insert(...).values(rows).onConflictDoUpdate`, a plain JS value in `set:` binds ONE value for every conflicting row (the batch's last), not per-row — per-row updates REQUIRE `sql`excluded.<column>`` references; batching the former per-row PR-sync loop without them would have written the last PR's title/sha onto every updated PR. (src/modules/pulls/repository.ts)
- 2026-09-20 — fastify-type-provider-zod's `serializerCompiler` runs `schema.safeParse(data)` on the handler's RETURN VALUE (not a JSON-Schema strip) — so declaring `response:` makes zod `.default()`s materialize in the payload (GET/PUT /settings now emit defaults for unset keys) and an invalid stored row fails serialization into a 500 `ResponseSerializationError` instead of shipping bad data. (src/modules/settings/routes.ts)
- 2026-09-20 — A multi-row `insert(...).values(rows).onConflictDoUpdate(...)` must not contain the same conflict target twice (Postgres: "ON CONFLICT DO UPDATE command cannot affect row a second time") — dedupe the batch by conflict key keeping the LAST occurrence, which exactly preserves the per-row-loop semantics it replaces. (src/modules/polling/repository.ts)
- 2026-09-20 — Fastify 5 validates an ABSENT request body as `null`, never `undefined` — a zod `.default()` on a route body schema silently never fires (absent body → 422 where the old manual `parse(req.body ?? {})` returned a clean 400); optional bodies need `z.preprocess((v) => v ?? {}, Schema)`. (src/modules/reviews/routes.ts:14)
- 2026-09-20 — drizzle-orm 0.38.4 / drizzle-kit 0.30.6 expose `.nullsNotDistinct()` only on table-level `unique()` constraints, not `uniqueIndex()`, and hand-editing `NULLS NOT DISTINCT` onto a generated `CREATE UNIQUE INDEX` is a snapshot-drift trap — use `unique(...).nullsNotDistinct()`; Postgres backs it with a unique index anyway and the upsert arbiter is identical. (src/db/schema/core.ts:46)
- 2026-09-19 — dependency-cruiser rules are RE2 (no look-ahead) — express exclusions as `pathNot` and back-reference the from-module with `$1` in `to.path`; the config must be `.cjs` because package.json sets `"type": "module"`, and cruising `../reviewer-core/src` as a second root (`pnpm depcruise:all`) gates core purity without adding a dev-dep to reviewer-core. (.dependency-cruiser.cjs)


## Recurring Errors & Fixes

<!-- newest on top -->

- 2026-09-20 — `pnpm typecheck` in server/ failing with `TS2307: Cannot find module 'openai'/'zod'` pointed at `../reviewer-core/src/...` files means reviewer-core's `node_modules` is missing, not a server dep problem — server's tsconfig path-alias compiles reviewer-core TypeScript sources directly, so any fresh checkout/worktree must `npm install` in reviewer-core/ before server typecheck (or vitest) can run. (server/tsconfig.json paths → ../reviewer-core/src)
- 2026-09-16 — `pnpm db:migrate` failing with `column "cost_usd" … already exists` on the dev DB means the DB drifted onto a foreign migration history (leftover fork volume: extra journal hashes + extra columns) — drop/recreate the `devdigest` database (it only holds seed data), re-run migrate + seed; DROP DATABASE first terminates the idle `postgres.js` pool session held by the running dev API or it fails with "being accessed by other users" (the pool reconnects on next query, no API restart needed). (src/db/migrations/)

## Session Notes

<!-- newest on top -->

- _none yet_

## Open Questions

<!-- newest on top -->

- _none yet_
