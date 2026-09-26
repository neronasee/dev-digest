# 02 — Smart Diff UI: role-grouped Files-changed with inline findings

Status: **implemented** (2026-09-25) · Scope: `client/` (Files changed tab)
Related: [`05-smart-diff.md`](../../server/specs/05-smart-diff.md) — the
server-side decisions (precedence, glob semantics, pinned finding set);
[`01-pr-findings-severity-ui.md`](01-pr-findings-severity-ui.md) — the severity
vocabulary shared with the Findings panel.

The Files changed tab groups PR files by role with the latest review's
findings marked inline. Grouping data comes from `GET /pulls/:id/smart-diff`
(`useSmartDiff`); the inline set is `reviews[0]?.findings ?? []` — the SAME
pinned set the server marks, computed client-side from the shared
`["reviews", prId]` cache.

## 1. Decisions taken

| # | Decision | Consequence |
|---|----------|-------------|
| U1 | Five **group headers** render in response order — Core → Tests → Wiring → Docs → Boilerplate — each with an i18n label (`prReview.smartDiff.*Label`) + a `filesCount` | role order is server-owned (`SMART_DIFF_ROLE_ORDER`); the client never re-sorts |
| U2 | **Collapse defaults**: docs + boilerplate start collapsed, every other group starts open; FileCards still auto-expand individually by the existing 200-line rule; clicking a header toggles that group only | review attention lands on core first without hiding anything |
| U3 | The group **counter badge counts FILES with findings** (`finding_lines.length > 0`), never total findings — and renders ONLY when a review exists and the count > 0 | "2 with findings" means two files need eyes, not two bugs; with no review there is nothing to count |
| U4 | The file-header **accent dot** (6px `var(--accent)`, `title` = "N finding-lines") is deliberately distinct from the GitHub `MessageSquare` comment counter beside it | dot = our review findings; MessageSquare = GitHub review comments; both can coexist |
| U5 | **Inline FindingComment** under the cited line (severity badge + title + markdown rationale + Accept/Reject), behind the SAME `showComments` gate as GitHub threads; Accept/Reject reuse the shared `useFindingAction` (prId rides the mutation, `["reviews", prId]` invalidates) | the diff stays clean by default; actions taken here update every other surface |
| U6 | The **line bar + severity label are NOT gated** on `showComments` — they mark the line itself: a 3px left bar + `severityLabel.*` text in the highest present severity (CRITICAL > WARNING > SUGGESTION), color strictly from `SEV` (no custom palette); bar via `borderLeft*` longhands only (React 19 shorthand warning) | collapsed-comments mode still shows WHERE the problems are |
| U7 | A finding whose cited line is not in the patch lands in an **unanchored footer** per file (title `unanchoredTitle`), same gate as `OutdatedComments` — never silently dropped | mirrors the outdated-comments precedent |
| U8 | The **"Original order" toggle** restores GitHub order (the stored `pr_files` order the tab already renders); in original mode the label flips to "Group by role"; BOTH modes pass the inline findings through (dots, bars, comments, and the toggle are independent) | grouping is a lens, never a data change |
| U9 | Role mode degrades **resiliently**: while `useSmartDiff` is loading or failed (or the response has no groups), the tab renders the plain `DiffViewer` | the Files tab never blanks because a read-only endpoint hiccuped |
| U10 | No review yet → a muted `reviewNotRunTitle/Body` hint under the section label; the Show-comments toggle appears when there are GitHub comments OR inline findings | empty state explains what to do instead of hiding the affordance |

## 2. Surfaces

| Piece | File |
|-------|------|
| `useSmartDiff` (polls 4s while a run is active; invalidates groups + reviews on settle) | `src/lib/hooks/reviews.ts` |
| `SmartDiffView` (group headers, collapse, counters, per-group `DiffViewer`) | `…/pulls/[number]/_components/SmartDiffView/` |
| `DiffTab` wiring (order toggle, pinned inline set, `useFindingAction`, no-review hint) | `…/pulls/[number]/_components/DiffTab/DiffTab.tsx` |
| Findings in the shared viewer (`partitionFindings`, marked line, `FindingComment`, unanchored footer) | `src/components/diff-viewer/` |

## 3. Testing

`FileCard.test.tsx` — dot, severity label on the marked line, the anchored
comment under the parsed `RIGHT:newNo` line, the unanchored footer, and the
bar/label surviving without `commenting`. `SmartDiffView.test.tsx` — through
`DiffTab` with the real hooks (fetch stubbed): group order + labels, collapse
defaults, counter badge, expand-on-click, inline comment + actions behind Show
comments, the Original-order toggle (both directions), the no-review state, and
the failure fallback.
