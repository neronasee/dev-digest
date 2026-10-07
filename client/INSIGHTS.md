# client/ — INSIGHTS

Non-obvious knowledge you can't infer from the code or git history: gotchas hit
in practice, "why it's built this way", debugging dead ends.

Contract:

- Append only — never rewrite, reword, or prune existing entries (curation is
  the insights-curator agent's exclusive, user-invoked job — `/curate-insights`).
- One dated bullet per insight, newest on top of its section:
  `- YYYY-MM-DD — one actionable sentence. (<file>:<line> or dir/PR ref)`
- If it belongs in the README, `docs/`, or a `specs/` file instead — put it there.

## What Works

<!-- newest on top -->

- 2026-09-22 — A static `vi.mock` of a data hook CANNOT observe what a mutation's onSuccess does to the real query cache (conventions' `useExtractConventions` seeds `["conventions", repoId]` from its response) — tests asserting post-mutation UI (e.g. Run scan swapping to Re-scan once a board exists) must set the mocked hook's data variable to the post-mutation state and re-render, not click and hope. (src/app/repos/[repoId]/conventions/page.test.tsx)
- 2026-09-21 — Run outcome UI must consume the persisted verdict/blocker snapshot rather than re-counting mutable finding rows, otherwise dismissing a finding retroactively recolors historical timelines and accordions. (src/app/repos/[repoId]/pulls/[number]/_components/RunHistory, ReviewRunAccordion)
- 2026-09-21 — Build zip fixtures IN MEMORY for jsdom tests with fflate's `zipSync` and parse them with `unzipSync` — no binary fixture files, no FileReader mocking, and the ignore-non-markdown rule is directly assertable by zipping a `.sh` alongside the `.md`. (src/app/skills/_components/SkillsListView/_components/ImportSkillModal/helpers.test.ts)
- 2026-09-20 — The enforced "fetch mocked" rule: setup.ts installs a throwing default `globalThis.fetch` (error names the URL), and tests opt out per test with `vi.stubGlobal("fetch", vi.fn(...))` — the setup's global `afterEach(vi.unstubAllGlobals)` restores the thrower between tests, so a mock never leaks and a missed mock fails loudly instead of hitting localhost:3001. (src/test/setup.ts)

## What Doesn't Work

<!-- newest on top -->

- 2026-09-21 — jsdom cannot fire HTML5 drag-and-drop: dispatching dragstart/drop does nothing through React's synthetic system — model reorder as a pure `reorderBound(ids, from, to)` helper (unit-tested) and let the component test assert only the `draggable` attribute + the mutation payload. (src/app/agents/[id]/_components/AgentEditor/_components/SkillsTab/)
- 2026-09-17 — Even right-anchored + flipped, an absolutely-positioned popover inside the PR-list table card is clipped on SHORT tables (2 rows: no room below or above inside the card), and a `scroll`-capture close handler then misfires on the popover's OWN inner scrolling (wheel-to-read dismissed it) — the working shape is `position: fixed` anchored to the cell's viewport rect (re-anchored on outer scroll, inner scroll ignored via `popRef.contains(e.target)`), pinned header + contained-overscroll list. (pulls/_components/FindingsCell/FindingsCell.tsx:68)
- 2026-09-17 — An absolutely-positioned popover that overhangs the PR-list table card gets clipped by its `overflow: hidden` (`s.tableCard`) — anchor it `right: 0` so it extends left over the 1fr title column, and flip up (`bottom: 100%`) for rows in the table's lower half. (pulls/_components/FindingsCell/styles.ts:22)

## Codebase Patterns

<!-- newest on top -->

- 2026-10-01 — Repo-intel resync returns before indexing finishes, and its status enum does not signal completion; capture `updatedAt`/`lastIndexedSha` before POST, poll `/index-state` until either changes, then invalidate the blast query so a degraded card refreshes in place. (src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusCard/BlastRadiusCard.tsx)

