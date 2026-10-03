# Development Plan — Smart Diff: role-grouped Files-changed tab with inline findings

## Goal
The Files changed tab groups PR files by role (core → tests → wiring → docs → boilerplate, docs/boilerplate collapsed), shows review findings of the latest review inline under the right diff lines (severity, title, rationale, Accept/Dismiss), marks finding lines with a colored bar + severity label, and offers an "Original order" toggle that restores GitHub order. No LLM calls anywhere — pure path classification + DB reads.

## Context
- Homework brief (L05) with P1/P2/P3 acceptance criteria; P1 must be demonstrable in the running app (`./scripts/dev.sh`), the demo video itself is the user's.
- Contracts already exist: `SmartDiffRole` (3 values today), `SmartDiffFile`, `SmartDiffGroup`, `SmartDiff`, `SmartDiffResponse` in `server/src/vendor/shared/contracts/brief.ts` + `contracts/review-api.ts:65-67` (route schema precedent: intent route in `server/src/modules/reviews/routes.ts:203-226`).
- Client recon (verified): `DiffTab.tsx` owns `showComments` state + `usePrComments`; `DiffViewer` → `FileCard` (auto-expand ≤ `AUTO_EXPAND_MAX_LINES` = 200) → `CodeLine`; `parsePatch`/`keysForLine`/`partitionThreads` in `client/src/components/diff-viewer/{helpers.ts,comments.ts}`; `OutdatedComments` is the unanchored-footer precedent. `usePrReviews`/`useFindingAction`/`usePrActiveRuns` in `client/src/lib/hooks/reviews.ts`. `FindingCard` (feature folder) is the visual reference; `SEV` + `SeverityBadge` exported from `@devdigest/ui` (`vendor/ui/primitives/tokens.ts`, `primitives/index.ts:2-5`). `prReview.smartDiff` i18n keys partially exist (`client/messages/en/prReview.json:81-90`).
- Binding INSIGHTS: handler DTO via `z.infer` of the SAME schema declared in `response` (server INSIGHTS 2026-09-20); React 19 shorthand/longhand border-color warning — left bar must use `borderLeft*` longhands only, no `border`/`borderColor` shorthand (client INSIGHTS 2026-09-18); `z.enum` needs a literal tuple (server INSIGHTS 2026-09-20); client tests always `vi.stubGlobal("fetch", …)` (client INSIGHTS 2026-09-20); no cross-module internals — everything server-side stays in `modules/reviews/` (server INSIGHTS 2026-09-22).
- "GitHub order" = the stored `pr_files` order (`getPrFiles` has no ORDER BY; insertion order in practice) — same array the client already renders, so the toggle is exact.
- Git state: clean `main`. Work stays on the current branch; do not push.
- Open assumption: none material. `picomatch` (new server runtime dep) is the only judgment call — it is the standard glob engine; hand-rolling one was rejected as risk.

## Affected modules
| Module | Why it changes | Its package checks |
|---|---|---|
| `server/` | classifier + smart-diff builder (pure), service method, GET route, picomatch dep, unit + it tests, spec 05 | `pnpm typecheck`; `pnpm exec vitest run --exclude '**/*.it.test.ts'`; `pnpm depcruise`; it-lane needs Docker |
| `client/` | SmartDiffView + DiffTab wiring, findings-in-diff plumbing, hook, i18n, types re-export, spec 02 | `pnpm typecheck`; `pnpm test` |
| vendored `@devdigest/shared` | `SmartDiffRole` enum 3 → 5 values in BOTH copies | `diff -r server/src/vendor/shared client/src/vendor/shared`; typecheck BOTH packages |

