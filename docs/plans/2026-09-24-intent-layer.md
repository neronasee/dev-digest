# Development Plan — Intent Layer: classify PR motivation, feed it into the review prompt

## Goal
Before each review round, a cheap configurable model classifies the PR's motivation
(title, description, linked ticket, plan/spec references, diff shape), stores it on
the dormant `pr_intent` table, and injects a composed, untrusted "PR intent" block
into the reviewer prompt — so a drive-by refactor and a planned change are no longer
reviewed with the same lens. The PR Overview tab shows an Intent card (goal, scope,
mechanical confidence, provenance, open feedback); derivation fails open and never
blocks a review.

## Context
- Authoritative design: `~/.claude/plans/compiled-brewing-codd.md` (approved
  2026-09-24). This plan executes it; decisions are not re-litigated.
- Dormant scaffold to reuse (zero callers verified by grep): `pr_intent` table
  (`server/src/db/schema/reviews.ts:58-65`), `Intent` contract
  (`server/src/vendor/shared/contracts/brief.ts:9-14`), `PrIntentRecord`
  (`contracts/review-api.ts:62` — stays untouched, dead), `upsertIntent`/`getIntent`
  (`server/src/modules/reviews/repository.ts:208-216` → `repository/pull.repo.ts:49-68`),
  `review_intent` in FEATURE_MODELS (`contracts/platform.ts:52-58`) + Settings picker
  (`client/.../SettingsModels/SettingsModels.tsx:39-46`) + client mirror
  `client/src/lib/feature-models.ts:22-27`. No test pins the current default.
- Seams: `ReviewRunExecutor.executeRuns` shared pre-work after `loadDiff`
  (`run-executor.ts:96-107`); prompt slots (`reviewer-core/src/prompt.ts:96-152`,
  `INJECTION_GUARD:16-28` already names "derived intent/scope" untrusted);
  `ReviewInput` (`reviewer-core/src/review/run.ts:46-97`) + `promptParts`
  (`run.ts:151-160`); `PromptAssembly` (`contracts/trace.ts:39-57`);
  `resolveFeatureModel` (`server/src/modules/_shared/feature-models.ts:58-64`);
  cheap-call caps precedent (`server/src/modules/skills/scan.ts:157-185`);
  feature-model + `model`/`cost_usd` inline precedent
  (`server/src/modules/conventions/service.ts:110-128`); `GitClient.readFile`
  (`vendor/shared/adapters.ts:247` — the pinned doc-fetch seam; MockGitClient serves
  it via `MockGitOptions.files`); `MockLLMOptions.structuredBySchema`
  (`server/src/adapters/mocks.ts:46-58`); fresh PR detail + linked-issue regex
  (`server/src/adapters/github/octokit.ts:127-135`).
- Binding INSIGHTS: pure-add migration only (`db:generate` hangs non-tty on
  drop+add, `server/INSIGHTS.md` 2026-09-22); `z.enum` needs a literal tuple
  (2026-09-20); fastify `response:` schemas re-`safeParse` the handler return
  (2026-09-20); client imports **types only** from vendor (2026-09-22 adapters
  note); client fetch is always mocked via `vi.stubGlobal` (2026-09-20).
- Migrations 0000–0014 exist → next is 0015. Specs 01–03 exist → new spec is
  `04-pr-intent.md`. Git state: clean `main` at `e41a468`.
- e2e: NO new flow — intent derivation fails open without LLM keys, so the
  hermetic stack and existing flows (which never run reviews) are unaffected.

## Affected modules
| Module | Why it changes | Its package checks |
|---|---|---|
| `server/` | pr_intent columns + migration 0015; intent derivation service; executor wiring; 3 routes; repo extension; unit + it tests; spec 04 | `pnpm typecheck`; `pnpm exec vitest run --exclude '**/*.it.test.ts'`; `pnpm depcruise` (+ `depcruise:all` for core); `*.it.test` needs Docker |
| `client/` | IntentCard + OverviewTab; intent hooks; types re-export; FEATURE_MODELS mirror; i18n | `pnpm typecheck`; `pnpm test` |
| `reviewer-core/` | new `intent` prompt slot threaded through `ReviewInput` | `npm test`; `npm run typecheck`; server `pnpm depcruise:all` |
| vendored `@devdigest/shared` | new `contracts/intent.ts`; `PromptAssembly.intent`; FEATURE_MODELS default (both copies) | `diff -rq server/src/vendor/shared client/src/vendor/shared`; typecheck BOTH |