- 2026-09-19 — `@/*` maps to `src/*` ONLY, so the 11 test imports of `messages/**/*.json` can never be alias-rewritten — their deep relative paths are the accepted residue of the F2 codemod, not missed sites; fixing them would need a second tsconfig/vitest alias (e.g. `@messages/*`). (src/app/**/*.test.tsx, tsconfig.json paths)
- 2026-09-19 — `app/global-error.tsx` replaces the ROOT layout, so it must be self-contained: plain English strings (no next-intl provider exists there — `useTranslations` throws), inline hard-coded colors (globals.css / the UI kit's CSS variables aren't guaranteed), own `<html><body>`; `app/error.tsx` renders INSIDE the intact root layout and can use the kit + translations. (src/app/global-error.tsx:1)
- 2026-09-16 — Fixed-decimal cost formatting rounds REAL OpenRouter costs to "$0.000" (haiku-class runs on small diffs cost $0.0001–0.0004, below 3-decimal resolution) — `formatCost` therefore keeps 2 significant digits with 2–6 decimals ($0.060 / $0.0013 / $0.000038), superseding the earlier fixed 3/4-decimal rule. (src/lib/cost.ts)
- 2026-09-16 — USD cost renders null as an em-dash, never `$0.00` — an unpriced model or a run that failed before billing is unknown, not free; formatting lives in `src/lib/cost.ts` (3 decimals under $1 for badges/stats, 4 for the per-run timeline meta). (src/lib/cost.ts)

## Tool & Library Notes

<!-- newest on top -->

- 2026-10-04 — A test render-helper whose `messages` param defaults to one namespace but accepts extra ones must type it as `AbstractIntlMessages` (exported by next-intl) — `Record<string, unknown>` passes vitest but fails `pnpm typecheck` with a string-index incompatibility on `NextIntlClientProvider`. (pulls/[number]/_components/PrBriefCard/PrBriefCard.test.tsx renderCard)

