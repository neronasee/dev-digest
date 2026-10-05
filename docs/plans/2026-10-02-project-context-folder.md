# Development Plan — Project Context Folder (manual repo-document attachment → `## Project context` prompt slot)

## Source requirements
`specs/2026-10-02-project-context-folder.md` (SPEC-2026-10-02-project-context-folder, approved 2026-10-02) — covers **AC-1 … AC-27** (all). AC-17 is verified by the owner's manual/seeded live-model scenario (spec's own instruction); this plan pins its mechanical prerequisites (AC-13/AC-15/AC-18). Owner resolutions recorded 2026-10-02 during planning:
- **R1 (execution)** — parallel module-batched implementers (owner override of planner's sequential recommendation); contracts-first hard phase gate (see Execution mode).
- **R2 (e2e fixture)** — seed-owned fixture clone under `server/clones/acme/payments-api/{specs,docs,insights}/` + demo-repo `clone_path` assignment, written by `pnpm db:seed`.
- **R3 (reviewer-core slot)** — `PromptParts.specs` extended to `(string | { path, content })[]`; plain strings keep the legacy `spec-<i>` label and byte-identical behavior; labeled entries wrap with `source="<repo-relative path>"`; AC-16 citation line rendered only when the block is present. (The spec-creator is amending the spec's "unchanged" line in parallel — do not wait on that edit.)
- **Planner constants (spec left caps unpinned)** — per-document cap `MAX_DOC_CHARS = 16_000` (marked truncation inside the untrusted block); block-level cap `MAX_BLOCK_TOKENS = 4_000` (maximal-prefix keep, latest-first drop, dropped paths logged). No-op saves (identical ordered set) do **not** bump versions (AC-6 says "changes").

## Goal
Users hand-pick repository markdown documents (per agent and per skill, per repo); at review time the server reads them from the repo's clone and injects them into the existing `## Project context` prompt block as untrusted data; the trace shows what was read and what it cost; a read-only Project Context page and editor pickers make selection and adoption visible — with zero new LLM calls.

## Context
- Grounding read: root `specs/2026-10-02-project-context-folder.md`; `server/specs/02-skills.md` (link-table + snapshot + token-attribution precedent); `reviewer-core/specs/01-grounded-review-outcome.md`; `server/README.md`, `client/README.md`, `reviewer-core/README.md`, `e2e/README.md`, `TESTING.md`; all four `INSIGHTS.md`.
- Binding INSIGHTS: server 2026-09-22 (cross-module → container delegation; vendor port mirroring diffs WHOLE tree in CI), 2026-09-20 (`z.infer` DTOs from response schemas; drizzle enum columns carry no CHECK), 2026-09-21 (`runs` trace races — poll the trace row), 2026-09-24/09-25 (db:generate interactive on drop+add — this plan is pure-add; unapplied-migration regeneration); client 2026-09-21 (jsdom cannot drag — pure `reorder*` helper + assert payload), 2026-09-20 (fetch-mocked rule).
- Code facts this plan builds on (verified): `assemblePrompt` wraps `specs` as `spec-<i>` (`reviewer-core/src/prompt.ts:112`); `specs_read: []` always (`run-executor.ts:386`); skills token stamping precedent (`run-executor.ts:374-376`); `AgentsRepository.snapshotVersion`/`bumpVersionIn` (`agents/repository.ts:191,332`); `AgentVersionConfig.safeParse` in `toAgentVersionDto` gives legacy snapshots defaults (`agents/helpers.ts:42`); `SkillsRepository.update` body-change bump (`skills/repository.ts:115`); `repos.clonePath` nullable, seeded null (`db/schema/repos.ts:16`, `seed.ts:111`); `walkClone` symlink-skip scan precedent (`repo-intel/pipeline/walk.ts`); realpath confinement precedent (`adapters/git/simple-git.ts:129-137`); unused scaffolding to replace: `SpecFile` (`vendor/shared/contracts/platform.ts:251`) + `useContextFiles`/`useReindexContext` (`client/src/lib/hooks/core.ts:123-137`) + `client/messages/en/context.json`; seeded demo trace on PR #483 (`seed.ts:615-726`); mcp only trusted-casts (untouched).
- Assumptions for the caller: dev/e2e DBs may be re-seeded; the demo repo reading as "cloned" after seed is accepted (R2); a Settings **UI** panel for search roots is not required by any AC (API-level `PUT /settings` only).

## Execution mode
**Multi-agent — parallel module-batched implementers** (owner decision R1, overriding the planner's sequential recommendation). Hard structure:
- **Phase 1 (gate, sequential):** Tasks 1–2. Exit criteria before ANY parallel batch starts: `diff -r server/src/vendor/shared client/src/vendor/shared` is empty; `pnpm typecheck` passes in **both** `server/` and `client/`; `npm test` + `npm run typecheck` pass in `reviewer-core/`; `pnpm depcruise:all` passes from `server/`.
- **Phase 2 (parallel):** batch **S** = Tasks 3–10 (server/ only), batch **C** = Tasks 11–16 (client/ only). Batches typecheck independently against the landed contracts; implementers must not touch files outside their batch's package (plus the shared `specs/` docs task stays in Phase 3).
- **Phase 3 (after both batches merge):** Task 17 (e2e, needs server+client+seed), Task 18 (docs).
Drive with the `/implement-plan` skill's multi semantics; plan-verifier gate after Phase 3, then architecture-reviewer fix loop.

## Affected modules
| Module | Why it changes | Its package checks |
|---|---|---|
| `server/` | contracts, schema+migration, agents/skills repo methods, new `project-context` module, run-executor, container, seed, tests | `pnpm typecheck`; `pnpm exec vitest run --exclude '**/*.it.test.ts'`; `pnpm depcruise`; (Docker) `pnpm exec vitest run .it.test` |
| `client/` | hooks, shared picker, agent-editor tab, skill-editor section, Project Context page, nav, trace drawer, i18n | `pnpm typecheck`; `pnpm test` |
| `reviewer-core/` | `specs` slot labeled entries + AC-16 citation line (R3) | `npm test`; `npm run typecheck`; `pnpm depcruise:all` from `server/` |
| `e2e/` | 3 deterministic flows + README coverage table | `npm run typecheck`; hermetic `./scripts/e2e.sh` |
| `mcp/` | untouched | — |

## Binding constraints
- Onion placement per touched ring (`onion-architecture` is THE placement authority for `server/` + `reviewer-core/`); cross-module access only via the container; attachment tables owned by their anchor modules' repositories.
- Vendor sync: every `src/vendor/shared/` change mirrored **byte-identically** into both copies, then typecheck BOTH server and client (CI diffs the whole tree).
- Migrations append-only: new tables via `pnpm db:generate` in `server/` only (pure adds — no interactive prompt hazard); never edit `0000`–`0015`.
- **No new dependencies in any package** (discovery is a hand-rolled walk like `walkClone`; markdown preview uses the vendored `Markdown` primitive — no `rehype-raw`, raw HTML stays unrendered). Lockfiles untouched.
- Naming per AGENTS.md; DB-backed server tests end `*.it.test.ts`; e2e flows `specs/NN-name.flow.json`; user-visible client copy via next-intl only.
- INJECTION_GUARD text untouched (invariant C5); document content never enters the trusted system prompt; all clone reads confined under `repos.clone_path` (realpath check, no symlink following); no writes to clones or repos anywhere.
- Spec-update rule: root spec amendment (the "unchanged" line) is the spec-creator's parallel task; `server/specs/07-project-context.md` is created here (Task 18).

## Tasks

### Phase 1 — contracts + core (gate; nothing below starts until its exit criteria pass)

### Task 1 — Shared contracts: trace extension, version-snapshot field, Project Context DTOs, settings key
- **Files** — `server/src/vendor/shared/contracts/trace.ts` (edit), `.../contracts/knowledge.ts` (edit), `.../contracts/platform.ts` (edit), `server/src/vendor/shared/index.ts` (edit: barrel doc-comment), the **same four files mirrored byte-identically** under `client/src/vendor/shared/`, `client/src/lib/types.ts` (edit: drop `SpecFile` re-export, add the new types it re-exports), `client/src/lib/hooks/core.ts` (edit: delete the dead `useContextFiles`/`useReindexContext` and the `SpecFile` import — keeps the gate typecheck green).
- **Change** — trace.ts: add `export const SpecRead = z.object({ path: z.string(), tokens: z.number().int() })`; `specs_read: z.array(z.union([z.string(), SpecRead]))` (legacy strings keep validating — AC-20); `PromptAssembly` gains `specs_tokens: z.number().int().nullish()` (mirrors `skills_tokens`). knowledge.ts: `AgentVersionConfigDocs = z.object({ repo_id: z.string(), paths: z.array(z.string()) })`; `AgentVersionConfig` gains `context_docs: z.array(AgentVersionConfigDocs).default([])`. platform.ts: **remove** `SpecFile`; add under "Project Context": `ProjectDoc { path, root, size_bytes: int, tokens_estimate: int }`, `ProjectDocList { repo_id, cloned: boolean, notice: stringnullish, documents: ProjectDoc[], roots: string[], refreshed_at: string, total_tokens_estimate: int }`, `ProjectDocContent { path, content }`, `ProjectDocUsage { path, agent_count: int }`, `ContextAttachment { owner_id, repo_id, paths: string[] }`; `SettingsKnown` gains `project_context_roots: z.array(z.string().min(1)).default(['specs','docs','insights'])`.
- **Interfaces** — Produces (consumed by Tasks 4–16): `SpecRead`, `PromptAssembly.specs_tokens`, `AgentVersionConfig.context_docs`, `ProjectDoc`, `ProjectDocList`, `ProjectDocContent`, `ProjectDocUsage`, `ContextAttachment`, `SettingsKnown.project_context_roots`.
- **Skills** — zod.
- **Verify** — `cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts'`; `cd client && pnpm typecheck && pnpm test`; `diff -r server/src/vendor/shared client/src/vendor/shared` (must be empty).

### Task 2 — reviewer-core: path-labeled `specs` entries + trusted citation line (R3)
- **Files** — `reviewer-core/src/prompt.ts` (edit), `reviewer-core/src/index.ts` (edit), `reviewer-core/test/prompt.test.ts` (edit: append describe).
- **Change** — `export interface SpecEntry { path: string; content: string }`; `PromptParts.specs?: (string | SpecEntry)[]`. In `assemblePrompt`: per entry, `wrapUntrusted(typeof s === 'string' ? \`spec-${i}\` : s.path, typeof s === 'string' ? s : s.content)` — plain strings stay byte-identical to today. When the block renders, insert a trusted line directly under the `## Project context` header, outside every untrusted block: `When a finding is motivated by one of the documents below, cite that document's path in the finding's rationale.` (AC-16). Omit-when-empty unchanged (AC-13 byte-parity: no specs → no header, no line). Export `SpecEntry` from `src/index.ts`.
- **Interfaces** — Produces `SpecEntry` + the extended `PromptParts.specs` (consumed by Task 8).
- **Skills** — onion-architecture (core purity: no I/O added).
- **Verify** — `cd reviewer-core && npm test && npm run typecheck`; then `cd server && pnpm depcruise:all && pnpm typecheck`. New tests pin: path wrapper labels, citation line present-only-with-block and outside `<untrusted>`, legacy `string[]` → `spec-<i>` labels, omit-when-empty.

### Phase 2, batch S — server (parallel with batch C)

### Task 3 — DB: attachment link tables + migration
- **Files** — `server/src/db/schema/agents.ts` (edit), `server/src/db/schema/skills.ts` (edit), `server/src/db/rows.ts` (edit), `server/src/db/migrations/` (generate: `0016_*.sql` + `meta/0016_snapshot.json` + `meta/_journal.json` append — list all three).
- **Change** — `agentContextDocs = pgTable('agent_context_docs', { agentId → agents cascade, repoId → repos cascade, path: text, order: integer default 0 }, pk(agentId, repoId, path) + index on repoId)`; `skillContextDocs` mirrors with `skillId → skills cascade`. Row types `AgentContextDocRow` / `SkillContextDocRow` in `rows.ts`. Generate with `pnpm db:generate` (pure adds).
- **Skills** — drizzle-orm-patterns, postgresql-table-design.
- **Verify** — `cd server && pnpm typecheck && pnpm db:generate` then re-typecheck; confirm exactly one new `.sql` + snapshot + journal append (C1).

### Task 4 — AgentsRepository: attachment persistence + snapshot capture
- **Files** — `server/src/modules/agents/repository.ts` (edit).
- **Change** — New methods: `setContextDocs(workspaceId, agentId, repoId, paths, validPaths: ReadonlySet<string>)` — one transaction: verify agent + repo in workspace, reject any path ∉ `validPaths` with `AppError('invalid_context_path', …, 422)` before writing (AC-5), no-op (return existing row, no bump) when the ordered list is identical, else delete+insert rows order=index and `bumpVersionIn`; `contextDocsFor(agentId, repoId): Promise<string[]>` (ordered); `contextSetsFor(agentId): Promise<{ repoId; paths }[]>` (all repos, for snapshots); `contextDocUsage(repoId): Promise<{ path; agentCount }[]>` (count distinct agentId group by path). Edit `snapshotVersion` to include `context_docs: sets.map(s => ({ repo_id: s.repoId, paths: s.paths }))` (AC-6/AC-7).
- **Interfaces** — Consumes `AgentVersionConfig.context_docs` (Task 1). Produces the methods Tasks 7/8/10 call via `container.agentsRepo`.
- **Skills** — drizzle-orm-patterns, onion-architecture.
- **Verify** — `cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm depcruise` (behavioral proof in Task 10).

### Task 5 — SkillsRepository: attachment persistence + version history
- **Files** — `server/src/modules/skills/repository.ts` (edit).
- **Change** — `setContextDocs(workspaceId, skillId, repoId, paths, validPaths)` — same validation/no-op/transaction shape as Task 4; on change: replace rows, bump `skills.version`, append `skill_versions` row carrying the **current unchanged body** (the spec's settled "same consequence as a body change"). `contextDocsFor(skillId, repoId)`; `contextDocsForSkills(repoId, skillIds): Promise<{ skillId; paths }[]>` (ordered per skill, input order preserved — consumed by run composition).
- **Interfaces** — Produces the methods Tasks 7/8/10 call via `container.skillsRepo`.
- **Skills** — drizzle-orm-patterns, onion-architecture.
- **Verify** — as Task 4.

### Task 6 — project-context module I: constants, pure helpers, clone reader
- **Files** — `server/src/modules/project-context/constants.ts` (create), `helpers.ts` (create), `reader.ts` (create), `helpers.test.ts` (create), `reader.test.ts` (create, tmp-dir fixture — hermetic, no DB).
- **Change** — constants: `DEFAULT_CONTEXT_ROOTS = ['specs','docs','insights']` (must equal the contract default — cross-referencing comment), `MAX_DOC_CHARS = 16_000`, `MAX_BLOCK_TOKENS = 4_000`, `TRUNCATION_MARKER` text. helpers (pure): `docRoot(path, roots)` (first matching path segment → the doc's type), `estimateTokens(text) = Math.ceil(text.length/4)`, `truncateDoc(content)` → `{ content, truncated }` (marker appended inside the block, `clampPrDescription` style), `mergePaths(agentPaths, skillPathLists)` (agent order then skill order, dedupe by path, first occurrence wins — AC-9/AC-10), `fitBlock(entries, maxTokens)` → `{ kept, dropped }` maximal-prefix (keep everything before the first doc that would overflow; drop the whole tail — AC-27). reader: `discoverDocuments(clonePath, roots)` — recursive `readdir`, skip symlinks and unreadable/binary files (returned in `skipped` for logging), match `.md` under any `roots` segment, read each file to compute `size_bytes` + `tokens_estimate`; `readDocument(clonePath, path)` — realpath confinement check mirroring `SimpleGitClient.readFile` (reject escape) → `string | undefined`.
- **Interfaces** — Produces `DiscoveredDoc { path, root, sizeBytes, tokens }`, the helper signatures above (consumed by Tasks 7/8/10).
- **Skills** — onion-architecture; security (filesystem confinement hunks).
- **Verify** — `cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm depcruise`.

### Task 7 — project-context module II: repository, service, routes, container, registration
- **Files** — `server/src/modules/project-context/repository.ts` (create), `service.ts` (create), `routes.ts` (create), `index.ts` (create, barrel), `server/src/platform/container.ts` (edit), `server/src/modules/index.ts` (edit).
- **Change** — repository: `getRepoClone(workspaceId, repoId)` → the `repos` row's `clonePath` (adjacent parent-row read, repo-intel precedent). `ProjectContextService` (constructed with the container, lazy container getter `projectContext`): `listDocuments(workspaceId, repoId)` — roots from the `project_context_roots` settings row (`container.settingsRepo.list`, fallback `DEFAULT_CONTEXT_ROOTS`); no clone → `{ cloned: false, notice: 'Import or sync this repository first — documents are read from its local clone.', documents: [], … }` (AC-3); `readDocument(workspaceId, repoId, path)` — 404 unless currently discovered + confined; `rescan` = `listDocuments` (fresh scan, AC-25); `usage(workspaceId, repoId)` via `container.agentsRepo.contextDocUsage`; `getAttachment` / `setAttachment(ownerKind: 'agent'|'skill', ownerId, repoId, paths)` — discovery-validate then `agentsRepo`/`skillsRepo.setContextDocs`; `composeForRun(workspaceId, repoId, agentId, enabledSkillIds)` → `{ entries: { path, content, tokens, truncated }[], read: SpecRead[], omitted: string[], dropped: string[], totalTokens }` (merge → read at run time → truncate → fit; unreadable files land in `omitted`). routes (zod params/body/querystring + `schema.response` from the Task-1 contracts): `GET /repos/:id/documents`, `POST /repos/:id/documents/rescan`, `GET /repos/:id/documents/content?path=`, `GET /repos/:id/documents/usage`, `GET|PUT /agents/:id/context` (PUT body `{ repo_id: uuid, paths: string[] }` → `ContextAttachment`), `GET|PUT /skills/:id/context`. Register `projectContext` in `modules/index.ts`.
- **Interfaces** — Consumes Tasks 1, 4, 5, 6. Produces `container.projectContext` (Task 8) and the HTTP surface (Tasks 11–17).
- **Skills** — fastify-best-practices, onion-architecture, security (input validation + fs read routes).
- **Verify** — `cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm depcruise`.

### Task 8 — run-executor: run-time composition, trace, fail-open
- **Files** — `server/src/modules/reviews/run-executor.ts` (edit).
- **Change** — In `runOneAgent`, after the skills block: `enabledSkillIds = linkedSkills.filter(l => l.skill.enabled).map(l => l.skill.id)` (AC-11); call `this.container.projectContext.composeForRun(workspaceId, pull.repoId, agent.id, enabledSkillIds)` inside try/catch — any error logs `project context: failed — <msg>` and continues without a block (fail-open, enrichment precedent). On success: `runLog.info(\`project context: ${entries.length} document(s) (~${totalTokens} tokens)\`)`; log each `omitted` path (AC-19) and each `dropped` path (AC-27); pass `specs: entries.map(e => ({ path: e.path, content: e.content }))` to `reviewPullRequest` only when non-empty (AC-13 omit-when-empty); trace: `specs_read: read` (path+tokens objects — AC-18) and spread `specs_tokens: Math.ceil((outcome.assembly.specs ?? '').length / 4)` into `prompt_assembly` exactly where `skills_tokens` is stamped (same joined-block basis).
- **Interfaces** — Consumes `container.projectContext.composeForRun` (Task 7) + `SpecEntry` (Task 2). Produces the extended `RunTrace` (Task 16 renders it).
- **Skills** — onion-architecture; security (prompt-composition hunks).
- **Verify** — `cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm depcruise` (behavioral proof in Task 10).

### Task 9 — seed: fixture clone + demo-repo clone_path + seeded project-context trace
- **Files** — `server/src/db/seed-context.ts` (create: fixture writer + doc constants), `server/src/db/seed.ts` (edit).
- **Change** — `seed-context.ts` exports `ensureContextFixture(cloneDir)`: idempotently `mkdir -p` + write three small markdown files under `clones/acme/payments-api/`: `specs/api-layering.md` (MUST contain the sentence `module \`api/\` must not import \`db/\` directly` — the AC-15/AC-17 invariant doc), `docs/architecture.md`, `insights/postmortems.md`. `seed.ts`: call it, set the demo repo's `clonePath = 'clones/acme/payments-api'` (relative — resolves against the API's `server/` cwd, matching `clonePathFor` output), and extend the PR #483 seeded demo trace: `## Project context` block wrapping `specs/api-layering.md` (via `wrapUntrusted('<path>', …)`), `specs_read: [{ path: 'specs/api-layering.md', tokens: <mechanical ceil(chars/4) of the fixture> }]`, `specs_tokens`, and one log line — all inside the existing idempotency guard (R2; e2e + dev + CI identical).
- **Interfaces** — Consumes Task 1 trace contract; Produces the deterministic e2e state (Task 17) and the owner's AC-15/AC-17 fixture.
- **Skills** — drizzle-orm-patterns (db/ seed file).
- **Verify** — `cd server && pnpm typecheck`; `pnpm db:seed` twice against a scratch DB → idempotent; existing flows unaffected (`loadDiff` falls back to `pr_files` — verified).

### Task 10 — server tests: integration coverage of the ACs
- **Files** — `server/test/project-context.it.test.ts` (create), `server/test/runs-project-context.it.test.ts` (create), `server/test/contracts.test.ts` (edit).
- **Change** — `project-context.it.test.ts` (testcontainers, tmp-dir clones, self-skip sans Docker — the `runs-skills.it.test.ts` pattern): AC-1 exact paths/root/size/estimate; AC-2 `PUT /settings { project_context_roots }` → re-list reflects new roots; AC-3 null-`clone_path` repo → 200 `{ cloned: false, notice }`; AC-4 save/reload ordered paths (no text stored); AC-5 forged path → 422 `invalid_context_path`, set unchanged; AC-6 version bumps + snapshot `context_docs` lists the set; AC-7 per-repo isolation; AC-8 skill save/reload/version bump + history row; usage counts; rescan; content endpoint 404 on non-discovered/escaping paths. `runs-project-context.it.test.ts` (MockLLMProvider, mock intent/github per `helpers/intent.ts`): AC-9 agent-then-skill order; AC-10 dedupe first-wins; AC-11 disabled skill excluded; AC-12 file edited between attach and run → new content in block; AC-13 single block + `<untrusted source="<path>">` labels + no-attachment run byte-shape identical; AC-14 identical LLM call count with/without context; AC-15 invariant doc content present; AC-18 `specs_read` + `specs_tokens` in the persisted trace (poll the trace row — INSIGHT 2026-09-21); AC-19 deleted file → run succeeds, path in log, absent from `specs_read`; AC-26 oversized doc → truncation marker inside the wrapper; AC-27 over-cap set → prefix kept, dropped paths logged. `contracts.test.ts`: legacy `RunTrace` JSON with `specs_read: []` and with plain-string entries parses; `PromptAssembly` without `specs_tokens` parses (AC-20).
- **Skills** — none (Table A `server/test/**`; mock discipline via `src/adapters/mocks.ts`).
- **Verify** — `cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts'`; with Docker: `pnpm exec vitest run .it.test`.

### Phase 2, batch C — client (parallel with batch S; fetch-mocked, typechecks against landed contracts)

### Task 11 — Data hooks for the project-context API
- **Files** — `client/src/lib/hooks/project-context.ts` (create), `client/src/lib/hooks/index.ts` (edit).
- **Change** — `useProjectDocuments(repoId)` (queryKey `["project-docs", repoId]`), `useProjectDocument(repoId, path|null)`, `useRescanDocuments` (POST rescan → set `["project-docs", repoId]`), `useDocumentUsage(repoId)`, `useAgentContextSet(agentId, repoId|null)` / `useSetAgentContext` (PUT; invalidates `["agent-context", agentId]` + `["agents"]`), `useSkillContextSet` / `useSetSkillContext` (invalidates `["skill-context", skillId]` + `["skills"]`). Types from `@devdigest/shared` (Task 1).
- **Interfaces** — Consumes the Task-1 contracts + Task-7 routes; Produces the hooks Tasks 12–15 use.
- **Skills** — react-best-practices, next-best-practices (data fetching).
- **Verify** — `cd client && pnpm typecheck && pnpm test`.

### Task 12 — Shared ProjectContextPicker component
- **Files** — `client/src/components/project-context/ProjectContextPicker.tsx` (create), `index.ts`, `styles.ts`, `constants.ts`, `helpers.ts` (+ `helpers.test.ts`), `ProjectContextPicker.test.tsx` (create).
- **Change** — Props `{ ownerKind: "agent" | "skill", ownerId, showSkillNote?: boolean }`; internal repo switch (`useRepos`, default first repo); attached rows first in saved order (numbered, `draggable` attr + keyboard move up/down — jsdom can't drag, INSIGHT 2026-09-21), then unattached discovered docs (checkbox, path, folder, root-type tag, ≈tokens, preview action opening the raw markdown in a modal via the vendored `Markdown` primitive); text filter (labeled input); attached-but-undiscovered paths render as clearly-marked missing entries removable by unchecking (edge case); badge `N of M attached`; footer `≈{sum} tokens` + the fixed note that the set is injected as an untrusted `## Project context` block into every run; skill variant adds the inheritance note + serialization preview (ordered path list). `helpers.ts`: pure `reorderAttached(ids, from, to)` + `attachedTokens(docs, paths)`.
- **Interfaces** — Consumes Task-11 hooks; Produces `ProjectContextPicker` (Tasks 13–14).
- **Skills** — frontend-architecture, react-best-practices, react-testing-library.
- **Verify** — `cd client && pnpm typecheck && pnpm test`.

### Task 13 — Agent editor: Context tab
- **Files** — `client/src/app/agents/[id]/_components/AgentEditor/constants.ts` (edit: TABS += `{ key: "context", icon: "FileText" }`), `AgentEditor.tsx` (edit: branch), `_components/ContextTab/ContextTab.tsx` + `index.ts` + `ContextTab.test.tsx` (create), `client/messages/en/agents.json` (edit: tab + surface keys).
- **Change** — `?tab=context` renders `ContextTab` = `ProjectContextPicker ownerKind="agent"` with the AC-21 footer note; save = `useSetAgentContext` whole-set replace (last-save-wins, edge case).
- **Interfaces** — Consumes Tasks 11–12.
- **Skills** — frontend-architecture, react-best-practices, react-testing-library.
- **Verify** — `cd client && pnpm typecheck && pnpm test`.

### Task 14 — Skill editor: "Project context to use" section
- **Files** — `client/src/app/skills/[id]/_components/SkillDetailView/_components/ConfigTab/ConfigTab.tsx` (edit), `_components/ProjectContextSection/ProjectContextSection.tsx` + `index.ts` + `ProjectContextSection.test.tsx` (create), `client/messages/en/skills.json` (edit).
- **Change** — Section hosts `ProjectContextPicker ownerKind="skill" showSkillNote` (inheritance note + serialization preview of the paths this skill contributes — AC-22 / reconciliation #3).
- **Interfaces** — Consumes Tasks 11–12.
- **Skills** — frontend-architecture, react-best-practices, react-testing-library.
- **Verify** — `cd client && pnpm typecheck && pnpm test`.

### Task 15 — Project Context page (read-only) + sidebar nav
- **Files** — `client/src/app/repos/[repoId]/context/page.tsx` (create, thin), `_components/ProjectContextView/ProjectContextView.tsx` + `index.ts` + `styles.ts` + `helpers.ts` + `ProjectContextView.test.tsx` (create), `client/src/vendor/ui/nav.ts` (edit: WORKSPACE item `Project Context`, `href: "/repos/:repoId/context"`, `gKey: "x"` + SHORTCUTS entry), `client/messages/en/context.json` (rewrite — delete the scaffolding `.devdigest/specs/`/chunks/edit-mode copy).
- **Change** — Document tree grouped by root folder; reader pane rendering selected doc via the vendored `Markdown` primitive (no raw HTML); per-doc `Used by {n} agents` chip (`useDocumentUsage`); footer `{n} files · ≈{m} tokens · refreshed {time}` — discovery facts only, never chunk/embedding counts (AC-24); empty states: `cloned: false` → "import/sync first" (AC-3), cloned-but-empty → copy pointing at the repository itself + working re-scan (AC-23); re-scan button = `useRescanDocuments` (AC-25). No New/Upload/Edit affordances anywhere (read-only, reconciliation #2).
- **Interfaces** — Consumes Tasks 1, 11.
- **Skills** — frontend-architecture, next-best-practices, react-testing-library.
- **Verify** — `cd client && pnpm typecheck && pnpm test`.

### Task 16 — Trace drawer: Specs read chips + token attribution
- **Files** — `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/_components/TraceBody/TraceBody.tsx` (edit), `RunTraceDrawer.test.tsx` (edit), `client/messages/en/runs.json` (edit only if a new label is needed).
- **Change** — `specs_read` union rendering: object entries → chip `{path} · ≈{tokens} tk`, legacy plain strings → chip without size (AC-18/AC-20); the Project context `PromptBlock` gains `tokens={trace.prompt_assembly.specs_tokens ?? undefined}` mirroring the skills block.
- **Interfaces** — Consumes the Task-1 trace contract.
- **Skills** — react-best-practices, react-testing-library.
- **Verify** — `cd client && pnpm typecheck && pnpm test`.

### Phase 3 — e2e + docs (after both batches merge)

### Task 17 — e2e flows over the seeded fixture
- **Files** — `e2e/specs/15-project-context-page.flow.json` (create), `16-agent-context-tab.flow.json` (create), `17-run-trace-project-context.flow.json` (create), `e2e/README.md` (edit: coverage table rows 15–17).
- **Change** — 15: `/repos/:repoId/context` (via nav or direct URL) → tree shows `api-layering.md` grouped under specs → preview renders invariant sentence → usage chip → footer counts (AC-23/AC-24). 16: `/agents` → seeded agent → Context tab (`?tab=context`) → docs listed → tick one → save → reload restores checkmark and order (**mutates data — hermetic fresh DB only**, flow-14 note). 17: PR #483 → Agent runs → Trace drawer → `Specs read` chip `specs/api-layering.md` + Project context block with `~N tokens` (assert together via `wait --fn`, flow-13 pattern). Deterministic locators only; AC-3's no-clone empty state stays pinned at it-test + component level (the seeded repo now has a clone — R2).
- **Skills** — none (flow JSON; naming invariant C6).
- **Verify** — `cd e2e && npm run typecheck`; full run `./scripts/e2e.sh` (caller-run; needs Docker + agent-browser@0.27).

### Task 18 — Module docs + decision spec
- **Files** — `server/README.md` (edit: API map + module list), `client/README.md` (edit: route map + hooks), `server/specs/07-project-context.md` (create), `server/specs/README.md` (edit: index).
- **Change** — 07 records the binding decisions: repo-clone-only discovery (read-only page), per-(owner, repo) attachment shape, snapshot/version semantics incl. no-op rule, trust model (server-side composition, untrusted wrapping, path validation), caps (`MAX_DOC_CHARS`/`MAX_BLOCK_TOKENS`) + drop semantics, fail-open omissions, `project_context_roots` settings key, zero LLM calls. READMEs gain the new routes/hooks; AGENTS.md link-not-duplicate rule respected.
- **Skills** — none (docs; convention-sanity level).
- **Verify** — convention read-through; no package checks.

## Out of scope
- Settings **UI** panel for search roots (AC-2 is API-level; no AC asks for a panel) — future Settings work.
- AC-17 automation (needs a live model) — owner's manual/seeded scenario; this plan pins AC-13/15/18 mechanically.
- Automatic document selection, coverage ring, embeddings/chunks/retrieval — spec non-goals, deferred to the future auto-selection feature.
- DevDigest-authored documents / any clone or repo writes — removed by the owner's read-only decision.
- New MCP tools — spec non-goal; `mcp/` untouched.
- Bumping dependent agents' versions when a skill's attachment changes — consistent with skills body-change behavior today.

## Verification (end-to-end)
Full matrix, run from each package dir:
1. `cd reviewer-core && npm test && npm run typecheck`
2. `cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm depcruise`
3. (Docker) `cd server && pnpm exec vitest run .it.test` — includes `project-context.it`, `runs-project-context.it`, and the full existing lane
4. `cd client && pnpm typecheck && pnpm test`
5. `diff -r server/src/vendor/shared client/src/vendor/shared` — empty (C3)
6. `cd server && pnpm depcruise:all` — core purity
7. `cd e2e && npm run typecheck`; hermetic browser proof: `./scripts/e2e.sh` (Docker + agent-browser@0.27)
Goal proof: step 3's `runs-project-context.it.test.ts` demonstrates the spec's core loop mechanically (attach → run → one `## Project context` block, path-labeled untrusted docs, ordered/deduped, trace chips + token attribution, fail-open omissions, caps enforced, identical LLM call count), and step 7's flows 15–17 show it in the UI over the seeded fixture. **AC-17 owner acceptance (manual):** with a configured model key, run a review on a PR of a repo whose attached `specs/api-layering.md` states the api→db invariant and whose diff violates it — expect a grounded finding whose rationale cites `specs/api-layering.md` (prerequisites pinned by AC-13/15/18 tests above).

## Advised reviews
- **Architecture review** (after implementation): new module + container getter + cross-module seams (Tasks 4–8) and the reviewer-core slot extension (Task 2). Probe: onion placement of attachment tables vs. the project-context module, snapshot transactionality (replace+bump+snapshot atomic; no-op path skips bump), fail-open parity with the enrichment precedents, depcruise baseline not grown.
- **Security review** (strongly advised): untrusted-content handling end to end. Probe: path-traversal/symlink escape in `discoverDocuments`/`readDocument`/the content route (forged `path` query, `..`, absolute paths, symlinked `.md`), AC-5 validation happening server-side before persist, document content never reaching the trusted system prompt or task line, INJECTION_GUARD untouched (C5), markdown preview rendering without raw HTML/script, truncation marker staying inside the untrusted wrapper.
