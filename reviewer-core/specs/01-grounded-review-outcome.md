# 01 — Grounded review outcome

## What

Grounded findings are the single source of truth for the final review. After
citation grounding, the engine deterministically recomputes verdict, score, and
(when anything was dropped) a summary based only on surviving count and titles.
No findings means `approve`; a finding meeting `ciFailOn` means
`request_changes`; otherwise the verdict is `comment`. The same helper drives
GitHub review events.

## Citation rules

Every finding kind must cite integer lines greater than zero that intersect a
changed new-side diff line. There is no file-level exemption. Before rejecting a
path near-miss, grounding normalizes separators and leading `./`, `a/`, or `b/`.
It may rescue a same-basename path only when the cited range intersects and one
candidate has a uniquely best trailing-path match. Ambiguity remains a drop.

## Execution strategy

Omitting `strategy` deliberately means `single-pass`: the complete diff is sent
in one model call. `auto` remains an explicit agent setting for callers that want
large multi-file diffs to switch to map-reduce.
