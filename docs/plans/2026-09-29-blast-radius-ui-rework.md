# Blast-radius UI rework — match the approved screenshots

## Context

Branch `homework4/02-blast-radius` shipped the blast-radius feature (commit `7b0eb4f`):
server module (`server/src/modules/blast/` — `GET /pulls/:id/blast` + `GET /pulls/:id/history`),
vendored contracts, client `BlastRadiusCard` (tree/graph toggle, stats row, disclosure rows,
degraded chip + resync) and a separate `PrHistoryCard`, plus the `get-blast-radius` MCP tool.

The user wants the PR Overview surface to match two approved screenshots:

- **Tree view**: stats row with per-stat icons; symbol rows with a `<>` accent icon;
  caller list with `↳` connectors and monospace `file:line` links; endpoint badges
  (accent pill, globe icon, bold method + path) and cron badges (amber pill, clock icon);
  `+N more` expander when a group has many endpoints; a divider and a collapsible
  "Prior PRs touching these files" row **inside** the blast card (count badge + chevron).
- **Graph view**: same 3-tier layered DAG (symbols → callers → endpoints/crons) with
  rounded-rect node pills (accent border for symbols/endpoints, neutral for callers,
  amber for crons), curved cubic-bezier edges without arrowheads, and a legend row.

**Server side is unchanged** — data shapes already support everything the screenshots show.

## Current-state assessment

Solid and kept: server grouping/dedup/rank-sort/caps (all tested), vendored contracts in
sync, `history.*` i18n keys already in `client/messages/en/blast.json`, stats row,
tree/graph toggle, GitHub blob links pinned to head SHA, degraded chip + resync.

Gaps vs screenshots: no `<>` icon / `↳` connectors / badge styling (tree); bare text
columns with straight `<line>` edges, no node pills / beziers / legend / large-map cap
(graph); PrHistory is a separate card below; no endpoint-count cap (live worst case:
80 endpoints in one group).

## DB findings & test-PR matrix (verified against the live dev stack)

Indexed repos: `honojs/hono` (1267 symbols, 73k references, full index) and
`burnjohn/quick-blog` (116 symbols). `acme/payments-api` has **no clone and no index** →
every seeded PR returns `degraded: true, reason: "no_data"`.

| PR | live blast response | use it to test |
|---|---|---|
| **honojs/hono #3711** (primary) | 48 symbols, 20 callers, 8 endpoints, non-degraded | tree scale, graph cap, full happy path |
| **honojs/hono #5402** | 9 symbols, 7 callers, **80 endpoints** on `logger`; callers include `src/helper/dev/index.ts` | `+N more` expander; demo cron + history land here |
| honojs/hono #5294 | 28 symbols, 20 callers, 13 endpoints | mid-size sanity |
| burnjohn/quick-blog #23 | 6 symbols, 0 callers | `noDownstream` (tree) / `graph.empty` |
| acme/payments-api #482 | degraded `no_data` | degraded chip + resync action |

**Data gaps (user chose: patch demo data):** `file_facts.crons` is empty everywhere →
amber cron badge can't render live; no merged PR has `pr_files` rows → `/history` is
empty for every PR. Solved by a dev-only demo script (below), not by server changes.

## Implementation

All client paths relative to
`client/src/app/repos/[repoId]/pulls/[number]/_components/`.

### 1. `BlastRadiusCard/ImpactBadges.tsx` (new)

- `ImpactBadgeList({ endpoints, crons })`: renders `ENDPOINT_PREVIEW = 5` endpoint pills;
  when more exist and not expanded, a `+{count} more` / `Show fewer` toggle (i18n
  `impact.more` / `impact.fewer`, real `<button>`). Crons always render in full.
- `EndpointBadge`: `<span>` pill (NOT `Chip` — Chip is a `<button>`, invalid nested
  inside the group-header button): `border: 1px solid var(--accent)`,
  `background: var(--accent-bg)`, `color: var(--accent-text)`, `borderRadius: 999`,
  mono font; `<Globe size={12} aria-hidden />`; splits `"GET /users"` on first space →
  bold method `<b>` + path.
- `CronBadge`: same shape with `border: 1px solid var(--warn)`, `background: var(--warn-bg)`,
  text `var(--text-secondary)` (no `--warn-text` token exists), `<Clock size={12} aria-hidden />`.

### 2. `BlastRadiusCard/BlastRadiusCard.tsx` (modify)

