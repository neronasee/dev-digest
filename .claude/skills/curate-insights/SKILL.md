---
name: curate-insights
description: User-invoked periodic curation of the four module INSIGHTS.md logs (server/, client/, reviewer-core/, e2e/) via the insights-curator agent — merges reworded duplicates, prunes stale entries with evidence, re-dates and resolves Open Questions, and proposes (never applies) promotions into README/docs for doc-writer. Run when INSIGHTS.md files grow noisy, before or after a milestone, or when stale references are suspected. Requires a clean git tree — the curation diff is the review artifact and the revert path.
disable-model-invocation: true
context: fork
agent: insights-curator
---

# Curate Insights

Runs the insights-curator agent (this skill forks into it; the body below is
its prompt) to garden the module INSIGHTS.md logs — the **one sanctioned
exception** to their append-only capture contract. Capture stays with the
engineering-insights skill; only this pass may merge, prune, or re-date.

## Invocation

- `/curate-insights` — all four modules.
- `/curate-insights <module>` — one of `server`, `client`, `reviewer-core`,
  `e2e`.

## The run

1. Preconditions per the curator's charter: clean tree required
   (`git status --porcelain` empty — commit or stash first); scope as invoked;
   the four INSIGHTS.md files are the entire write surface.
2. Every entry gets an evidence check (references still exist, version claims
   still current, no semantic drift, not a duplicate), then a verdict:
   KEEP / MERGE / PRUNE / RE-DATE / RESOLVE / FLAG — every prune cites the
   failed check that justifies it; promotions into README/docs are proposed
   only (doc-writer's lane).
3. The report is a per-entry ledger plus size stats; the curator never
   commits.

## After the run

- Review `git diff -- */INSIGHTS.md` against the ledger; revert anything you
  disagree with — the tree was clean, so the diff is exactly the curation.
- Want a promotion proposal applied? Dispatch doc-writer with it.
