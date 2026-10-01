# e2e/ — INSIGHTS

Non-obvious knowledge you can't infer from the code or git history: gotchas hit
in practice, "why it's built this way", debugging dead ends.

Contract:

- Append only — never rewrite, reword, or prune existing entries (curation is
  the insights-curator agent's exclusive, user-invoked job — `/curate-insights`).
- One dated bullet per insight, newest on top of its section:
  `- YYYY-MM-DD — one actionable sentence. (<file>:<line> or dir/PR ref)`
- If it belongs in the README, `docs/`, or a flow spec instead — put it there.

## What Works

<!-- newest on top -->

- _none yet_

## What Doesn't Work

<!-- newest on top -->

- 2026-09-21 — `wait --text` sees DOM TEXT only: a form field's placeholder attribute is invisible to it (locator on the input's aria-label via `find`, or assert on surrounding labels instead) — the agent Skills tab's 'Filter skills…' placeholder cannot be asserted with wait --text. (specs/12-agent-skills-tab.flow.json)

## Codebase Patterns

<!-- newest on top -->

- 2026-09-21 — A 'seed'-model `agent_runs` row + hand-built `run_traces` doc in seed.ts lets flows assert trace rendering (skills block, log lines) with zero model calls — the flow opens the PR's Agent runs tab and clicks the run's Trace MonoLink like any real run. (../server/src/db/seed.ts, specs/13-run-trace-skills.flow.json)

## Tool & Library Notes

<!-- newest on top -->

- 2026-09-23 — agent-browser 0.27 `wait --text` only matches text inside the VISIBLE scroll viewport of a scroll container — inside the trace drawer it matched "Skills loaded" (Configuration, in view) but never "System"/"Skills (dynamic)"/"User / diff" (below the drawer's inner fold) even though `document.body.innerText` contained them stably for 12s. Assert drawer-deep text with `wait --fn` over `innerText`, never `--text`. Flow 13 also uses a GUARDED expand --fn: the coordinate click on the below-the-fold "Prompt assembly" header reports ✓ but never toggles (TraceSection children stay unmounted while collapsed), so the fn clicks via `el.closest('div').click()` only while collapsed (`innerText.includes('User / diff')` proves expansion) — repeated polls can never toggle it shut. Brace-bearing JS is exempt from FlowSchema's stray-`{BASE}` guard in `lib/assert.ts`. (specs/13-run-trace-skills.flow.json, lib/assert.ts)
- 2026-09-22 — Sidebar NavItem anchors are NOT found by `find role link --name <label>` (0.27 reports Element not found even though the `<a>` with that textContent is in the DOM — the nested div › svg-icon › span structure defeats the role query) — navigate sidebars with `find text <label> click` instead. Icon+text BUTTONS are fine: `find role button click --name "Run scan"` resolves the same svg+span shape without complaint, so keep role+name for buttons and text for sidebar links. (specs/14-conventions.flow.json:6, client src/vendor/ui/shell/NavItem.tsx)
- 2026-09-22 — When two controls' accessible names overlap (modal submit "Create" vs toolbar "Create skill"; "All" chip vs "Deselect all"), give them DISTINCT exact names in the UI rather than fighting locators — the modal's plain "Create" label disambiguates from the toolbar's "Create skill" under 0.27's exact `--name` matching, and rendering the modal FIRST in the page's DOM keeps first-match correct even if matching ever loosens to substrings. (specs/14-conventions.flow.json:27, client src/app/repos/[repoId]/conventions/page.tsx)
- 2026-09-20 — The agent editor route mixes casing: the Config tab's "Configuration" h2 and FormField labels ("System prompt") have no text-transform, but the header's provider/model Badge is CSS-uppercased by the Badge primitive — `wait --text` on the editor must target the h2/labels in DOM casing and never the provider/model badge. (specs/09-agent-editor.flow.json:11, client src/vendor/ui/primitives/Badge.tsx:75)
- 2026-09-20 — Publishing the throwaway Postgres on `127.0.0.1` only still serves `localhost` URLs: Node's Happy Eyeballs tries `::1` first, fails against the IPv4-only publish, and falls back to `127.0.0.1` (verified empirically with a scratch pgvector container + postgres.js) — so loopback-binding the dev/e2e DB to stop LAN exposure is safe for existing `DATABASE_URL`s. (scripts/e2e.sh:98)
- 2026-09-17 — agent-browser 0.27 `wait --text` matches the CSS-text-transformed accessible text case-sensitively — header/pill assertions must use the UPPERCASE form ("FINDINGS", "FINDINGS IN THIS RUN", "CRITICAL"), never the DOM-cased source string. (specs/04-pr-findings.flow.json:16, specs/08-pr-list-findings.flow.json:9)
- 2026-09-17 — `find role <role> … --name` concatenates an element's child spans WITHOUT spaces — the severity pill's accessible name is "Critical1"/"Warning1", and substring names ("Critical", "Critical 1") all fail with "Element not found"; `find label` does not match a plain div's aria-label either, so hoverable non-control cells carry `role="group"` and are located as `find role group hover --name "2 findings"`. (specs/08-pr-list-findings.flow.json:8, client pulls/_components/FindingsCell/FindingsCell.tsx:112)
- 2026-09-17 — agent-browser clicks dispatch at element coordinates and report "✓ Done" even when the target is below the fold (577px default viewport) — the click silently does nothing; scroll the element into view first (e.g. click the timeline agent name, whose accordion `scrollIntoView`s) before clicking in-page controls. (specs/04-pr-findings.flow.json:15)

## Recurring Errors & Fixes

<!-- newest on top -->

- 2026-09-23 — In the browser-flow CI job, install `reviewer-core` with `npm ci` before `server` runs `db:seed`: Skills Lab seeding imports raw reviewer-core source, so installing its dependencies only before API startup fails the seed with `ERR_MODULE_NOT_FOUND` for `openai`. (.github/workflows/e2e-web.yml)
- 2026-09-20 — "web never became reachable on :3100" with a wall of `GET / 500` lines means the CLIENT failed to compile — the real error is the `⨯ Module not found` block in the web log ABOVE the 500 spam, not a stack/port problem; reproduce fast with `cd client && pnpm build` (webpack — same resolver as `next dev`), NOT `pnpm test` (vitest resolves `.js`→`.ts` imports natively, so the unit lanes stay green while the app is broken); clearing `client/.next` does not fix real resolution errors. (scripts/e2e.sh:160, client/next.config.mjs)

## Session Notes

<!-- newest on top -->

- 2026-09-22 — Flow 14 is the suite's first STATE-MUTATING flow (one reject, one skill create): a deliberate, documented deviation from the read-only rule, because reject-persistence and skill-creation are the behaviors under test and cannot be exercised read-only. Determinism is preserved by the hermetic runner's fresh DB — a rerun against a persistent stack would 409 on the duplicate skill name, which the flow description warns about. Scan buttons are NEVER clicked, so the no-model-call rule holds. (specs/14-conventions.flow.json)

## Open Questions

<!-- newest on top -->

- 2026-09-21 — `agent-browser wait --text "Skills (dynamic)"` times out even when the string IS in the trace drawer's DOM (seeded trace verified correct by reading run_traces directly; the section was expanded first; `wait --help` documents --text as substring match) — suspect the text engine's handling of parentheses or whitespace normalization; next debugging step is a DOM dump on a live page (`agent-browser eval document.body.innerText` or find-by-prefix "Skills (") rather than another blind flow re-run. (specs/13-run-trace-skills.flow.json)