- Stats row: each stat gets a leading icon — `Code` / `Users` / `Globe` / `Clock`,
  `size={12} aria-hidden`, `var(--text-muted)`; keep existing labels/count markup
  (tests match on it).
- `SymbolGroup` header: leading `<Code size={13} aria-hidden style={{ color: "var(--accent)" }} />`;
  caller rows gain `<CornerDownRight size={12} aria-hidden />` connector + slight indent;
  chip row replaced by `<ImpactBadgeList … />`. Zero-caller branch unchanged.
- Card bottom (both views): `<div style={s.divider} />` + `<PrHistorySection … />`.

### 3. `BlastRadiusCard/PrHistorySection.tsx` (new — absorbs PrHistoryCard)

Props `{ prId, repoFullName }`, `usePrHistory(prId)`, namespace stays `"blast"`:

- Loading → `null`; error → non-collapsible muted error row.
- Disclosure row `<button aria-expanded>` (default collapsed): `t("history.title")`,
  count badge `<span>` (`0` renders too — honest empty), `ChevronDown/ChevronRight`.
- Expanded body: existing item markup verbatim from `PrHistoryCard` (#number + GitHub
  title link, `author · merged {date}`, overlap `Chip`s — fine here, not nested in a
  button — notes), `slice(0, 5)` + new `history.more` line when more exist.

Then: `OverviewTab.tsx` drops the `PrHistoryCard` import/JSX (props already flow);
**delete the `PrHistoryCard/` folder** (4 files). Hook `usePrHistory` + endpoint untouched.

### 4. `BlastRadiusCard/BlastGraph.tsx` (rewrite)

Deterministic layout, no measurement effects:

- Caps: `groups = downstream.filter(g => g.callers.length > 0).slice(0, GROUP_CAP = 8)`
  (server rank order — matches tree view); while `> 3` groups and total rows
  > `ROW_BUDGET = 48`, drop last; per group ≤ `CALLER_CAP = 6` callers and
  `CHIP_CAP = 5` chips. When capped, render `graph.trimmed` note under the legend
  ("switch to tree view for the full map").
- Pill sizing: `estW(text) = min(MAX_W, len * 6.6 + 2*PAD_X)` per column
  (`MAX_W` 190/230/250); `fit()` ellipsizes; full value in `<title>` (native tooltip).
- Columns computed from capped data: `X1 = 12`, `X2 = X1 + maxSymbolW + GUTTER`,
  `X3 = X2 + maxCallerW + GUTTER`, `WIDTH = X3 + maxChipW + 12`; `PITCH = 30`,
  `PILL_H = 22`, `rx = 11`. Symbol pill vertically centered on its caller span.
- Nodes: `<rect rx>` + `<text>` (`textAnchor="middle"`); symbol = accent border +
  bold primary text; caller = `border-strong` + mono secondary text; endpoint =
  accent border + bold method `<tspan>`; cron = warn border.
- Edges: `M x1 y1 C x1+28 y1, x2-28 y2, x2 y2` cubic beziers, `stroke="var(--border-strong)"`,
  `fill="none"`, no arrowheads.
- Legend (HTML under the SVG): 12×12 bordered swatch spans + labels —
  `graph.legend.symbol/callers/endpoints/crons` (cron item only when crons exist in
  shown data). Keep `role="img"` + `aria-label` + `graph.empty` early return.

### 5. `BlastRadiusCard/styles.ts` + i18n

- New style keys: `statItem, symbolIcon, callerGlyph, endpointBadge, endpointMethod,
  cronBadge, badgeMore, divider, historyRow, historyCount, historyChevron, graphLegend,
  legendItem, legendSwatch, graphTrimmed`; port PrHistoryCard's list/item keys with a
  `history` prefix; dedupe the identical `chipRow`/`errorText`. All CSS vars, single
  `border` shorthands only.
- `client/messages/en/blast.json` (only `en` exists): add `impact.more/fewer`,
  `history.more`, `graph.legend.*`, `graph.trimmed`. Do NOT touch existing
  `stat.*`/`history.*` values — tests assert their literals.

### 6. Demo-data script — `scripts/blast-demo-data.sh` (new, root scripts/ next to dev.sh)

`apply` / `revert` modes; `docker exec devdigest-postgres psql -U devdigest -d devdigest`
with embedded SQL (echo what it does; refuses if the container is down):