## Binding constraints
- Vendor mirror: every `server/src/vendor/shared/` change lands byte-identical in
  `client/src/vendor/shared/` (CI `diff -rq`); typecheck BOTH packages.
- Migrations append-only: extend `pr_intent` with pure-add columns via
  `pnpm db:generate` in `server/`; never edit 0000–0014.
- No new dependencies; lockfiles untouched.
- Naming: kebab-case module files, PascalCase component files + `index.ts` barrels,
  snake_case DB columns / camelCase TS fields, `*.it.test.ts` only for DB-backed tests.
- reviewer-core stays I/O-free — intent arrives as a resolved string.
- Everything server-side lives in `modules/reviews/` (depcruise
  `no-cross-module-internals`); no new module, no new port/adapter (existing
  `github`/`git`/`llm` seams suffice).
- Spec-update-if-exists: `server/specs/04-pr-intent.md` lands in this change.
- Derivation fail-open: any error degrades to "no intent", never fails a review.

## Tasks
### Task 1 — Vendored intent contract + trace slot + FEATURE_MODELS default
- **Files**
  - `server/src/vendor/shared/contracts/intent.ts` (create) and
    `client/src/vendor/shared/contracts/intent.ts` (create, byte-identical).
  - `server/src/vendor/shared/index.ts` + `client/src/vendor/shared/index.ts`
    (edit: add `export * from './contracts/intent.js';` after the `brief.js` line;
    add `contracts/intent   IntentClassification, PrIntentDetail` to the header list).
  - `server/src/vendor/shared/contracts/trace.ts` +
    `client/src/vendor/shared/contracts/trace.ts` (edit: `PromptAssembly` gains
    `/** Composed PR-intent block; null when absent. */ intent: z.string().nullish(),`
    after `pr_description`).
  - `server/src/vendor/shared/contracts/platform.ts` +
    `client/src/vendor/shared/contracts/platform.ts` (edit: `review_intent` entry →
    `defaultProvider: 'openrouter'`, `defaultModel: 'deepseek/deepseek-v4-flash'`).
  - `client/src/lib/feature-models.ts` (edit: mirror the same default change).
  - `client/src/lib/types.ts` (edit: re-export types
    `PrIntentDetail, IntentClassification, IntentCategory, IntentEvidence,
    IntentEvidenceSource, IntentFeedbackInput`).
- **Change** — `contracts/intent.ts` contains exactly:
  `IntentCategory = z.enum(['feature','bugfix','refactor','performance','docs','test','chore','other'])`;
  `IntentEvidenceSource = z.enum(['title','description','linked_issue','plan','spec','diff'])`;
  `IntentEvidence = z.object({ source: IntentEvidenceSource, detail: z.string().optional() })`;
  `IntentClassification = z.object({ reasoning: z.string(), intent: z.string(),
  category: IntentCategory, breaking_change: z.boolean(), in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()), confidence: z.number().min(0).max(1),
  evidence_used: z.array(IntentEvidenceSource) })` — `reasoning` FIRST (judged fields
  after observed, conventions-spec D8 rule);
  `PrIntentDetail = IntentClassification.extend({ pr_id: z.string(),
  inferred: z.boolean(), sources: z.array(IntentEvidence),
  model: z.string().nullable(), cost_usd: z.number().nullable(),
  derived_at: z.string(), feedback: z.enum(['correct','incorrect']).nullable(),
  feedback_note: z.string().nullable() })`;
  `IntentFeedbackInput = z.object({ verdict: z.enum(['correct','incorrect']),
  note: z.string().max(2000).optional() })`. Export schema + `z.infer` type for each.
  `PrIntentRecord` in `review-api.ts` stays untouched.
- **Interfaces** — Produces (consumed by Tasks 2, 3, 5, 7, 8, 9): all schemas/types
  above; `PromptAssembly.intent`.
- **Skills** — zod (vendor contracts), onion-architecture (vendor placement context).
- **Constraints** — server may import runtime values from vendor; client imports
  types only (`lib/types.ts` re-export; the runtime `IntentFeedbackInput` schema is
  server-side validation, the client uses the inferred type).
