# client/ — INSIGHTS

Non-obvious knowledge you can't infer from the code or git history: gotchas hit
in practice, "why it's built this way", debugging dead ends.

Contract:

- Append only — never rewrite, reword, or prune existing entries.
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

- 2026-09-19 — `@/*` maps to `src/*` ONLY, so the 11 test imports of `messages/**/*.json` can never be alias-rewritten — their deep relative paths are the accepted residue of the F2 codemod, not missed sites; fixing them would need a second tsconfig/vitest alias (e.g. `@messages/*`). (src/app/**/*.test.tsx, tsconfig.json paths)
- 2026-09-19 — `app/global-error.tsx` replaces the ROOT layout, so it must be self-contained: plain English strings (no next-intl provider exists there — `useTranslations` throws), inline hard-coded colors (globals.css / the UI kit's CSS variables aren't guaranteed), own `<html><body>`; `app/error.tsx` renders INSIDE the intact root layout and can use the kit + translations. (src/app/global-error.tsx:1)
- 2026-09-16 — Fixed-decimal cost formatting rounds REAL OpenRouter costs to "$0.000" (haiku-class runs on small diffs cost $0.0001–0.0004, below 3-decimal resolution) — `formatCost` therefore keeps 2 significant digits with 2–6 decimals ($0.060 / $0.0013 / $0.000038), superseding the earlier fixed 3/4-decimal rule. (src/lib/cost.ts)
- 2026-09-16 — USD cost renders null as an em-dash, never `$0.00` — an unpriced model or a run that failed before billing is unknown, not free; formatting lives in `src/lib/cost.ts` (3 decimals under $1 for badges/stats, 4 for the per-run timeline meta). (src/lib/cost.ts)

## Tool & Library Notes

<!-- newest on top -->

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

- 2026-09-17 — The FINDINGS cell is a new em-dash source on top of the cost/score/updated ones below — the cost em-dash test must now pass `findings: [preview]` so `getByText("—")` stays single-match. (pulls/_components/PRRow/PRRow.test.tsx:69)
- 2026-09-16 — `getByText("—")` in PRRow tests matches multiple cells (cost, null `updated_at` via `relativeTime`, null score) — give fixtures non-null `updated_at`/`score` before asserting on the em-dash, or scope the query to the cost cell. (pulls/_components/PRRow/PRRow.test.tsx)

## Session Notes

<!-- newest on top -->

- _none yet_

## Open Questions

<!-- newest on top -->

- _none yet_