- 2026-10-03 — `userEvent.setup()` INSTALLS ITS OWN `navigator.clipboard` stub (re-defines the own property), silently bypassing a clipboard stub installed earlier via `Object.defineProperty(navigator, "clipboard", …)` — the component's `writeText` resolves against user-event's mock (UI even shows "Copied") while your spy records zero calls; create the user FIRST, then install the stub. (src/app/repos/[repoId]/onboarding-tour/page.test.tsx AC-18)
- 2026-10-03 — The vendored `Markdown` primitive (react-markdown, no rehype-raw) renders embedded raw HTML like `<script>alert(1)</script>` as ESCAPED VISIBLE TEXT — each entity becomes its own text node inside one `<p>`, so "renders as visible text, never as elements" (AC-21-style) is literally assertable via `getByText` on the full paragraph string plus `querySelector("script")` being null. (src/app/repos/[repoId]/onboarding-tour/page.test.tsx)
- 2026-10-03 — Testing a surface that follows the global repo selector means rendering the REAL RepoProvider, which drags in two mocks (`next/navigation`'s usePathname, and `useRepos` — mockable via either `@/lib/hooks` or `@/lib/hooks/core`; the barrel re-exports the mocked core, verified both ways) — and `setRepoId` persists `dd-repo` to jsdom localStorage SHARED by every test in the file, so a test that switches repos leaks the selection into later tests unless beforeEach/afterEach clear it. (src/components/project-context/ProjectContextPicker.test.tsx)
- 2026-09-29 — jsdom's CSSOM (cssstyle) reads back unitless numbers NORMALIZED but keeps `var()` verbatim: `style.borderRadius = "999"` returns `"999px"` while `style.border = "1px solid var(--accent)"` round-trips untouched — assert inline pill styles as `el.style.border === "1px solid var(--accent)"` / `el.style.borderRadius === "999px"`, not via toHaveStyle (which can't resolve CSS vars). (BlastRadiusCard.test.tsx case (i))
- 2026-09-29 — Structural SVG assertions (`querySelectorAll("path"/"rect")`) in component tests must be scoped to the specific `<svg>` — lucide icons render as their own svg-with-`<path>` elements elsewhere in the card, so `document.querySelectorAll("path")` counts icon strokes, not just graph edges. (BlastRadiusCard.test.tsx graphSvg helper)
- 2026-09-25 — next-intl resolves a useTranslations NAMESPACE at hook-mount time, not at first t() call: adding `useTranslations("prReview.smartDiff")` to a SHARED component (diff-viewer FileCard/CodeLine) makes every test whose provider lacks that namespace log IntlError MISSING_MESSAGE even when the new code path never renders — fixtures rendering shared components must grow with the component's namespaces (src/test/smoke.test.tsx learned `prReview` the day FileCard did). (src/components/diff-viewer/FileCard/FileCard.tsx)
- 2026-09-23 — AgentCard has accepted an optional skillCount ("{count} skills" badge) since its relocation to src/components/agent-card, but no call site passed it until the list contract changed — useAgents now types GET /agents as AgentSummary[] and AgentsListView just forwards a.skill_count. (src/lib/hooks/agents.ts, src/app/agents/_components/AgentsListView/AgentsListView.tsx)
- 2026-09-22 — The vendored Modal pads only its header (`18px 24px`) and footer (`16px 24px`) — the body wrapper is deliberately unpadded, so body padding is caller-supplied and every modal body style must set its own (the skills `formBody` and confirm-modal `s.body` now carry `padding: 24`; before that, form labels sat clipped flush against the modal edge). (src/vendor/ui/kit/Modal.tsx:60, src/app/skills/_components/SkillsListView/styles.ts:88)
- 2026-09-20 — The vendored shared contracts use the ESM `.js`-extension import style, which tsc and vitest resolve to `.ts` natively but webpack does NOT — the first RUNTIME import of the barrel (reviews.ts importing the RunEvent schema) failed `next dev`/`next build` with "Can't resolve './contracts/findings.js'" while typecheck passed, because type-only imports are erased before resolution. Fix: `resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] }` in next.config.mjs (turbopack ignores the webpack hook but resolves natively). (next.config.mjs, src/vendor/shared/index.ts:17)
- 2026-09-20 — RTL 16's `asyncWrapper` (wraps every userEvent/waitFor call) parks on a fake `setTimeout(resolve, 0)` and only advances it when it detects jest fake timers — `setTimeout.clock` exists (true for vitest's sinon clock) AND a global `jest.advanceTimersByTime` exists; vitest never defines `jest`, so under `vi.useFakeTimers()` every `userEvent.*` call hangs forever (even `delay: null`). Fix: setup.ts bridges `(globalThis as any).jest = { advanceTimersByTime: (ms) => vi.advanceTimersByTime(ms) }`; inert under real timers (no `clock` prop), and react-dom 19 references `jest` zero times so the shim changes nothing else. (src/test/setup.ts, FindingsCell.test.tsx)
- 2026-09-20 — `title.template` in app/layout.tsx applies to CHILD route segments only — the root page shares the layout's segment, so its plain `title` renders bare ("Home"); the root page needs `title: { absolute: … }` while every nested page gets the "%s · DevDigest" template. (src/app/layout.tsx, src/app/page.tsx)
- 2026-09-19 — A relative-import codemod must rewrite `vi.mock("../../../lib/…")` path strings in lockstep with the imports: vitest resolves both through the same alias map, so an aliased `vi.mock("@/lib/hooks/reviews")` intercepts an aliased import and the suite stays green — but a half-rewritten pair silently stops mocking. (src/app/**/*.test.tsx)
- 2026-09-19 — next/font/google (Inter as `--font-inter`) downloads woff2 files at BUILD time — needs fonts.googleapis.com reachability or `next build` fails; consumption happens by re-declaring `body { font-family: var(--font-inter), … }` in globals.css AFTER the `@import` of the vendored styles.css (same specificity, later source order wins) rather than editing the vendored rule. (src/app/layout.tsx:12, src/app/globals.css:9)
- 2026-09-18 — React 19 dev-mode warns "Updating a style property during rerender (borderColor) when a conflicting property is set (borderLeftColor)" when one element's inline style mixes a shorthand with a longhand it expands to — and `borderColor`/`borderWidth` are shorthands too, so a left-edge severity stripe must set all four `border<Side>Width`/`border<Side>Color` longhands (removing only the `border` super-shorthand, as an earlier fix here did, is not enough). (pulls/[number]/_components/FindingCard/styles.ts:5)

## Recurring Errors & Fixes

<!-- newest on top -->