- **Verify** — `diff -rq server/src/vendor/shared client/src/vendor/shared` (empty);
  `cd server && pnpm typecheck && cd ../client && pnpm typecheck`.

### Task 2 — Extend `pr_intent` schema + generate migration 0015 (pure-add)
- **Files** — `server/src/db/schema/reviews.ts` (edit: extend `prIntent` with new
  columns); `server/src/db/migrations/0015_*.sql` + `meta/_journal.json` (generated).
- **Change** — append to `prIntent` (imports: add `boolean, real` to the pg-core
  import; `import type { IntentEvidence } from '@devdigest/shared'`):
  `category: text('category', { enum: ['feature','bugfix','refactor','performance','docs','test','chore','other'] }).notNull().default('other')`
  (literal tuple per INSIGHTS 2026-09-20; mirrors `IntentCategory.options`),
  `breakingChange: boolean('breaking_change').notNull().default(false)`,
  `confidence: real('confidence').notNull().default(0)`,
  `inferred: boolean('inferred').notNull().default(false)`,
  `sources: jsonb('sources').$type<IntentEvidence[]>().notNull().default(sql`'[]'::jsonb`)`,
  `model: text('model')`, `costUsd: doublePrecision('cost_usd')`,
  `derivedAt: timestamp('derived_at', { withTimezone: true }).notNull().defaultNow()`,
  `feedback: text('feedback', { enum: ['correct','incorrect'] })`,
  `feedbackNote: text('feedback_note')`. Then `pnpm db:generate` in `server/` —
  pure adds only (no drops/renames → no interactive prompt). Verify the generated
  SQL is a single `ALTER TABLE "pr_intent" ADD COLUMN …` series; apply with
  `pnpm db:migrate` when Docker Postgres is up.
- **Interfaces** — Produces: the extended `prIntent` row shape consumed by Task 3.
- **Skills** — drizzle-orm-patterns, postgresql-table-design.
- **Constraints** — never touch 0000–0014; no CHECK constraints (house style: the
  8-value enum lives in the contract, not the DB).
- **Verify** — `cd server && pnpm typecheck && ls src/db/migrations/` (0015 present);
  `git status --short src/db/migrations/` shows only additions.

### Task 3 — Repository: intent write/read/feedback over the new columns
- **Files** — `server/src/modules/reviews/repository/pull.repo.ts` (edit: replace
  `upsertIntent`/`getIntent` bodies), `server/src/modules/reviews/repository.ts`
  (edit: facade signatures), `server/src/db/rows.ts` (edit: add
  `export type PrIntentRow = typeof t.prIntent.$inferSelect;`).