- **Cron fact** (visible on hono #5402): upsert
  `file_facts(repo_id = honojs/hono, file_path = 'src/helper/dev/index.ts')` —
  a confirmed caller file of #5402's blast response — setting
  `crons = '["demo:prune-sessions @ daily 03:00"]'::jsonb` (preserve existing endpoints;
  `ON CONFLICT (repo_id, file_path) DO UPDATE`).
- **Prior-PR overlap** (visible on #5402 and #3711): insert `pr_files` rows linking two
  real merged hono PRs (number < target, e.g. #5311 → `src/middleware/logger/index.ts`,
  #5292 → `src/utils/url.ts`; minimal columns, check `db/schema/pulls.ts` for defaults).
  Rows are demo-only — `revert` deletes exactly these `(pr_id, path)` pairs and resets
  the cron fact to `'[]'::jsonb`.
- Print the URLs to check afterwards: PR Overview pages for #5402/#3711.
- Note in the script header: data is synthetic demo data for screenshot parity, never
  for seeds (`server/src/db/seed.ts` untouched).

### 7. Spec + docs (same PR)

- `server/specs/06-blast-radius.md`: §4 client section — PrHistoryCard folded into
  `BlastRadiusCard` as `PrHistorySection`; add **D12** row: graph caps (top-8 groups in
  rank order, caller/chip caps, `graph.trimmed` note) + endpoint `+N more` expander +
  badges-are-spans-not-Chips (nested-button rule); §6 test list updated.
- `client/INSIGHTS.md` (session end, via engineering-insights skill): dual-endpoint fetch
  stub requirement once one card owns two queries.

## Files summary

| Action | File |
|---|---|
| create | `…/BlastRadiusCard/ImpactBadges.tsx`, `…/BlastRadiusCard/PrHistorySection.tsx`, `scripts/blast-demo-data.sh` |
| modify | `…/BlastRadiusCard/BlastRadiusCard.tsx`, `…/BlastGraph.tsx` (rewrite), `…/BlastRadiusCard/styles.ts`, `…/BlastRadiusCard/BlastRadiusCard.test.tsx`, `client/messages/en/blast.json`, `…/OverviewTab/OverviewTab.tsx`, `server/specs/06-blast-radius.md` |
| delete | `…/PrHistoryCard/` (`PrHistoryCard.tsx`, `styles.ts`, `index.ts`, `PrHistoryCard.test.tsx`) |

Untouched: server code, contracts, `lib/hooks/blast.ts`, `lib/types.ts`, vendored UI, MCP tool.

## Tests

- **Stub change (mandatory)**: `stubBlastFetch` must also serve `/pulls/pr-1/history`
  (it currently throws on any non-`/blast` URL → every case fails once the section mounts).
- Survive as-is: collapse (b), tree/graph toggle (c), graph empty (d), degraded (e),
  headSha-null (f), noCallers/empty (g), error (h).
- Update (a): endpoint badge text is now split (`<b>POST</b> /users`) — assert via
  `el.textContent === "POST /checkout"` function matcher.
- Port from deleted `PrHistoryCard.test.tsx` (3 cases): collapsed-by-default + expand +
  link/meta/chips; empty history (count 0 + `history.empty`); `repoFullName=null` plain text.
- New: (i) `Code`/`Globe`/`Clock` icons present + pill styling; (j) 7 endpoints → 5 +
  `+2 more` → expand/collapse; (l) graph structure — `rect` count = pills, `path` count =
  edges, legend labels, cron legend conditional, `<title>` untrimmed; (m) 12-group
  fixture → 8 symbol pills + `graph.trimmed`, tree still shows all 12.

## Verification

1. `client/`: `pnpm typecheck && pnpm test`.
2. `scripts/blast-demo-data.sh apply` → in the running web app check the Overview tab:
   - hono #5402: `<>` icons, `↳` callers, endpoint pills with `+75 more`, amber cron
     badge on `getColorEnabledAsync`, prior-PRs row with count ≥ 1;
   - hono #3711: 48-group tree, graph capped to 8 groups + trimmed note;
   - quick-blog #23 and acme #482: empty/degraded states intact.
3. `scripts/blast-demo-data.sh revert` restores pristine data.
4. Session end: engineering-insights skill → `client/INSIGHTS.md`.
5. Before any PR: `/pr-self-review` (golden rule) — BLOCK verdict means fix first.

## Out of scope

Server routes/contracts/queries, MCP tool changes (history stays human-only), ICU-plural
stat copy, new client dependencies, seed changes.