## Binding constraints
- Vendor mirror: the `SmartDiffRole` edit lands byte-identically in `server/src/vendor/shared/contracts/brief.ts` and `client/src/vendor/shared/contracts/brief.ts`; run `diff -r` + typecheck BOTH.
- No migrations, no schema edits, no lockfile hand-edits. The one dependency (`picomatch`) lands via `cd server && pnpm install picomatch` only.
- Placement (onion): all server code in `modules/reviews/` — pure logic in `modules/reviews/smart-diff/` (module-local application layer, same pattern as `intent.ts`/`helpers.ts`), DB reads only via `ReviewRepository`, HTTP only in `routes.ts`, no `container.db` in the route.
- Route validation schema-first: `params: IdParams`, `response: { 200: SmartDiffResponseSchema }`, handler return typed `z.infer` of that schema; never `Schema.parse` in the handler. Default global rate limit suffices (read route).
- Naming: kebab-case server module files; PascalCase client components with `index.ts` barrels, colocated `styles.ts`/`constants.ts`/`helpers.ts`; client tests `<Name>.test.tsx` with fetch mocked; DB-backed server test ends `*.it.test.ts`.
- Spec-update-if-exists: no existing smart-diff spec → create `server/specs/05-smart-diff.md` + `client/specs/02-smart-diff-ui.md` (intent precedent), same change.
- Conventional Commits (`feat(reviews): …`); INSIGHTS.md capture is the implementer's session-end step (engineering-insights), not a task below.
- PINNED DECISION — "findings of the last review" = the findings of the single newest `reviews` row for the PR (`reviewsForPull` is already `created_at desc` → `rows[0]`). The client computes the identical set as `reviews[0]?.findings ?? []` from `GET /pulls/:id/reviews`. Accept/dismiss state does NOT affect membership (it only mutes cards); a finding whose file is not among `pr_files` is ignored for `finding_lines`. Trade-off (documented in spec 05): in a multi-agent round only the last-finishing agent's pass shows inline; rejected alternatives — all-reviews-ever (stale rounds leak into counters) and round-grouping via `multi_run_id` (impossible client-side: `ReviewRecord` carries no round key, would need a contract change).
- PINNED DECISION — glob semantics: a pattern WITHOUT `/` matches the file's basename (`*.lock`, `index.ts`, `README*`, `.env*`, `*.config.*`, `tsconfig*.json`); a pattern WITH `/` matches the full repo-relative path (`dist/**`, `**/__tests__/**`, `e2e/**`). Classification precedence: boilerplate → tests → wiring → docs, first match wins, `core` is the fallback.

## Tasks

### Task 1 — Extend `SmartDiffRole` in both vendored contract copies
- **Files** — `server/src/vendor/shared/contracts/brief.ts` (edit), `client/src/vendor/shared/contracts/brief.ts` (edit, identical).
- **Change** — `export const SmartDiffRole = z.enum(['core', 'tests', 'wiring', 'docs', 'boilerplate']);` (literal tuple, INSIGHT 2026-09-20). No other contract edits — `SmartDiffFile`/`SmartDiffGroup`/`SmartDiff`/`SmartDiffResponse` already match the feature.
- **Interfaces** — Produces: `SmartDiffRole` with 5 values (consumed by Tasks 3, 4, 9).
- **Skills** — zod.
- **Constraints** — The two files must remain byte-identical.
- **Verify** — `diff -r server/src/vendor/shared client/src/vendor/shared` (empty) ; `cd server && pnpm typecheck` ; `cd client && pnpm typecheck`.

### Task 2 — Add `picomatch` to server
- **Files** — `server/package.json` + `server/pnpm-lock.yaml` (package-manager output only).
- **Change** — `cd server && pnpm install picomatch` (runtime dependency; ships its own TS types). No other deps.
- **Interfaces** — none.
- **Skills** — typescript-expert.
- **Constraints** — Lockfile changes only through pnpm; if install produces unrelated lockfile churn beyond the picomatch entries, stop and report instead of committing the churn.
- **Verify** — `cd server && pnpm typecheck` and `node -e "import('picomatch').then(m => console.log(m.default('**/*.test.ts')('src/a.test.ts')))"` prints `true`.