- **Change** —
  - `upsertIntent(db: Db, prId: string, w: PrIntentWrite): Promise<void>` — insert
    all classification + provenance fields (`category`…`costUsd`, `derivedAt: new Date()`,
    `feedback: null, feedbackNote: null` — feedback resets on re-derive) with
    `onConflictDoUpdate({ target: t.prIntent.prId, set: { …same fields } })`
    (single-row upsert; direct values, not `excluded.` — that is only required for
    multi-row batches per INSIGHTS 2026-09-20).
  - `getIntentDetail(db: Db, prId: string): Promise<PrIntentDetail | undefined>` —
    select the row; map to the contract (`in_scope`, `out_of_scope`, `breaking_change`,
    `cost_usd`, `derived_at` as `row.derivedAt.toISOString()`, etc.). Delete the old
    `getIntent` (zero callers verified).
  - `setIntentFeedback(db: Db, prId: string, verdict: 'correct' | 'incorrect',
    note: string | undefined): Promise<boolean>` — `update … set({ feedback: verdict,
    feedbackNote: note ?? null })` returning the row; false when no row.
  - Facade: `upsertIntent(prId, w)`, `getIntentDetail(prId)`, `setIntentFeedback(...)`
    delegating to pull.repo. `PrIntentWrite` (defined in Task 5's `intent.ts`) =
    `z.infer<typeof IntentClassification> & { inferred: boolean;
    sources: IntentEvidence[]; model: string | null; costUsd: number | null }`.
- **Interfaces** — Consumes Task 1 contracts + Task 2 row shape; Produces the three
  repo methods consumed by Tasks 5–7.
- **Skills** — onion-architecture (table ownership), drizzle-orm-patterns.
- **Constraints** — repository layer only: no HTTP, no business rules; keep the
  module doc-comment contract.
- **Verify** — `cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts'`.

### Task 4 — reviewer-core: `intent` prompt slot
- **Files** — `reviewer-core/src/prompt.ts` (edit),
  `reviewer-core/src/review/run.ts` (edit),
  `reviewer-core/test/prompt.test.ts` (create — tests live in `reviewer-core/test/`,
  alongside `to-review.test.ts`).
- **Change** —
  - `PromptParts` gains `/** Composed PR-intent block (untrusted, derived from PR
    metadata). Rendered right after the PR description. Empty/undefined → section
    omitted. */ intent?: string;`.
  - In `assemblePrompt`: after the `## PR description` push and before `## Skills /
    rules`, push `## PR intent\n${wrapUntrusted('intent', parts.intent)}` when the
    slot is non-empty (same trim guard as `repoMap`); record
    `intent: parts.intent ?? null` in the `assembly` object.
  - `ReviewInput` gains `/** Composed PR-intent block … */ intent?: string;`
    (documented like `prDescription`); `promptParts` in `reviewPullRequest` passes
    `intent: input.intent`. No cap here — the server composes a bounded block
    (Task 5); keep omit-when-empty.
- **Interfaces** — Consumes `PromptAssembly.intent` (Task 1). Produces the
  `intent` field on `PromptParts`/`ReviewInput` consumed by Task 6.
- **Skills** — onion-architecture (`core-is-pure`).
- **Constraints** — no I/O; the slot is a pre-composed string; do not reword
  `INJECTION_GUARD`.
- **Verify** — `cd reviewer-core && npm test && npm run typecheck && cd ../server
  && pnpm depcruise:all`. Tests: (1) `assemblePrompt` with `intent` renders
  `## PR intent` between `## PR description` and `## Skills / rules`, inside an
  `<untrusted source="intent">` block, and sets `assembly.intent`; (2) without
  `intent` (and with `prDescription` absent too) neither section appears and
  `assembly.intent` is null.

### Task 5 — Server intent derivation service + hermetic unit tests
- **Files** — `server/src/modules/reviews/intent.ts` (create),
  `server/test/intent.test.ts` (create, hermetic unit).
- **Change** — `intent.ts` (Application layer; doc-comment "orchestration — no HTTP,
  no raw SQL") exports:
  - `export type PrIntentWrite` (shape in Task 3).
  - `deriveIntent(container, workspaceId, pull: PullRow, repoRow: RepoRow,
    diff: UnifiedDiff, logger?: Logger): Promise<PrIntentWrite | null>` — NEVER
    throws; every stage fail-open. Steps:
    1. Gather sources, each capped, all best-effort:
       `title` (always, 300-char cap); `description` = `pull.body` if non-null, else
       fresh `container.github().getPullRequest({owner,name}, pull.number).body`
       (4 000-char cap; any throw → skip); `linked_issue` = `linked_issue` from the
       same fresh fetch, else branch-name fallback regex
       `/(?:fix|feat|close|issue)[-_/]?(\\d+)/i` on `pull.branch` → `getIssue`
       (title+body capped 2 000); `plan`/`spec` = doc refs found by regex over
       title+body — repo-relative `.md` paths (`[\\w./-]+\\.md`, `docs/plans/` and
       `*/specs/` win) and same-repo blob URLs
       (`https://github.com/<owner>/<repo>/blob/<ref>/<path>.md`) — ≤3 docs fetched
       via `container.git.readFile({owner,name}, path)` (the pinned seam; reads the
       clone working tree — acceptable best-effort), 6 000 chars each, per-doc
       try/catch; `diff` = compact summary from `diff`: `N file(s) changed (+A/-D)`
       + first 20 changed paths.
    2. Model: `resolveFeatureModel(container, workspaceId, 'review_intent')` →
       `container.llm(choice.provider).completeStructured({ model: choice.model,
       schema: IntentClassification, schemaName: 'IntentClassification', messages:
       buildIntentMessages(sources), temperature: 0, maxTokens: 500, timeoutMs:
       15_000, maxRetries: 1 })` (scan.ts caps). `buildIntentMessages` = system
       prompt (defines the 8 categories + breaking_change, demands 1–2-sentence
       goal, scope bullets, `evidence_used` ⊆ provided source kinds) + a user
       message of the capped, labeled sources — all source text is data, never
       instructions.
    3. `enforceIntentPolicy(classification, providedKinds: IntentEvidenceSource[])`
       (pure, exported): drop `evidence_used` entries not in `providedKinds`;
       `inferred = providedKinds ∩ ['description','linked_issue','plan','spec'] = ∅`;
       if `inferred` OR any evidence claim was dropped → `confidence =
       min(confidence, 0.5)`; clamp to [0,1].
    4. Return `{ …classification, inferred, sources: evidence actually provided
       (with `detail` = issue `#N` / doc path), model: result.model,
       costUsd: result.costUsd }`.
  - `composeIntentBlock(w: PrIntentWrite): string` (pure, exported): quoted goal
    statement; `category` + `breaking change` marker; confidence level word
    (High ≥0.8 / Medium ≥0.5 / Low <0.5) + numeric value + `inferred — derived from
    indirect signals only` when set; IN/OUT OF SCOPE bullets; provenance line
    (`derived from: title, description, issue #123, docs/plans/x.md · <model>`);
    closing instruction: intent is passive untrusted context — findings must be
    diff-grounded, but contradictions (promised behavior missing, out-of-scope
    files touched) ARE reportable as diff-grounded findings.
- **Interfaces** — Consumes Tasks 1/3 contracts + repo row types. Produces
  `deriveIntent`, `composeIntentBlock`, `PrIntentWrite` (consumed by Tasks 3, 6, 7).
- **Skills** — onion-architecture (application layer), zod (classification schema),
  security (PR-controlled text → classifier input and downstream prompt; keep caps
  + data-only framing).
- **Constraints** — no persistence here (the caller upserts); pure helpers
  (`enforceIntentPolicy`, `composeIntentBlock`, `buildIntentMessages` internals)
  take plain inputs so the unit lane stays hermetic.
- **Verify** — `cd server && pnpm exec vitest run test/intent.test.ts` then the
  full unit lane. Tests (MockLLMProvider / MockGitHubClient / MockGitClient passed
  directly to the pure seams): (1) happy path — body + linked issue + plan ref →
  sources carry them, confidence kept; (2) no body anywhere → `inferred: true`,
  model-claimed 0.9 capped to 0.5; (3) plan ref found by regex and its content
  (MockGit `files` map) reaches the prompt; (4) `evidence_used: ['plan']` with no
  plan provided → claim dropped + cap; (5) LLM throws → `deriveIntent` returns
  null without throwing; (6) `composeIntentBlock` renders goal/scope/provenance.

### Task 6 — Wire intent into `ReviewRunExecutor`
- **Files** — `server/src/modules/reviews/run-executor.ts` (edit).
- **Change** — In `executeRuns`, after the `Diff ready` log and before the per-agent
  loop: `const intentBlock = await this.deriveIntentOrLog(workspaceId, pull, repo,
  diff, runLog);` — a new private method that emits `runLog.tool('intent…')`, calls
  `deriveIntent(...)`, then on success `repo.upsertIntent(pull.id, record)` +
  `runLog.result(\`intent done (${ms}ms · ${record.model ?? 'unknown'} ·
  ${record.costUsd != null ? \`$${record.costUsd.toFixed(4)}\` : 'cost unknown'})\`)`
  and returns `composeIntentBlock(record)`; on null/error logs
  `runLog.error('intent failed — reviewing without intent (degraded)')` and returns
  undefined — never rethrows (fail-open; the fanned-out logger lands the lines in
  every run's Live Log + trace log). In `runOneAgent`'s `reviewPullRequest` input,
  add `...(intentBlock ? { intent: intentBlock } : {})` next to the
  `prDescription` spread (thread `intentBlock` through as a parameter).
  `prompt_assembly.intent` records itself via `outcome.assembly` (Task 4) — no
  manual trace edit. Update the class doc-comment to say intent is now actually
  loaded (the comments already claim it).
- **Interfaces** — Consumes Tasks 3, 4, 5. Produces: intent step in Live Log/trace;
  `intent` reaching the engine.
- **Skills** — onion-architecture (application layer), security (untrusted-content
  hunks).
- **Constraints** — intent derivation must never fail a queued run (diff-load
  failure semantics unchanged); `agent_runs` untouched (intent cost excluded from
  the PR-list round rollup by design — provenance only).
- **Verify** — `cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm depcruise`.

### Task 7 — Routes + service methods + DB-backed integration test
- **Files** — `server/src/modules/reviews/routes.ts` (edit),
  `server/src/modules/reviews/service.ts` (edit),
  `server/test/intent.it.test.ts` (create, `*.it.test.ts`, Docker).
- **Change** —
  - `ReviewService` methods:
    `getIntent(workspaceId, prId)` — `getPull` 404 guard, then
    `repo.getIntentDetail(prId)`; undefined → `NotFoundError('Intent not found — run a review first')`.
    `rederiveIntent(workspaceId, prId)` — pull/repo guards (404s),
    `loadDiff(container, repo, workspaceId, pull, repoRow)`, `deriveIntent(...)`
    (no logger); null → `new AppError('intent_derivation_failed', 'Intent derivation failed — check the feature-model key and try again', 502)`;
    else `repo.upsertIntent(prId, record)` → return `repo.getIntentDetail(prId)!`.
    `setIntentFeedback(workspaceId, prId, verdict, note)` — `getPull` guard;
    `repo.setIntentFeedback` false → `NotFoundError('Intent not found')`; return the
    refreshed detail.
  - Routes on the reviews router (params `IdParams`; every route has a
    `schema.response`; handler DTOs derived with `z.infer` per INSIGHTS 2026-09-20):
    `GET /pulls/:id/intent` → 200 `PrIntentDetail`;
    `POST /pulls/:id/intent` → 200 `PrIntentDetail`,
    `config: { rateLimit: { max: 5, timeWindow: '1 minute' } }` (conventions precedent);
    `PUT /pulls/:id/intent/feedback` → 200 `PrIntentDetail`, body `IntentFeedbackInput`.
    Update the module route-map doc-comment at the top of `routes.ts`.
- **Interfaces** — Consumes Tasks 1, 3, 5 (`IntentFeedbackInput`, repo methods,
  `deriveIntent`). Produces the three endpoints consumed by Task 8.
- **Skills** — fastify-best-practices, onion-architecture (transport ring),
  security (new endpoints, rate limit).
- **Constraints** — routes stay thin (validation + status mapping only); the
  global 120/min limit is disabled under test, so the it-test must not assert the
  5/min cap (assert route behavior only).
- **Verify** — `cd server && pnpm typecheck && pnpm exec vitest run .it.test`
  (needs Docker; self-skips otherwise). Tests (pattern of
  `test/settings-models.it.test.ts`: `startPg` + `seed` + `buildApp` with
  `overrides.llm.openrouter = new MockLLMProvider('openrouter',
  { structuredBySchema: { IntentClassification: fixture } })`):
  (1) `upsertIntent`/`getIntentDetail` roundtrip persists every new column and
  `derived_at` ISO round-trips; (2) `GET /pulls/:id/intent` → 404 before any
  derivation; (3) `POST /pulls/:id/intent` → 200 `PrIntentDetail` with
  category/confidence/sources from the fixture, then `GET` → 200; (4) `PUT` feedback
  → 200 with `feedback: 'correct'` + note persisted; (5) seeded foreign-PR guard
  (`getPull` 404) via a random uuid.

### Task 8 — Client intent hooks
- **Files** — `client/src/lib/hooks/intent.ts` (create).
- **Change** — `"use client"`; types via `@/lib/types` (Task 1 re-exports). Three
  hooks in the `reviews.ts` house style:
  `usePrIntent(prId: string | null | undefined)` — `useQuery`,
  `queryKey: ["intent", prId]`, `api.get<PrIntentDetail>(\`/pulls/${prId}/intent\`)`,
  `enabled: !!prId`, `retry: false` (404-when-absent must not retry);
  `useRederiveIntent(prId)` — `useMutation`,
  `api.post<PrIntentDetail>(\`/pulls/${prId}/intent\`)`, onSuccess invalidates
  `["intent", prId]`; `useIntentFeedback(prId)` — `useMutation`,
  `api.put<PrIntentDetail>(\`/pulls/${prId}/intent/feedback\`, input)`,
  onSuccess invalidates `["intent", prId]`.
- **Interfaces** — Consumes Task 7 endpoints + Task 1 types. Produces the three
  hooks consumed by Task 9.
- **Skills** — react-best-practices, next-best-practices (data fetching).
- **Constraints** — no runtime imports from `@devdigest/shared` (types only);
  404 is a legitimate state (absent intent), not a toast-worthy error.
- **Verify** — `cd client && pnpm typecheck` (behavior covered via Task 9's
  component tests — hooks are tested through the card per react-testing-library).

### Task 9 — IntentCard in the Overview tab + i18n + tests
- **Files** —
  `client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/IntentCard.tsx`
  (create), `.../IntentCard/styles.ts` (create, exports `s`), `.../IntentCard/helpers.ts`
  (create, pure), `.../IntentCard/index.ts` (create barrel), `.../IntentCard/IntentCard.test.tsx`
  (create); `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx`
  (edit); `client/src/app/repos/[repoId]/pulls/[number]/_components/PrDetailView/PrDetailView.tsx`
  (edit: pass `prId` to OverviewTab); `client/messages/en/prReview.json` (edit).
- **Change** —
  - `IntentCard({ prId }: { prId: string | null })`: `Card` + `SectionLabel
    icon="Target"` with the INTENT label and a category `Chip` (+ a `breaking
    change` marker in `var(--crit)` when set); italic quoted goal statement; two
    columns IN SCOPE (`Icon.Check`, `var(--ok)`) / OUT OF SCOPE (`Icon.X`,
    `var(--text-muted)`), each a bullet list; hairline divider
    (`borderTop: 1px solid var(--border)`); confidence dot + word from
    `helpers.confidenceLevel(confidence, inferred)` → `High/Medium/Low`
    (`--ok`/`--warn`/`--text-muted` at ≥0.8/≥0.5/below; `inferred` ⇒ forced Low) with
    the raw % only in the element `title` tooltip and a `--warn` inferred note;
    provenance line (`derived from <sources> · <model> · <date>` from
    `helpers.provenance(detail)`); footer feedback control (correct/incorrect
    buttons + optional note input → `useIntentFeedback`) rendering the recorded
    verdict ("Marked correct · <note>"), plus a compact re-derive action
    (`useRederiveIntent`). `EmptyState` ("Run a review to derive intent") when the
    query 404s (`error instanceof ApiError && error.status === 404`) or prId is
    null; minimal loading (`Skeleton`) and error states otherwise.
  - `helpers.ts` (pure, unit-tested): `confidenceLevel`, `provenance` — derived,
    never stored.
  - `OverviewTab`: add `prId` prop; render `<IntentCard prId={prId} />` as the
    first section, above Description. `PrDetailView`: `<OverviewTab prBody={pr.body}
    prId={prId} />`.
  - i18n: add an `intent` namespace to `messages/en/prReview.json` with keys:
    `label, inScope, outOfScope, confidence.{high,medium,low}, inferredNote,
    provenancePrefix, breakingChange, emptyTitle, emptyBody, feedback.{correct,
    incorrect, notePlaceholder, markedCorrect, markedIncorrect}, rederive,
    rederiving` — all visible copy through `useTranslations("prReview")`; only
    `messages/en/` exists (no other locale to update).
- **Interfaces** — Consumes Tasks 1 (types) + 8 (hooks).
- **Skills** — frontend-architecture (placement), react-best-practices,
  next-best-practices (i18n/messages), react-testing-library (for the test file).
- **Constraints** — design-image baseline: dark tokens, Card primitive, italic
  quoted goal, two-column scope; RISK AREAS pills deliberately omitted (future
  Brief feature — leave layout room). Follow the user's design image, not a
  re-invention.
- **Verify** — `cd client && pnpm typecheck && pnpm test`. `IntentCard.test.tsx`
  (jsdom, `vi.stubGlobal("fetch", …)` per house rule, fresh `QueryClientProvider`
  wrapper): (1) 200 fixture renders goal quote, both scope columns, confidence
  word, provenance, category chip; (2) 404 → EmptyState copy; (3) click
  "incorrect" → PUT `/pulls/:id/intent/feedback` fired with the right payload and
  the card refetches (assert the second GET).

### Task 10 — Behavior spec `server/specs/04-pr-intent.md`
- **Files** — `server/specs/04-pr-intent.md` (create),
  `server/specs/README.md` (edit: index row
  `| [04](04-pr-intent.md) | PR Intent — motivation classification before review |`).
- **Change** — Modeled on `03-conventions.md`: prose intro + sections
  "1. Decisions taken" (D-table, at least: D1 sources are gathered by code with
  per-source caps, never browsed by the model; D2 cheap-model-is-a-user-setting
  (`FEATURE_MODELS.review_intent`, default `openrouter`/`deepseek/deepseek-v4-flash`,
  existing overrides keep theirs); D3 mechanical confidence policy (documentary
  sources absent ⇒ inferred + ≤0.5; `evidence_used` verified against provided
  sources; model self-report never gates anything); D4 fail-open (derivation error
  degrades the review, never fails it); D5 derive-every-round upsert overwrite (no
  staleness cache; body edits take effect immediately); D6 closed 8-value
  Conventional-Commits category + orthogonal `breaking_change`; D7 reviewer-core
  purity — intent arrives as a composed untrusted string, passive context with a
  contradictions-are-findables contract; D8 intent cost excluded from the PR-list
  round rollup — provenance (`model`, `cost_usd`, `derived_at`, `sources`) on
  `pr_intent` instead); "2. What already existed"; "3. Data model" (migration 0015
  column table); "4. Contracts"; "5. Server — derivation, executor wiring, API
  table"; "6. Client"; "7. Testing" (lane table incl. "e2e: no new flow — intent
  fails open without keys").
- **Interfaces** — none (docs).
- **Skills** — none (docs path per skill-map Table A).
- **Constraints** — document implemented behavior only; link, don't duplicate,
  module READMEs.
- **Verify** — `head -20 server/specs/04-pr-intent.md`; index row present.

## Out of scope
- Intent-based reviewer routing/effort (Copilot-style lens switching) — follow-up
  feature; v1 intent is passive prompt context.
- Rest of the PR Brief design (Blast radius, Risk areas pills, Prior-PR history) —
  separate scaffolding (`pr_brief` stays dormant); the card leaves layout room.
- Separate `TicketCompliance` finding type — folded into the intent block's
  contradiction instruction for now.
- Multi-agent intent disagreement UI — one classification per derivation.
- Intent cost in the PR-list round rollup — `agent_runs` untouched by design.
- Deleting the dead `PrIntentRecord` contract — zero callers; removal is churn.

## Verification (end-to-end)
```sh
cd server  && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm depcruise && pnpm depcruise:all
cd server  && pnpm exec vitest run .it.test        # Docker lane: intent.it.test.ts
cd client  && pnpm typecheck && pnpm test
cd reviewer-core && npm test && npm run typecheck
diff -rq server/src/vendor/shared client/src/vendor/shared   # must be empty
```
Goal proof (manual, needs Docker + an OpenRouter key): `./scripts/dev.sh` → open a
seeded repo's PR #483 (real diff hunks; body null → inferred path) → Run Review →
(a) Live Log shows `intent…` then `intent done (Nms · deepseek/deepseek-v4-flash · $…)`
(or the degraded line with no key — review still completes); (b) Overview tab shows
the Intent card (inferred/Low confidence note, provenance, feedback control
persists via PUT); (c) the run trace's prompt assembly contains the
`## PR intent` slot; (d) re-running the review overwrites `pr_intent`
(`derived_at` advances). Hermetic proof: Task 5's fail-open unit test +
Task 7's route it-tests.

## Advised reviews
- **architecture-reviewer** after implementation — new prompt slot threading
  (reviewer-core purity), `modules/reviews/` placement + depcruise, vendor sync
  across three files (`intent.ts`, `trace.ts`, `platform.ts`), migration 0015
  append-only. Likely failure modes to probe: intent text reaching the prompt
  outside `wrapUntrusted`; repository logic leaking into `intent.ts`; vendor drift
  on the client copy; a second derivation call path that can throw into
  `executeRuns`.
- **pr-self-review** (the main agent's pre-PR gate) — C3 vendor parity, C1
  migration status, C4 no keys in the new prompt fixtures; security lens on the
  new routes (rate limit present, params validated) and on PR-controlled text
  flowing into `completeStructured` + the review prompt.