- 2026-10-04 — Resolving a deferred fetch gate with the response BODY instead of a `res(...)`-wrapped Response silently converts a success into an ApiError (`res.ok` undefined → falsy branch, json() throws → caught), so a mutation write-through test fails as "card never left the none-state" with the trigger re-enabled and no visible error — wrap every `gate.resolve(...)` payload in the same `res()` helper the stub uses. (pulls/[number]/_components/PrBriefCard/PrBriefCard.test.tsx AC-2)
- 2026-10-04 — DiffTab renders the PLAIN DiffViewer (all files, GitHub order) while smart-diff loads, so a deep-link test's `findByText(<file path>)` resolves against the wrong viewer and later "stays collapsed" assertions fail — await a role-group header (e.g. "Docs") before asserting group bodies. (pulls/[number]/_components/SmartDiffView/SmartDiffView.test.tsx focus case)

- 2026-10-03 — `expect(await findByText(x)).toBeInTheDocument()` failing with "element could not be found in the document" (the DETACHED-element message, NOT the timeout one) means the page mounts TWO queries resolving back-to-back — the tour data renders path rows as `<span>`, then RepoProvider's `/repos` resolve re-renders them as `<a>`, and findBy latches the transient node before the swap; await a settled-state anchor (`findByRole("link", …)`) before asserting anything else. Section titles that render twice (card `<h2>` + TOC button) need role-scoped queries, not `getByText`. (src/app/repos/[repoId]/onboarding-tour/page.test.tsx)
- 2026-10-02 — "Found multiple elements with the text: Project context" in a tab test was a SHARED component rendering its own `<h2>` under a host that already titles the section — shared components destined for editor tabs/sections must leave the section heading to the host (ProjectContextPicker carries only repo switch + badge in its header). (src/components/project-context/ProjectContextPicker.tsx, AgentEditor/_components/ContextTab)
- 2026-09-29 — When one component owns TWO queries (BlastRadiusCard mounting PrHistorySection added `/pulls/:id/history` next to `/blast`), a per-test fetch stub that throws on unknown URLs fails EVERY case with `[test] unexpected fetch …/history` the moment the second hook mounts — the stub must serve every URL the mounted tree can fetch, even in cases asserting nothing about that data. (src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusCard/BlastRadiusCard.test.tsx stubBlastFetch)
- 2026-09-28 — `getByText("2 symbols")` fails on a stat rendered as `<span><span>2</span> symbols</span>` because Testing Library's default matcher concatenates only DIRECT text-node children — use the function-matcher form the error message itself suggests (`getByText((_, el) => el.textContent?.trim() === "2 symbols")`) instead of flattening the JSX. (src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusCard/BlastRadiusCard.test.tsx statText helper)
- 2026-09-28 — `await findByText(title)` can resolve in the LOADING skeleton branch (Skeleton cards render the same SectionLabel as loaded data) and then synchronously assert against skeletons — await a data-only element (a stat count, a link) before asserting the rest of the loaded DOM. (src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusCard/BlastRadiusCard.test.tsx)
- 2026-09-25 — Changing a `messages/en/*.json` value's FORMAT (e.g. `"{count} files"` → ICU plural `"{count, plural, one {# file} other {# files}}"`) breaks every test asserting the old literal: TestingLibrary's "Unable to find an element with the text … broken up by multiple elements" points at DOM structure when the real cause is the rendered string changed — grep the test tree for the old message text before editing any message value. (src/components/diff-viewer/FileCard/FileCard.test.tsx:101 vs messages/en/prReview.json smartDiff.unanchoredTitle)
- 2026-09-17 — The FINDINGS cell is a new em-dash source on top of the cost/score/updated ones below — the cost em-dash test must now pass `findings: [preview]` so `getByText("—")` stays single-match. (pulls/_components/PRRow/PRRow.test.tsx:69)
- 2026-09-16 — `getByText("—")` in PRRow tests matches multiple cells (cost, null `updated_at` via `relativeTime`, null score) — give fixtures non-null `updated_at`/`score` before asserting on the em-dash, or scope the query to the cost cell. (pulls/_components/PRRow/PRRow.test.tsx)

## Session Notes

<!-- newest on top -->

- 2026-10-04 — This machine has a partial lookalike repo copy at `~/playground/neoversity/dev-digest` (vs the real `neoversity`) — one letter apart and invisible in most tool output; a Write whose prefix uses the wrong one lands in the foreign tree and typecheck/test still pass because they ran in the real one. After creating the first file deep in a tree, confirm it exists in the intended root (`ls` the new path) before continuing.


## Open Questions

<!-- newest on top -->

- _none yet_