### Task 3 — Classifier + builder in `modules/reviews/smart-diff/` (test table FIRST)
- **Files** — `server/test/smart-diff.test.ts` (create, write BEFORE the implementation), `server/src/modules/reviews/smart-diff/constants.ts` (create), `server/src/modules/reviews/smart-diff/classify.ts` (create), `server/src/modules/reviews/smart-diff/smart-diff.ts` (create).
- **Change** —
  - `constants.ts`: `SMART_DIFF_ROLE_ORDER: readonly SmartDiffRole[] = ['core','tests','wiring','docs','boilerplate']` (display/group order); `SMART_DIFF_PRECEDENCE: readonly SmartDiffRole[] = ['boilerplate','tests','wiring','docs']`; `SMART_DIFF_PATTERNS: Record<Exclude<SmartDiffRole,'core'>, readonly string[]>` with exactly: boilerplate `['*.lock','pnpm-lock.yaml','package-lock.json','yarn.lock','dist/**','build/**','**/__snapshots__/**','*.snap','*.generated.*','*.min.js']`; tests `['**/*.test.ts','**/*.test.tsx','**/*.it.test.ts','**/*.spec.ts','**/test/**','**/tests/**','**/__tests__/**','e2e/**']`; wiring `['index.ts','index.js','*.config.*','tsconfig*.json','.eslintrc*','.env*','docker-compose*.yml','.github/**','.claude/**']`; docs `['**/*.md','docs/**','README*','CHANGELOG*','LICENSE']`. Doc-comment states the basename-vs-path semantics from Binding constraints.
  - `classify.ts`: `export function classifyFile(path: string): SmartDiffRole` — compiled picomatch matchers built once at module scope; per pattern, match basename when the pattern has no `/`, else the full path; walk `SMART_DIFF_PRECEDENCE`, return `'core'` as fallback.
  - `smart-diff.ts`: `export function buildSmartDiff(files: ReadonlyArray<{ path: string; additions: number; deletions: number }>, findings: ReadonlyArray<{ file: string; start_line: number }>): SmartDiff` — group files per `classifyFile` in `SMART_DIFF_ROLE_ORDER` (empty groups omitted; files keep input order within a group); per file `finding_lines` = sorted unique `start_line` of findings whose `file` matches the path (findings on unknown paths ignored); `pseudocode_summary: null`; `split_suggestion: { too_big: false, total_lines: Σ additions+deletions, proposed_splits: [] }`.
  - `server/test/smart-diff.test.ts` (hermetic, no DB): a `describe.each`-style path→role table covering at least: `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `api/poetry.lock`, `dist/app.js`, `build/x.js`, `src/x.snap`, `gen/api.generated.ts`, `static/bundle.min.js`, `src/app/page.test.ts`, `src/app/page.test.tsx`, `server/test/routes-smoke.test.ts`, `src/x.spec.ts`, `test/helpers/pg.ts`, `src/__tests__/a.ts`, `e2e/run.ts`, `index.ts`, `src/lib/index.js`, `next.config.mjs`, `tsconfig.json`, `.eslintrc.json`, `.env.example`, `docker-compose.yml`, `.github/workflows/ci.yml`, `README.md`, `CHANGELOG.md`, `LICENSE`, `docs/foo.md`, `deep/nested/guide.md`, `src/modules/reviews/service.ts` → core — plus the three CONTESTED cases asserted with comments: `src/__tests__/__snapshots__/x.snap` → boilerplate (snapshot beats tests), `.claude/skills/security/SKILL.md` → wiring (`.claude/**` beats docs), `e2e/README.md` → tests (conscious default; documented). Plus `buildSmartDiff` cases: group order, empty-group omission, `finding_lines` sorted/deduped/ignored-unknown-file, `split_suggestion` totals.
- **Interfaces** — Consumes: `SmartDiffRole`, `SmartDiff` (Task 1 + existing). Produces: `classifyFile`, `buildSmartDiff`, `SMART_DIFF_ROLE_ORDER` (consumed by Tasks 4, 9-adjacent, and L08 prompt filtering later).
- **Skills** — onion-architecture.
- **Constraints** — Pure module: no HTTP, no DB, no container imports — must be importable standalone (L08 reuses it before prompt assembly). Re-export the three names from `modules/reviews/smart-diff/smart-diff.ts` barrel-style is NOT needed; direct file imports.
- **Verify** — `cd server && pnpm typecheck && pnpm exec vitest run test/smart-diff.test.ts && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm depcruise`.

### Task 4 — Service method + GET /pulls/:id/smart-diff route
- **Files** — `server/src/modules/reviews/service.ts` (edit: add method), `server/src/modules/reviews/routes.ts` (edit: add route + module doc-comment line).
- **Change** —
  - `ReviewService.smartDiffForPull(workspaceId: string, prId: string): Promise<SmartDiff>`: `getPull` workspace-scoped (404 `NotFoundError('Pull request not found')`), then `Promise.all([this.repo.getPrFiles(prId), this.repo.reviewsForPull(prId)])`; pinned finding set = `rows[0]?.findings ?? []` mapped to `{ file: f.file, start_line: f.startLine }`; return `buildSmartDiff(files, mapped)`. No LLM, no adapters.
  - Route in `reviewsRoutes`: `app.get('/pulls/:id/smart-diff', { schema: { params: IdParams, response: { 200: SmartDiffResponseSchema } } }, …)` where `const SmartDiffResponseSchema = SmartDiffResponse;` imported from `@devdigest/shared` and `type SmartDiffDto = z.infer<typeof SmartDiffResponseSchema>` annotates the handler return (intent-route precedent, INSIGHT 2026-09-20). Handler: `getContext` → `service.smartDiffForPull`.
- **Interfaces** — Consumes: `buildSmartDiff` (Task 3), `SmartDiffResponse` (existing contract), `IdParams`, `getContext`. Produces: `GET /pulls/:id/smart-diff` → `SmartDiffResponse` (consumed by Tasks 7, 9).
- **Skills** — onion-architecture, fastify-best-practices, security (transport-surface row; input is a validated uuid param only).
- **Constraints** — Route is transport only; no per-route rate limit (cheap read).
- **Verify** — `cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm depcruise`.

### Task 5 — Route it-test over real Postgres
- **Files** — `server/test/smart-diff.it.test.ts` (create).
- **Change** — Follows `test/reviews.it.test.ts` scaffolding: `startPg`/`dockerAvailable` self-skip, `buildApp`, migrate + seed, insert a dedicated repo/PR with `pr_files` rows spanning all 5 roles (e.g. `src/pay.ts` core, `src/pay.test.ts` tests, `index.ts` wiring, `README.md` + `docs/x.md` docs, `pnpm-lock.yaml` boilerplate) plus one review with findings on `src/pay.ts` (line in the diff) and on a file not in `pr_files`. Assert: 200; groups in role order with only non-empty groups; `pnpm-lock.yaml` in boilerplate; `finding_lines` only on `src/pay.ts`; unknown-file finding ignored; `split_suggestion.total_lines` = Σ additions+deletions; a second review inserted later becomes the one whose findings show (pinned newest-review semantics); foreign-workspace PR id → 404.
- **Interfaces** — Consumes: the route from Task 4.
- **Skills** — fastify-best-practices (inject), onion-architecture.
- **Constraints** — `*.it.test.ts` suffix mandatory (imports `test/helpers/pg.ts`); Docker required.
- **Verify** — `cd server && pnpm exec vitest run test/smart-diff.it.test.ts` (Docker up via `./scripts/dev.sh` Postgres or Docker daemon).

### Task 6 — i18n keys + client type re-exports
- **Files** — `client/messages/en/prReview.json` (edit: extend `smartDiff`), `client/src/lib/types.ts` (edit: one re-export line).
- **Change** — Add under `smartDiff`: `testsLabel: "Tests"`, `docsLabel: "Docs"`, `originalOrder: "Original order"`, `groupByRole: "Group by role"`, `filesWithFindings: "{count} with findings"`, `severityLabel: { "CRITICAL": "blocker", "WARNING": "warning", "SUGGESTION": "suggestion" }`, `unanchoredTitle: "{count} finding(s) on lines not in this patch"`, `reviewNotRunTitle: "No review yet"`, `reviewNotRunBody: "Run a review to see its findings inline in the diff."`. In `lib/types.ts` change line 34-35 block to also re-export `FindingRecord`, `SmartDiffGroup`, `SmartDiffRole`, `SmartDiffResponse` (keep `SmartDiff`).
- **Interfaces** — Produces: i18n keys + `SmartDiffResponse`/`FindingRecord` types at `@/lib/types` (consumed by Tasks 7, 8, 9).
- **Skills** — next-best-practices.
- **Constraints** — No new namespaces; everything under `prReview.smartDiff`.
- **Verify** — `cd client && pnpm typecheck`.

### Task 7 — `useSmartDiff` data hook
- **Files** — `client/src/lib/hooks/reviews.ts` (edit: append hook).
- **Change** — `export function useSmartDiff(prId: string | null | undefined)`: wraps `useQuery({ queryKey: ["smart-diff", prId], queryFn: () => api.get<SmartDiffResponse>(\`/pulls/${prId}/smart-diff\`), enabled: !!prId })`. Live-update (P3): inside it, read the SHARED `usePrActiveRuns(prId)` cache (same key, no extra semantics), derive `running`; `refetchInterval: running ? 4000 : false` on the smart-diff query; plus a `React.useEffect` on the true→false `running` transition that invalidates `["smart-diff", prId]` and `["reviews", prId]` — so counters, dots and inline comments refresh when a run started elsewhere settles (mirrors `FindingsTab.onRunDone`, which is unmounted on the diff tab).
- **Interfaces** — Consumes: route (Task 4), `usePrActiveRuns` (same file), `api.get`, `SmartDiffResponse` (Task 6). Produces: `useSmartDiff` (Task 9).
- **Skills** — react-best-practices, next-best-practices.
- **Constraints** — Reuse `["reviews", prId]` key — never a second endpoint def for reviews; no new file (hook lives beside its siblings).
- **Verify** — `cd client && pnpm typecheck`.

### Task 8 — Findings inside the diff-viewer (shared components)
- **Files** — `client/src/components/diff-viewer/helpers.ts` (edit: add `partitionFindings`), `client/src/components/diff-viewer/styles.ts` (edit: marked-line style + finding-thread style), `client/src/components/diff-viewer/FindingComment/FindingComment.tsx` + `index.ts` (create), `DiffViewer/DiffViewer.tsx` (edit), `FileCard/FileCard.tsx` (edit), `CodeLine/CodeLine.tsx` (edit), `FileCard/FileCard.test.tsx` (create).
- **Change** —
  - `helpers.ts`: `export interface FindingAnchor { finding: FindingRecord; key: string }` and `export function partitionFindings(findings: FindingRecord[], renderedKeys: Set<string>): { matched: Map<string, FindingRecord[]>; unanchored: FindingRecord[] }` — key = `RIGHT:${finding.start_line}` (via existing `lineKey`), matched only when the key is in `renderedKeys`.
  - `DiffViewer`: optional `findings?: FindingRecord[]` prop; pass to each `FileCard` filtered by `f.file === file.path`.
  - `FileCard`: header gains a small accent dot (`var(--accent)`, 6px circle) next to the path when `findings.length > 0` — visually distinct from the existing `MessageSquare` GitHub counter; compute `partitionFindings` against the same `renderedKeys` set already built for threads; pass per-line findings to `CodeLine` alongside `threads`; render unanchored findings in a footer block after `OutdatedComments` (title `smartDiff.unanchoredTitle`), gated on the SAME condition as `OutdatedComments` (`commenting && commenting.showComments`).
  - `CodeLine`: optional `findings?: FindingRecord[]` prop. When non-empty: line row gets a 3px left bar + the severity label appended right of the text — new `styles.ts` helper `lineRowMarked(kind, sevColor)` = `{ ...lineRowFor(kind), borderLeftWidth: 3, borderLeftStyle: "solid", borderLeftColor: sevColor }` (longhands ONLY — React 19 shorthand warning, client INSIGHTS 2026-09-18); line severity = highest present (CRITICAL > WARNING > SUGGESTION), color from `SEV` (`@devdigest/ui`), label from `useTranslations("prReview.smartDiff")` `severityLabel.*`. The bar + label are NOT gated on `showComments` (they mark the line). Under the line, when `commenting && commenting.showComments`, render one `FindingComment` per finding (same gate as GitHub threads).
  - `FindingComment`: presentational, props `{ f: FindingRecord; pending?: boolean; onAction?: (action: FindingActionKind) => void }` — `SeverityBadge compact` + title + `Markdown` rationale + Accept/Reject buttons styled after `FindingCard`'s actions (disabled while `pending`, `active` when accepted/dismissed, muted styling for acted-on findings). Imports types from `@/lib/types` (Task 6), visuals from `@devdigest/ui`.
  - `FileCard.test.tsx` (jsdom, fetch never called — pure props): one flow test asserting the header dot, a finding comment rendered under the parsed line with matching `RIGHT:newNo`, the line's severity label, and a finding whose line is absent landing in the unanchored footer.
- **Interfaces** — Consumes: `FindingRecord`/`FindingActionKind` types, `SEV`/`SeverityBadge`/`Markdown`/`Button`, existing `keysForLine`/`lineKey`. Produces: `findings` prop chain + `FindingComment` (consumed by Task 9).
- **Skills** — frontend-architecture, react-best-practices, react-testing-library.
- **Constraints** — No behavior change when `findings` is undefined (DiffTab today, and any other caller); no custom severity palette — `SEV` only; sticky headers/collapsible comments (P3) deliberately NOT built.
- **Verify** — `cd client && pnpm typecheck && pnpm test`.

### Task 9 — SmartDiffView + DiffTab wiring (feature)
- **Files** — `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffView/SmartDiffView.tsx` (create), `…/SmartDiffView/index.ts` (create), `…/SmartDiffView/styles.ts` (create), `…/SmartDiffView/constants.ts` (create), `…/SmartDiffView/SmartDiffView.test.tsx` (create), `…/_components/DiffTab/DiffTab.tsx` (edit).
- **Change** —
  - `constants.ts`: `COLLAPSED_BY_DEFAULT: readonly SmartDiffRole[] = ['docs', 'boilerplate']`; `ROLE_LABEL_KEY: Record<SmartDiffRole, string> = { core: 'coreLabel', tests: 'testsLabel', wiring: 'wiringLabel', docs: 'docsLabel', boilerplate: 'boilerplateLabel' }`.
  - `SmartDiffView` props `{ files: PrFile[]; groups: SmartDiffGroup[]; findings: FindingRecord[]; commenting: DiffCommentApi; reviewsExist: boolean; pendingFindingId?: string | null; onFindingAction?: (action: FindingActionKind, findingId: string) => void }`. Per group (response order): a header row (chevron + i18n role label + `filesCount` + counter badge `dot` + `filesWithFindings` where count = files with `finding_lines.length > 0`, rendered ONLY when `reviewsExist && count > 0`); body when open = `DiffViewer` with the group's files (join `group.files[].path` → `files` by path, preserve group order; PrFiles not claimed by any group append to the last group — stale-cache edge) + `findings` + `commenting`. Default open per `COLLAPSED_BY_DEFAULT`; other groups open (FileCards still auto-expand individually by the existing 200-line rule).
  - `DiffTab`: add `order` state (`'role' | 'original'`, default `'role'`); call `useSmartDiff(prId)` and `usePrReviews(prId)` (shared cache); `inlineFindings = reviews[0]?.findings ?? []` (pinned set — must match Task 4); `useFindingAction()` wired once with `prId` (invalidates `["reviews", prId]`), threaded to SmartDiffView as `onFindingAction`/`pendingFindingId`; SectionLabel `right` gains a ghost toggle Button — label `originalOrder` in role mode, `groupByRole` in original mode; the existing comments toggle now renders when `commentCount > 0 || inlineFindings.length > 0`; when `reviewsExist === false` render the `reviewNotRunTitle/Body` muted hint under the label (P3 empty state); role mode renders `SmartDiffView`, `useSmartDiff` loading/error renders plain `DiffViewer` (resilient fallback), original mode renders plain `DiffViewer`; BOTH modes pass `findings={inlineFindings}` so dots/inline comments/order toggle are independent.
- **Interfaces** — Consumes: `useSmartDiff` (Task 7), `findings` prop chain (Task 8), i18n + types (Task 6), route groups (Task 4). Produces: the P1 user-visible surface.
- **Skills** — frontend-architecture, react-best-practices, react-testing-library.
- **Constraints** — All copy via next-intl; no inline user-visible strings in new code; `vi.stubGlobal("fetch", …)` in the test (mock `GET /pulls/:id/smart-diff`, `GET /pulls/:id/reviews`, `GET /pulls/:id/comments`, `GET /pulls/:id/runs/active`).
- **Verify** — `cd client && pnpm typecheck && pnpm test`.

### Task 10 — Specs + module docs
- **Files** — `server/specs/05-smart-diff.md` (create), `server/specs/README.md` (edit: table row), `server/README.md` (edit: add `GET /pulls/:id/smart-diff` to the reviews node of the API map), `client/specs/02-smart-diff-ui.md` (create), `client/specs/README.md` (edit: table row), `client/README.md` (edit: add the endpoint to the PR-detail line of the route map).
- **Change** — Spec 05 (model on `04-pr-intent.md`): decisions table — precedence-first classification with the 3 contested cases, basename-vs-path glob semantics, pinned newest-review finding set + trade-off, no-LLM guarantee, minimal `split_suggestion`, L08 reuse intent (classifier importable, prompt-filter later). Spec 02: the 5 group headers, collapse defaults, counters/dot semantics (FILES with findings, not total), dot ≠ GitHub MessageSquare counter, inline FindingComment with actions, line bar + severity labels, unanchored footer, toggle restores GitHub order, both modes show findings.
- **Interfaces** — none.
- **Skills** — none (docs paths, per skill-map Table A).
- **Constraints** — AGENTS.md link-not-duplicate rule: no AGENTS.md edits.
- **Verify** — read-back against the shipped behavior in Tasks 3-9.

## Out of scope
- Demo video + the test PR in the user's GitHub fork — the user's.
- `split_suggestion` heuristics beyond the minimal fill (and the `largeTitle/largeBody` banner UI) — future Brief work.
- L08 prompt-assembly filtering — classifier only kept importable (Task 3 constraint).
- Sticky group headers + one-line-collapsible inline comments (P3 risky items) — skipped by decision.
- e2e flows — grouping is deterministic and covered by unit/it/component tests; add a flow later only if a regression escapes.
- Refactoring DiffTab's existing inline English strings ("Show comments"/"Hide comments") to next-intl — pre-existing debt, not this feature's keys.
- `TESTING.md` — no lane changes.
- Round-grouped finding sets (`multi_run_id` on `ReviewRecord`) — would be a contract change; revisit if the multi-agent demo gap matters.

## Verification (end-to-end)
1. `cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm depcruise`
2. `cd server && pnpm exec vitest run test/smart-diff.it.test.ts` (needs Docker; self-skips without)
3. `diff -r server/src/vendor/shared client/src/vendor/shared` (must be empty)
4. `cd client && pnpm typecheck && pnpm test`
5. Manual P1 proof on the running app — `./scripts/dev.sh`, open a seeded PR with a review (e.g. PR #483/#484) → Files changed: 5 groups in order core→tests→wiring→docs→boilerplate with labels + file counts; lockfile under boilerplate; docs/boilerplate collapsed; group counter = files with findings; file-card dots; expand a file → finding comment under the right line (severity, title, rationale) + colored bar/label on the line; Accept/Dismiss mutates state; "Original order" restores GitHub order; run a review from the header and watch counters/dots appear without reload.
6. Commits: Conventional Commits on the current branch; do not push.

## Advised reviews
- **architecture-reviewer** after implementation: module placement (`modules/reviews/smart-diff/` purity, no transport leaks), vendor-sync byte-identity, onion/depcruise cleanliness, route schema-first discipline.
- **security review** not warranted beyond the route row already covered (uuid param, read-only, no auth/secrets/SQL surface) — fold any concern into the pr-self-review pass.
- **plan-verifier** per-task before merge; probe: contract enum sync drift, the pinned finding-set equality (route `rows[0]` vs client `reviews[0]`), glob basename/path semantics regressions, and React 19 border-longhand compliance in the marked line.
